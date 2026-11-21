import { z } from "zod";
import { fixtureKinds, utilityKinds } from "./catalog";

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
export const polygonSchema = z.array(pointSchema).min(3);
export type Point = z.infer<typeof pointSchema>;

const coordinate = z.int().min(-1_000_000).max(1_000_000);
const wallPoint = z.object({ x: coordinate, y: coordinate });
export const modelPointInput = wallPoint.strict();
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
export const windowInput = doorInput
  .pick({ id: true, wallId: true, offsetMm: true, widthMm: true })
  .extend({
    sillMm: z.int().min(0).max(2350),
    heightMm: z.int().min(100).max(2450),
  });
export const windowSchema = windowInput
  .extend({
    createdBy: actorSchema.optional(),
    updatedBy: actorSchema.optional(),
  })
  .refine(
    ({ sillMm, heightMm }) => sillMm + heightMm <= 2450,
    "The window must fit within the wall height.",
  );
export type WindowOpening = z.infer<typeof windowSchema>;

export const annotationInput = z.strictObject({
  id: identifier,
  start: modelPointInput,
  end: modelPointInput,
});
export const annotationSchema = annotationInput
  .extend({
    createdBy: actorSchema.optional(),
    updatedBy: actorSchema.optional(),
  })
  .refine(hasLength, "A dimension requires distinct endpoints.");
export type DimensionAnnotation = z.infer<typeof annotationSchema>;

const objectParameters = z.strictObject({ position: wallPoint });
const fixtureParameters = objectParameters.extend({
  template: z.enum(fixtureKinds),
  widthMm: z.int().min(50).max(10_000),
  depthMm: z.int().min(50).max(10_000),
  heightMm: z.int().min(1).max(10_000),
  rotation: z.literal([0, 90, 180, 270]),
});
const utilityParameters = objectParameters.extend({
  template: z.enum(utilityKinds),
});
export const fixtureInput = fixtureParameters.extend({ id: identifier });
export const utilityInput = utilityParameters.extend({ id: identifier });
const authors = {
  createdBy: actorSchema.optional(),
  updatedBy: actorSchema.optional(),
};
export const fixtureSchema = fixtureInput.extend(authors);
export const utilitySchema = utilityInput.extend(authors);
export type Fixture = z.infer<typeof fixtureSchema>;
export type Utility = z.infer<typeof utilitySchema>;

const furnishingCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("fixture.add"), fixture: fixtureInput }),
  z.strictObject({
    type: z.literal("fixture.update"),
    id: identifier,
    changes: fixtureParameters.partial(),
  }),
  z.strictObject({ type: z.literal("fixture.remove"), id: identifier }),
  z.strictObject({ type: z.literal("utility.add"), utility: utilityInput }),
  z.strictObject({
    type: z.literal("utility.update"),
    id: identifier,
    changes: utilityParameters.partial(),
  }),
  z.strictObject({ type: z.literal("utility.remove"), id: identifier }),
]);
const sketchCenter = {
  center: modelPointInput,
  radiusMm: z.number().finite().min(1).max(1_000_000),
};
const lineParameters = { start: modelPointInput, end: modelPointInput };
export const sketchFields = [
  z.strictObject({ kind: z.literal("construction"), ...lineParameters }),
  z.strictObject({
    kind: z.literal("polyline"),
    points: z.array(modelPointInput).min(2).max(128),
    closed: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("circle"), ...sketchCenter }),
  z.strictObject({
    kind: z.literal("arc"),
    ...sketchCenter,
    startDeg: z.number().finite().min(0).lt(360),
    sweepDeg: z.number().finite().min(0.01).lt(360),
  }),
] as const;
export const sketchGeometry = z.discriminatedUnion("kind", sketchFields);
export type SketchGeometry = z.infer<typeof sketchGeometry>;
export const sketchInput = z.strictObject({
  id: identifier,
  geometry: sketchGeometry,
});
export const sketchSchema = sketchInput
  .extend(authors)
  .superRefine(({ geometry }, context) => {
    const report = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (geometry.kind === "construction") {
      if (!hasLength(geometry))
        report("A construction line requires distinct endpoints.");
    } else if (geometry.kind === "polyline") {
      const { points, closed } = geometry;
      if (
        points.some(
          (start, i) => i > 0 && !hasLength({ start, end: points[i - 1] }),
        )
      )
        report("Adjacent polyline vertices must be distinct.");
      if (
        closed &&
        (new Set(points.map((p) => p.x + "," + p.y)).size < 3 ||
          !hasLength({ start: points[0], end: points[points.length - 1] }))
      )
        report(
          "Use at least three distinct vertices and omit the duplicate closing vertex.",
        );
    } else {
      const { center, radiusMm } = geometry;
      if (
        Math.abs(center.x) + radiusMm > 1_000_000 ||
        Math.abs(center.y) + radiusMm > 1_000_000
      )
        report("The curve must fit inside the model bounds.");
    }
  });
