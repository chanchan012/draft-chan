import type { LiveFrame } from "../plans/live";
import type { LiveBus } from "./live-bus";

export function liveStream({
  bus,
  key,
  revision,
  currentRevision,
  signal,
  expiresAt,
  heartbeat = 10_000,
  duration = 25_000,
}: {
  bus: LiveBus;
  key: string;
  revision: number;
  currentRevision(): Promise<number | null>;
  signal: AbortSignal;
  expiresAt?: number;
  heartbeat?: number;
  duration?: number;
}) {
  const encoder = new TextEncoder();
  let cancel = () => {};
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let closed = false;
        let timer: ReturnType<typeof setTimeout>;
        let interval: ReturnType<typeof setInterval>;
        let unsubscribe = () => {};
        let latest = revision;
        let refreshing = false;

        function close(end = true) {
          if (closed) return;
          closed = true;
          clearInterval(interval);
          clearTimeout(timer);
          unsubscribe();
          signal.removeEventListener("abort", abort);
          if (end) controller.close();
        }
        const abort = () => close();
        cancel = () => close(false);
        function send(frame: LiveFrame) {
          if (closed) return;
          if ((controller.desiredSize ?? 0) <= 0) {
            close();
            return;
          }
          controller.enqueue(
            encoder.encode("data: " + JSON.stringify(frame) + "\n\n"),
          );
        }
        unsubscribe = bus.subscribe(key, (change) => {
          if (change.type === "revision") {
            if (change.revision <= latest) return;
            latest = change.revision;
          }
          send(change);
          if (change.type === "deleted") close();
        });

        async function refresh(checkOwner: boolean) {
          if (closed || refreshing) return;
          refreshing = true;
          try {
            const [saved, peers] = await Promise.all([
              checkOwner ? currentRevision() : latest,
              bus.presence(key).catch(() => []),
            ]);
            if (saved === null) {
              send({ type: "deleted" });
              close();
              return;
            }
            latest = Math.max(latest, saved);
            send({ type: "snapshot", revision: latest, peers });
          } catch {
            close();
          } finally {
            refreshing = false;
          }
        }

        const timeToExpiry =
          expiresAt === undefined
            ? Infinity
            : Math.max(0, expiresAt - Date.now());
        timer = setTimeout(
          () => {
            if (timeToExpiry <= duration) send({ type: "auth" });
            close();
          },
          Math.min(duration, timeToExpiry),
        );
        interval = setInterval(() => void refresh(true), heartbeat);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) close();
        else void refresh(false);
      },
      cancel() {
        cancel();
      },
    },
    { highWaterMark: 32 },
  );

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
