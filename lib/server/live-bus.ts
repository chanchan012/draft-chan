import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import {
  liveChange,
  peerLifetime,
  peerSchema,
  type LiveChange,
  type LivePeer,
  type PresenceInput,
} from "../plans/live";
import type { DraftActor } from "../plans/model";

type Listener = (change: LiveChange) => void;
export interface LiveBus {
  publish(key: string, change: LiveChange): Promise<void>;
  presence(key: string): Promise<LivePeer[]>;
  update(key: string, peer: LivePeer): Promise<void>;
  subscribe(key: string, listener: Listener): () => void;
}

const maxPeers = 32;
const digest = (parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const planChannel = (owner: string, planId: string) =>
  "draft:live:" + digest([owner, planId.toLowerCase()]);

export function livePeer(actor: DraftActor, input: PresenceInput): LivePeer {
  // The client can identify its own tab. AI IDs are assigned only by trusted server callers.
  return {
    id:
      actor.kind === "human"
        ? input.clientId
        : "ai-" + digest([actor.id, input.clientId]),
    kind: actor.kind,
    cursor: input.cursor,
    expiresAt: Date.now() + peerLifetime,
  };
}

// Local development and the unconfigured Preview can still sync revisions through Neon.
export function memoryLiveBus(clock = Date.now): LiveBus {
  const rooms = new Map<
    string,
    { listeners: Set<Listener>; peers: Map<string, LivePeer>; last: number }
  >();
  function room(key: string) {
    const now = clock();
    const existing = rooms.get(key);
    if (existing) {
      existing.last = now;
      return existing;
    }
    for (const [id, value] of rooms) {
      if (value.listeners.size === 0 && now - value.last > peerLifetime)
        rooms.delete(id);
    }
    const created = {
      listeners: new Set<Listener>(),
      peers: new Map<string, LivePeer>(),
      last: now,
    };
    rooms.set(key, created);
    return created;
  }
  function publish(key: string, change: LiveChange) {
    const current = rooms.get(key);
    if (!current) return;
    for (const listener of current.listeners) listener(change);
    if (change.type === "deleted") rooms.delete(key);
  }
  return {
    async publish(key, change) {
      publish(key, change);
    },
    async presence(key) {
      return [...room(key).peers.values()].filter(
        ({ expiresAt }) => expiresAt > clock(),
      );
    },
    async update(key, peer) {
      const { peers } = room(key);
      for (const [id, previous] of peers) {
        if (previous.expiresAt <= clock()) peers.delete(id);
      }
      peers.delete(peer.id);
      peers.set(peer.id, peer);
      if (peers.size > maxPeers) peers.delete(peers.keys().next().value!);
      publish(key, { type: "presence", peer });
    },
    subscribe(key, listener) {
      const { listeners } = room(key);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Keep the lease index and hash in the same Redis slot and update them with the publication.
const updatePresence = `
local function remove(ids)
  if #ids > 0 then
    redis.call('ZREM', KEYS[1], unpack(ids))
    redis.call('HDEL', KEYS[2], unpack(ids))
  end
end
remove(redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[3]))
redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
local excess = redis.call('ZCARD', KEYS[1]) - tonumber(ARGV[6])
if excess > 0 then remove(redis.call('ZRANGE', KEYS[1], 0, excess - 1)) end
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[5])
return redis.call('PUBLISH', KEYS[3], ARGV[7])
`;

export function redisLiveBus(redis: Redis, subscriber = redis): LiveBus {
  const leaseKey = (key: string) => "{" + key + "}:leases";
  const peerKey = (key: string) => "{" + key + "}:peers";
  const channel = (key: string) => "{" + key + "}:events";
  return {
    async publish(key, change) {
      await redis.publish(channel(key), JSON.stringify(change));
    },
    async presence(key) {
      const records = await redis.hgetall<Record<string, unknown>>(
        peerKey(key),
      );
      const now = Date.now();
      return Object.values(records ?? {}).flatMap((record) => {
        const peer = peerSchema.safeParse(record);
        return peer.success && peer.data.expiresAt > now ? [peer.data] : [];
      });
    },
    async update(key, peer) {
      await redis.eval(
        updatePresence,
        [leaseKey(key), peerKey(key), channel(key)],
        [
          peer.id,
          JSON.stringify(peer),
          Date.now(),
          peer.expiresAt,
          peerLifetime * 2,
          maxPeers,
          JSON.stringify({ type: "presence", peer }),
        ],
      );
    },
    subscribe(key, listener) {
      const subscription = subscriber.subscribe<unknown>(channel(key));
      subscription.on("message", ({ message }) => {
        const event = liveChange.safeParse(message);
        if (event.success) listener(event.data);
      });
      // The snapshots also cover a brief subscription outage.
      subscription.on("error", () => {});
      return () => {
        void subscription.unsubscribe();
      };
    },
  };
}

export function configuredLiveBus(): LiveBus {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return memoryLiveBus();
  const options = { url, token, retry: false } as const;
  // Short command deadlines leave subscriptions free to live for the entire SSE connection.
  return redisLiveBus(
    new Redis({ ...options, signal: () => AbortSignal.timeout(2_500) }),
    new Redis(options),
  );
}

export const liveBus = configuredLiveBus();

export async function publishPlanPresence(
  owner: string,
  planId: string,
  actor: DraftActor,
  input: PresenceInput,
  bus = liveBus,
) {
  const peer = livePeer(actor, input);
  await bus.update(planChannel(owner, planId), peer);
}
