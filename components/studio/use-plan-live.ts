"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { liveFrame, type LiveFrame, type LivePeer } from "@/lib/plans/live";
import type { Point } from "@/lib/plans/model";
import type { SyncStop } from "./use-studio-sync";

type Connection = "connecting" | "live" | "reconnecting" | "offline";
const cursorInterval = 500;
const presenceRefresh = 11_000;

function pause(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, delay);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      window.removeEventListener("online", finish);
      resolve();
    }
    if (signal.aborted) finish();
    else {
      signal.addEventListener("abort", finish, { once: true });
      window.addEventListener("online", finish, { once: true });
    }
  });
}

async function readFrames(
  response: Response,
  receive: (frame: LiveFrame) => void,
) {
  if (
    !response.body ||
    !response.headers.get("Content-Type")?.startsWith("text/event-stream")
  )
    throw new Error("Expected a live event stream.");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += value;
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const body = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const payload = body
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!payload) continue;
        const frame = liveFrame.safeParse(JSON.parse(payload));
        if (frame.success) receive(frame.data);
      }
      if (buffer.length > 65_536)
        throw new Error("A live event exceeded its size limit.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function usePlanLive(
  id: string,
  stopped: boolean,
  onRevision: (revision: number) => void,
  onStop: (reason: SyncStop) => void,
  storeyId?: string,
) {
  const [clientId] = useState(() => crypto.randomUUID());
  const [connection, setConnection] = useState<Connection>("connecting");
  const [peers, setPeers] = useState<LivePeer[]>([]);
  const cursor = useRef<Point | null>(null);
  const floor = useRef(storeyId);
  const schedule = useRef<() => void>(() => {});
  const base = `/api/floorplans/${id}`;

  useEffect(() => {
    floor.current = storeyId;
    cursor.current = null;
    schedule.current();
  }, [storeyId]);

  const moveCursor = useCallback((point: Point | null) => {
    const previous = cursor.current;
    if (point?.x === previous?.x && point?.y === previous?.y) return;
    cursor.current = point;
    schedule.current();
  }, []);

  useEffect(() => {
    if (stopped) return;
    const controller = new AbortController();
    const { signal } = controller;
    let retry = 800;
    let ended = false;
    function stop(reason: SyncStop) {
      ended = true;
      setConnection("offline");
      setPeers([]);
      onStop(reason);
      controller.abort();
    }
    function remember(incoming: LivePeer[]) {
      const now = Date.now();
      setPeers((previous) => {
        const active = new Map(
          previous
            .filter((peer) => peer.expiresAt > now)
            .map((peer) => [peer.id, peer]),
        );
        for (const peer of incoming) {
          if (
            peer.id === clientId ||
            peer.expiresAt <= now ||
            (active.get(peer.id)?.expiresAt ?? 0) > peer.expiresAt
          )
            continue;
          active.set(peer.id, peer);
        }
        return [...active.values()]
          .sort((a, b) => b.expiresAt - a.expiresAt)
          .slice(0, 32);
      });
    }

    async function open() {
      while (!signal.aborted) {
        let delay = retry;
        try {
          const response = await fetch(base + "/live", {
            headers: { Accept: "text/event-stream" },
            cache: "no-store",
            signal,
          });
          if (response.status === 401 || response.status === 404) {
            stop(response.status === 401 ? "auth" : "deleted");
            return;
          }
          if (!response.ok) {
            delay = Math.max(
              delay,
              Number(response.headers.get("Retry-After")) * 1000,
            );
            throw new Error("Live stream unavailable.");
          }
          let received = false;
          await readFrames(response, (frame) => {
            if (signal.aborted) return;
            switch (frame.type) {
              case "snapshot":
                received = true;
                setConnection("live");
                retry = 800;
                onRevision(frame.revision);
                remember(frame.peers);
                break;
              case "revision":
                onRevision(frame.revision);
                break;
              case "presence":
                remember([frame.peer]);
                break;
              case "deleted":
                stop("deleted");
                break;
              case "auth":
                break; // Reconnect so Clerk can present a fresh JWT.
            }
          });
          if (!received && !signal.aborted)
            throw new Error("Live stream closed before its snapshot.");
          delay = 800;
        } catch {
          if (!signal.aborted) {
            setConnection("reconnecting");
            retry = Math.min(retry * 2, 15_000);
          }
        }
        if (!ended) await pause(delay, signal);
      }
    }
    void open();
    const prune = setInterval(() => {
      const now = Date.now();
      setPeers((previous) =>
        previous.some((peer) => peer.expiresAt <= now)
          ? previous.filter((peer) => peer.expiresAt > now)
          : previous,
      );
    }, 3_000);
    return () => {
      controller.abort();
      clearInterval(prune);
    };
  }, [base, clientId, stopped, onRevision, onStop]);

  useEffect(() => {
    if (connection !== "live" || stopped) return;
    const controller = new AbortController();
    let next: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let allowedAt = 0;
    let pending = false;
    const { signal } = controller;

    function queue() {
      if (document.hidden || signal.aborted) return;
      pending = true;
      if (inFlight || next !== undefined) return;
      next = setTimeout(send, Math.max(0, allowedAt - Date.now()));
    }
    async function send() {
      next = undefined;
      if (document.hidden || signal.aborted) return;
      inFlight = true;
      pending = false;
      allowedAt = Date.now() + cursorInterval;
      try {
        const response = await fetch(base + "/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            cursor: cursor.current,
            storeyId: floor.current,
          }),
          signal,
        });
        if (response.status === 401 || response.status === 404)
          onStop(response.status === 401 ? "auth" : "deleted");
        if (response.status === 429)
          allowedAt =
            Date.now() +
            (Number(response.headers.get("Retry-After")) || 2) * 1000;
        if (response.status >= 500) allowedAt = Date.now() + 3_000;
      } catch {
        allowedAt = Date.now() + 3_000;
      } finally {
        inFlight = false;
        if (pending) queue();
      }
    }

    schedule.current = queue;
    queue();
    const heartbeat = setInterval(queue, presenceRefresh);
    document.addEventListener("visibilitychange", queue);
    return () => {
      schedule.current = () => {};
      controller.abort();
      clearTimeout(next);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", queue);
    };
  }, [base, clientId, connection, onStop, stopped]);

  return {
    connection: stopped ? "offline" : connection,
    peers: stopped ? [] : peers,
    moveCursor,
  };
}
