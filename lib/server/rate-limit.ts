import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

type Decision = { success: boolean; reset: number };
export type Limit = (key: string) => Promise<Decision>;

export function localWindow(
  capacity = 60,
  span = 60_000,
  clock = Date.now,
): Limit {
  const requests = new Map<string, number[]>();
  let nextCleanup = 0;
  return async (key) => {
    const now = clock();
    if (now >= nextCleanup) {
      for (const [id, hits] of requests) {
        if (hits[hits.length - 1] <= now - span) requests.delete(id);
      }
      nextCleanup = now + span;
    }
    const active = (requests.get(key) ?? []).filter(
      (time) => time > now - span,
    );
    const success = active.length < capacity;
    if (success) active.push(now);
    requests.set(key, active);
    return { success, reset: active[0] + span };
  };
}
export function configuredLimiter(bucket = "rpc", capacity = 60): Limit {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token) return localWindow(capacity);
  if (!url || !token)
    return async () => {
      throw new Error("Incomplete Redis configuration");
    };
  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    prefix: "draft:" + bucket,
    limiter: Ratelimit.slidingWindow(capacity, "60 s"),
    timeout: 0,
  });
  return (key) => limiter.limit(key);
}
