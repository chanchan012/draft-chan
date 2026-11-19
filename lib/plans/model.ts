import { z } from "zod";

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export const polygonSchema = z.array(pointSchema).min(3);
export type Point = z.infer<typeof pointSchema>;

const coordinate = z.int().min(-1_000_000).max(1_000_000);
const wallPoint = z.object({ x: coordinate, y: coordinate });
const identifier = z.string().trim().min(1).max(128);
const wallParameters = z.object({
  start: wallPoint,
  end: wallPoint,
  thicknessMm: z.int().positive().max(10_000),
  kind: z.enum(["interior", "exterior"]),
});
export const actorSchema = z.strictObject({
  kind: z.enum(["human", "ai"]),
  id: identifier,
});
export type DraftActor = z.infer<typeof actorSchema>;

export const wallInput = wallParameters.extend({ id: identifier }).strict();
function hasLength({ start, end }: { start: Point; end: Point }) {
  return start.x !== end.x || start.y !== end.y;
}
export const wallSchema = wallInput
  .extend({
    createdBy: actorSchema.optional(),
    updatedBy: actorSchema.optional(),
  })
  .refine(hasLength, "A wall must have distinct endpoints");
export type Wall = z.infer<typeof wallSchema>;

export const wallCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("wall.add"), wall: wallInput }),
  z.strictObject({
    type: z.literal("wall.update"),
    id: identifier,
    changes: wallParameters.partial().strict(),
  }),
  z.strictObject({ type: z.literal("wall.remove"), id: identifier }),
]);
export type WallCommand = z.infer<typeof wallCommandSchema>;

export const doorInput = z.strictObject({
  id: identifier,
  wallId: identifier,
  offsetMm: z.int().nonnegative(),
  widthMm: z.int().min(100).max(10_000),
  hinge: z.enum(["start", "end"]),
  swing: z.enum(["left", "right"]),
});
export const doorSchema = doorInput.extend({
  createdBy: actorSchema.optional(),
  updatedBy: actorSchema.optional(),
});
export type Door = z.infer<typeof doorSchema>;

export const planCommandSchema = z.union([
  wallCommandSchema,
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("door.add"), door: doorInput }),
    z.strictObject({
      type: z.literal("door.update"),
      id: identifier,
      changes: doorInput
        .pick({ widthMm: true, hinge: true, swing: true })
        .partial(),
    }),
    z.strictObject({ type: z.literal("door.remove"), id: identifier }),
  ]),
]);
export type PlanCommand = z.infer<typeof planCommandSchema>;

export const displayUnits = z.enum(["mm", "in"]);
export type DisplayUnit = z.infer<typeof displayUnits>;
export const wallLimit = 512;
export const openingLimit = 1024;

export const roomSchema = z.object({
  id: z.string().min(1),
  polygon: polygonSchema,
  holes: z.array(polygonSchema).optional(),
});
export type Room = z.infer<typeof roomSchema>;

export const draftPlanSchema = z.looseObject({
  version: z.literal(1),
  walls: z.array(wallSchema),
  rooms: z.array(roomSchema),
  openings: z.array(doorSchema),
  fixtures: z.array(z.unknown()),
  dimensions: z.array(z.unknown()),
});
export type DraftPlanState = z.infer<typeof draftPlanSchema>;

export function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