export type Sketch = z.infer<typeof sketchSchema>;

export const wallEndpointInput = z.strictObject({
  wallId: identifier,
  endpoint: z.enum(["start", "end"]),
});
const distanceInput = z.number().finite().min(1).max(2_828_427);
export const constraintInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("coincident"),
    id: identifier,
    first: wallEndpointInput,
    second: wallEndpointInput,
  }),
  z.strictObject({
    kind: z.enum(["parallel", "perpendicular", "equal_length"]),
    id: identifier,
    firstWallId: identifier,
    secondWallId: identifier,
  }),
  z.strictObject({
    kind: z.literal("fixed_distance"),
    id: identifier,
    first: wallEndpointInput,
    second: wallEndpointInput,
    distanceMm: distanceInput,
  }),
]);
export const constraintLimit = 96;
export type WallEndpoint = z.infer<typeof wallEndpointInput>;
export type Constraint = z.infer<typeof constraintInput>;

export const drawingEntityKinds = [
  "wall",
  "door",
  "window",
  "fixture",
  "utility",
  "dimension",
  "sketch",
] as const;
export const drawingEntityInput = z.strictObject({
  kind: z.enum(drawingEntityKinds),
  id: identifier,
});
export const drawingLayerInput = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(80),
  visible: z.boolean(),
  locked: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  lineStyle: z.enum(["solid", "dashed", "dotted"]),
  members: z.array(drawingEntityInput).max(5000),
});
export type DrawingEntity = z.infer<typeof drawingEntityInput>;
export type DrawingLayer = z.infer<typeof drawingLayerInput>;

const reusableKinds = ["door", "window", "fixture"] as const;
const doorParameters = doorInput.pick({
  widthMm: true,
  hinge: true,
  swing: true,
});
const windowParameters = windowInput.pick({
  widthMm: true,
  sillMm: true,
  heightMm: true,
});
const reusableFixture = fixtureInput.pick({
  template: true,
  widthMm: true,
  depthMm: true,
  heightMm: true,
});
const definitionIdentity = {
  id: identifier,
  name: z.string().trim().min(1).max(80),
};
export const blockInput = z.discriminatedUnion("kind", [
  z.strictObject({
    ...definitionIdentity,
    kind: z.literal("door"),
    parameters: doorParameters,
  }),
  z.strictObject({
    ...definitionIdentity,
    kind: z.literal("window"),
    parameters: windowParameters,
  }),
  z.strictObject({
    ...definitionIdentity,
    kind: z.literal("fixture"),
    parameters: reusableFixture,
  }),
]);
const instanceIdentity = { id: identifier, blockId: identifier };
const hosting = doorInput.pick({ wallId: true, offsetMm: true });
export const blockPlacementInput = z.discriminatedUnion("kind", [
  hosting.extend({
    kind: z.literal("door"),
    overrides: doorParameters.partial().optional(),
  }),
  hosting.extend({
    kind: z.literal("window"),
    overrides: windowParameters.partial().optional(),
  }),
  fixtureInput.pick({ position: true, rotation: true }).extend({
    kind: z.literal("fixture"),
    overrides: reusableFixture.partial().optional(),
  }),
]);
export const blockInstanceInput = z.discriminatedUnion("kind", [
  z.strictObject({
    ...instanceIdentity,
    kind: z.literal("door"),
    overrides: doorParameters.partial(),
  }),
  z.strictObject({
    ...instanceIdentity,
    kind: z.literal("window"),
    overrides: windowParameters.partial(),
  }),
  z.strictObject({
    ...instanceIdentity,
    kind: z.literal("fixture"),
    overrides: reusableFixture.partial(),
  }),
]);
export type BlockDefinition = z.infer<typeof blockInput>;
export type BlockPlacement = z.infer<typeof blockPlacementInput>;
export type BlockInstance = z.infer<typeof blockInstanceInput>;
export type ReusableKind = (typeof reusableKinds)[number];

