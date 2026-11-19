"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { createDraftPlanStore } from "@/lib/plans/command-store";
import type { DisplayUnit, DraftActor } from "@/lib/plans/model";
import {
  encodeSnapshot,
  rebaseSnapshot,
  type StudioSnapshot,
} from "@/lib/plans/rebase";
import {
  applyStudioSnapshot,
  saveStudioSchema,
  studioSnapshot,
  type StudioDocument,
} from "@/lib/plans/studio-document";

type Store = ReturnType<typeof createDraftPlanStore>;
export type SyncStop = "auth" | "deleted";
type Block = SyncStop | "conflict";
type Operation = "save" | "pull";
type Baseline = Pick<StudioDocument, "revision" | "name"> & {
  snapshot: StudioSnapshot;
  encoded: string;
};
const autosaveDelay = 1_200;

function baseline(
  name: string,
  revision: number,
  snapshot: StudioSnapshot,
): Baseline {
  return { name, revision, snapshot, encoded: encodeSnapshot(snapshot) };
}

export function useStudioSync(
  initial: StudioDocument,
  store: Store,
  actor: DraftActor,
) {
  const plan = useSyncExternalStore(
    store.subscribe,
    () => store.getState().plan,
    () => store.getInitialState().plan,
  );
  const [unit, updateUnit] = useState(initial.unit);
  const currentUnit = useRef(unit);
  const [checkpoint, setCheckpoint] = useState(() =>
    baseline(
      initial.name,
      initial.revision,
      studioSnapshot(initial.graph, initial.unit),
    ),
  );
  const checkpointRef = useRef(checkpoint);
  const lastUnconfirmed = useRef<string | null>(null);
  const [target, setTarget] = useState(initial.revision);
  const [block, setBlock] = useState<Block | null>(null);
  const blocked = useRef<Block | null>(null);
  const [activity, setActivity] = useState<Operation | null>(null);
  const running = useRef<AbortController | null>(null);
  const [failure, setFailure] = useState<{
    at: number;
    invalid?: string;
    message: string;
  } | null>(null);
  const consecutiveErrors = useRef(0);
  const encoded = useMemo(
    () => encodeSnapshot(studioSnapshot(plan, unit)),
    [plan, unit],
  );
  const dirty = encoded !== checkpoint.encoded;

  useEffect(() => () => running.current?.abort(), []);

  const setUnit = useCallback((value: DisplayUnit) => {
    currentUnit.current = value;
    updateUnit(value);
  }, []);
  const halt = useCallback((reason: Block) => {
    // An authorization or deletion signal takes precedence over a previous edit conflict.
    if (blocked.current === "deleted" || blocked.current === "auth") return;
    blocked.current = reason;
    setBlock(reason);
  }, []);
  const retryAuth = useCallback(() => {
    if (blocked.current !== "auth") return;
    blocked.current = null;
    setBlock(null);
  }, []);
  const observeRevision = useCallback((revision: number) => {
    setTarget((current) => Math.max(current, revision));
  }, []);
  const commit = useCallback((value: Baseline) => {
    checkpointRef.current = value;
    setCheckpoint(value);
  }, []);

  const sync = useCallback(
    async (operation: Operation) => {
      if (running.current || blocked.current) return;
      const graphUrl = `/api/floorplans/${initial.id}/graph`;
      const before = checkpointRef.current;
      const proposed = studioSnapshot(
        store.getState().plan,
        currentUnit.current,
      );
      const proposedText = encodeSnapshot(proposed);
      if (operation === "save" && proposedText === before.encoded) return;
      const controller = new AbortController();
      const { signal } = controller;
      running.current = controller;
      setActivity(operation);

      function succeeded() {
        consecutiveErrors.current = 0;
        setFailure(null);
      }
      function failed(message: string, response?: Response, invalid?: string) {
        const retryHeader = response?.headers.get("Retry-After");
        const retryAfter = retryHeader ? Number(retryHeader) * 1000 : 0;
        const backoff = Math.min(
          30_000,
          2_000 * 2 ** consecutiveErrors.current++,
        );
        setFailure({
          message,
          at: Date.now() + Math.max(backoff, retryAfter || 0),
          invalid,
        });
      }
      function unavailable(status: number) {
        if (status === 401) halt("auth");
        else if (status === 404) halt("deleted");
        else return false;
        return true;
      }

      try {
        const priorAttempt = lastUnconfirmed.current;
        if (operation === "save") {
          lastUnconfirmed.current = proposedText;
          const response = await fetch(graphUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision: before.revision, ...proposed }),
            signal,
          });
          if (blocked.current) return;
          if (response.ok) {
            const { revision } = (await response.json()) as {
              revision: number;
            };
            commit(baseline(before.name, revision, proposed));
            lastUnconfirmed.current = null;
            succeeded();
            return;
          }
          if (unavailable(response.status)) return;
          if (response.status !== 409) {
            if (response.status < 500) lastUnconfirmed.current = priorAttempt;
            const error = await response.json().catch(() => null);
            failed(
              typeof error?.error === "string"
                ? error.error
                : "Could not save the drawing. Retrying.",
              response,
              response.status === 400 ? proposedText : undefined,
            );
            return;
          }
        }

        const response = await fetch(graphUrl, { cache: "no-store", signal });
        if (blocked.current || unavailable(response.status)) return;
        if (!response.ok) {
          failed("Could not refresh the saved drawing. Retrying.", response);
          return;
        }
        const document: StudioDocument = await response.json();
        if (blocked.current) return;
        const saved = studioSnapshot(document.graph, document.unit);
        const next = baseline(document.name, document.revision, saved);
        const local = studioSnapshot(
          store.getState().plan,
          currentUnit.current,
        );
        const localText = encodeSnapshot(local);

        if (document.revision <= before.revision) {
          if (operation === "save") halt("conflict");
          else failed("Waiting for the latest saved revision.");
          return;
        }
        if (
          next.encoded !== localText &&
          next.encoded !== priorAttempt &&
          !(operation === "save" && next.encoded === proposedText)
        ) {
          try {
            const merged = rebaseSnapshot(before.snapshot, local, saved);
            const draft =
              encodeSnapshot(merged) === next.encoded
                ? undefined
                : applyStudioSnapshot(
                    document.graph,
                    saveStudioSchema.parse({
                      revision: document.revision,
                      ...merged,
                    }),
                    actor,
                  );
            store.getState().adoptRemote(document.graph, actor, draft);
            setUnit(merged.unit);
          } catch {
            halt("conflict");
            return;
          }
        }

        lastUnconfirmed.current = null;
        commit(next);
        succeeded();
      } catch {
        if (!signal.aborted)
          failed(
            operation === "save"
              ? "Connection interrupted. Retrying the save."
              : "Connection interrupted. Retrying the refresh.",
          );
      } finally {
        running.current = null;
        setActivity(null);
      }
    },
    [actor, commit, halt, initial.id, setUnit, store],
  );

  useEffect(() => {
    if (activity || block) return;
    const waiting = Math.max(0, (failure?.at ?? 0) - Date.now());
    if (target > checkpoint.revision) {
      const timer = setTimeout(() => void sync("pull"), waiting);
      return () => clearTimeout(timer);
    }
    if (dirty && failure?.invalid !== encoded) {
      const timer = setTimeout(
        () => void sync("save"),
        Math.max(autosaveDelay, waiting),
      );
      return () => clearTimeout(timer);
    }
  }, [
    activity,
    block,
    checkpoint.revision,
    dirty,
    encoded,
    failure,
    sync,
    target,
  ]);

  const save = useCallback(() => {
    if (target > checkpointRef.current.revision) return sync("pull");
    return sync("save");
  }, [sync, target]);
  const dismissFailure = useCallback(() => {
    setFailure((value) => (value ? { ...value, message: "" } : value));
  }, []);

  return {
    unit,
    setUnit,
    dirty,
    checkpoint,
    activity,
    block,
    failure: failure?.message ?? "",
    save,
    halt,
    observeRevision,
    dismissFailure,
    retryAuth,
  };
}
