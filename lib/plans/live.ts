import { z } from "zod";

const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const cursor = z.strictObject({ x: coordinate, y: coordinate }).nullable();
export const presenceInput = z.strictObject({ clientId: z.uuid(), cursor });
export const peerSchema = z.strictObject({
  id: z.string().max(100),
  kind: z.enum(["human", "ai"]),
  cursor,
  expiresAt: z.int().positive(),
});
const revision = z.int().nonnegative();
export const liveChange = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("revision"), revision }),
  z.strictObject({ type: z.literal("presence"), peer: peerSchema }),
  z.strictObject({ type: z.literal("deleted") }),
]);
export const liveFrame = z.union([
  liveChange,
  z.strictObject({
    type: z.literal("snapshot"),
    revision,
    peers: z.array(peerSchema).max(32),
  }),
  z.strictObject({ type: z.literal("auth") }),
]);
export type LivePeer = z.infer<typeof peerSchema>;
export type PresenceInput = z.infer<typeof presenceInput>;
export type LiveChange = z.infer<typeof liveChange>;
export type LiveFrame = z.infer<typeof liveFrame>;
export const peerLifetime = 25_000;