export const planCommandSchema = z.union([
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("layer.write"),
      layer: drawingLayerInput,
    }),
    z.strictObject({ type: z.literal("layer.remove"), id: identifier }),
    z.strictObject({ type: z.literal("block.define"), definition: blockInput }),
    z.strictObject({ type: z.literal("block.update"), definition: blockInput }),
    z.strictObject({
      type: z.literal("block.link"),
      instance: blockInstanceInput,
    }),
    z.strictObject({
      type: z.literal("block.insert"),
      id: identifier,
      blockId: identifier,
      placement: blockPlacementInput,
    }),
  ]),
  wallCommandSchema,
  furnishingCommandSchema,
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("constraint.add"),
      constraint: constraintInput,
    }),
    z.strictObject({
      type: z.literal("constraint.drive"),
      id: identifier,
      distanceMm: distanceInput,
    }),
    z.strictObject({ type: z.literal("constraint.remove"), id: identifier }),
    z.strictObject({ type: z.literal("sketch.add"), sketch: sketchInput }),
    z.strictObject({
      type: z.literal("sketch.update"),
      id: identifier,
      geometry: sketchGeometry,
    }),
    z.strictObject({ type: z.literal("sketch.remove"), id: identifier }),
    z.strictObject({ type: z.literal("door.add"), door: doorInput }),
    z.strictObject({
      type: z.literal("door.update"),
      id: identifier,
      changes: doorInput
        .pick({ widthMm: true, hinge: true, swing: true, offsetMm: true })
        .partial(),
    }),
    z.strictObject({ type: z.literal("door.remove"), id: identifier }),
    z.strictObject({ type: z.literal("window.add"), opening: windowInput }),
    z.strictObject({
      type: z.literal("window.update"),
      id: identifier,
      changes: windowInput.omit({ id: true, wallId: true }).partial(),
    }),
    z.strictObject({ type: z.literal("window.remove"), id: identifier }),
    z.strictObject({
      type: z.literal("dimension.add"),
      annotation: annotationInput,
    }),
    z.strictObject({
      type: z.literal("dimension.update"),
      id: identifier,
      changes: annotationInput.omit({ id: true }).partial(),
    }),
    z.strictObject({ type: z.literal("dimension.remove"), id: identifier }),
  ]),
]);
export type PlanCommand = z.infer<typeof planCommandSchema>;

export const displayUnits = z.enum(["mm", "in"]);
export type DisplayUnit = z.infer<typeof displayUnits>;
export const wallLimit = 512;
export const openingLimit = 1024;
export const placementLimit = 512;

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
  windows: z.array(windowSchema).max(openingLimit).optional(),
  fixtures: z.array(fixtureSchema),
  utilities: z.array(utilitySchema).default([]),
  dimensions: z.array(z.unknown()),
  drawingLayers: z.array(drawingLayerInput).max(64).optional(),
  blocks: z.array(blockInput).max(128).optional(),
  blockInstances: z.array(blockInstanceInput).max(3072).optional(),
  constraints: z.array(constraintInput).max(constraintLimit).optional(),
  sketches: z.array(sketchSchema).max(placementLimit).optional(),
  annotations: z.array(annotationSchema).max(placementLimit).optional(),
});
export type DraftPlanState = z.infer<typeof draftPlanSchema>;

export function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
