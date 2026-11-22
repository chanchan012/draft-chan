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
export const defaultStoreyId = "ground";
export const storeyIdInput = identifier.optional();
export const wallReferenceInput = z.enum(["center", "positive", "negative"]);
export const storeyInput = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(80),
  elevationMm: z.int().min(-100_000).max(1_000_000),
  wallHeightMm: z.int().min(1000).max(12_000),
});
export const wallTypeInput = z
  .strictObject({
    id: identifier,
    name: z.string().trim().min(1).max(80),
    layers: z
      .array(
        z.strictObject({
          material: z.string().trim().min(1).max(80),
          thicknessMm: z.int().positive().max(10_000),
        }),
      )
      .min(1)
      .max(16),
  })
  .refine(
    (type) =>
      type.layers.reduce((sum, layer) => sum + layer.thicknessMm, 0) <= 10_000,
    "The assembly thickness must be at most 10000 mm.",
  );
export type Storey = z.infer<typeof storeyInput>;
export type WallType = z.infer<typeof wallTypeInput>;
export type WallReference = z.infer<typeof wallReferenceInput>;

const wallParameters = z.object({
  storeyId: storeyIdInput,
  wallTypeId: identifier.optional(),
  referenceLine: wallReferenceInput.optional(),
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
  storeyId: storeyIdInput,
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

const objectParameters = z.strictObject({
  position: wallPoint,
  storeyId: storeyIdInput,
});
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
  storeyId: storeyIdInput,
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
  lineWeightMm: z.number().min(0.05).max(2).optional(),
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
  fixtureInput.pick({ position: true, rotation: true, storeyId: true }).extend({
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

const buildingIdentity = {
  id: identifier,
  name: z.string().trim().min(1).max(80),
};
const footprintInput = z.array(modelPointInput).min(3).max(128);
const elevationOffset = z.int().min(-12_000).max(12_000);
const plateThickness = z.int().min(10).max(4000);
export const buildingElements = [
  z.strictObject({
    ...buildingIdentity,
    kind: z.literal("slab"),
    storeyId: identifier,
    footprint: footprintInput,
    thicknessMm: plateThickness,
    offsetMm: elevationOffset.default(0),
  }),
  z.strictObject({
    ...buildingIdentity,
    kind: z.literal("opening"),
    slabId: identifier,
    footprint: footprintInput,
  }),
  z.strictObject({
    ...buildingIdentity,
    kind: z.literal("stair"),
    fromStoreyId: identifier,
    toStoreyId: identifier,
    start: modelPointInput,
    end: modelPointInput,
    widthMm: z.int().min(300).max(8000),
    risers: z.int().min(2).max(80),
    openingSlabId: identifier.optional(),
  }),
  z.strictObject({
    ...buildingIdentity,
    kind: z.literal("roof"),
    storeyId: identifier,
    footprint: footprintInput,
    profile: z.enum(["flat", "shed", "gable"]),
    directionDeg: z.number().min(0).lt(360),
    pitchDeg: z.number().min(0).max(65),
    thicknessMm: plateThickness,
    offsetMm: elevationOffset.default(0),
  }),
] as const;
export const buildingElementInput = z.discriminatedUnion(
  "kind",
  buildingElements,
);
export const buildingViews = [
  z.strictObject({
    ...buildingIdentity,
    kind: z.literal("section"),
    start: modelPointInput,
    end: modelPointInput,
  }),
  z.strictObject({
    ...buildingIdentity,
    kind: z.literal("elevation"),
    direction: z.enum(["north", "south", "east", "west"]),
  }),
] as const;
export const buildingViewInput = z.discriminatedUnion("kind", buildingViews);
export type BuildingElement = z.infer<typeof buildingElementInput>;
export type Slab = Extract<BuildingElement, { kind: "slab" }>;
export type Stair = Extract<BuildingElement, { kind: "stair" }>;
export type Roof = Extract<BuildingElement, { kind: "roof" }>;
export type BuildingView = z.infer<typeof buildingViewInput>;

export const documentAnchorInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("point"), point: modelPointInput }),
  z.strictObject({
    kind: z.literal("wall"),
    id: identifier,
    end: z.enum(["start", "end"]),
  }),
  z.strictObject({
    kind: z.enum(["door", "window", "fixture"]),
    id: identifier,
  }),
]);
export type DocumentAnchor = z.infer<typeof documentAnchorInput>;

const note = z.string().trim().min(1).max(120);
const tagTarget = z.strictObject({
  kind: z.enum(["door", "window", "fixture"]),
  id: identifier,
});
const sheetSource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("plan"), storeyId: identifier }),
  z.strictObject({ kind: z.literal("building"), viewId: identifier }),
]);
const paperNumber = z.number().min(0).max(600);

export const documentItems = [
  z.strictObject({
    kind: z.literal("chain"),
    id: identifier,
    storeyId: identifier,
    anchors: z.array(documentAnchorInput).min(2).max(24),
    axis: z.enum(["horizontal", "vertical"]),
    offsetMm: coordinate,
  }),
  z.strictObject({
    kind: z.literal("leader"),
    id: identifier,
    storeyId: identifier,
    anchor: documentAnchorInput,
    labelAt: modelPointInput,
    text: note,
  }),
  z.strictObject({
    kind: z.literal("tag"),
    id: identifier,
    storeyId: identifier,
    target: tagTarget,
    labelAt: modelPointInput,
    text: z.string().trim().min(1).max(24),
  }),
  z.strictObject({
    kind: z.literal("hatch"),
    id: identifier,
    storeyId: identifier,
    polygon: z.array(modelPointInput).min(3).max(64),
    pattern: z.enum(["diagonal", "cross"]),
    spacingMm: z.int().min(25).max(5000),
  }),
  z.strictObject({
    kind: z.literal("view"),
    id: identifier,
    name: note,
    source: sheetSource,
    center: modelPointInput,
  }),
  z.strictObject({
    kind: z.literal("sheet"),
    id: identifier,
    number: z.string().trim().min(1).max(16),
    name: note,
    size: z.enum(["A4", "A3", "A2"]),
    orientation: z.enum(["landscape", "portrait"]),
    project: note.optional(),
    drawnBy: z.string().trim().min(1).max(48).optional(),
  }),
  z.strictObject({
    kind: z.literal("viewport"),
    id: identifier,
    sheetId: identifier,
    viewId: identifier,
    scale: z.int().min(1).max(5000),
    x: paperNumber,
    y: paperNumber,
    width: paperNumber.min(10),
    height: paperNumber.min(10),
  }),
  z.strictObject({
    kind: z.literal("finish"),
    id: identifier,
    storeyId: identifier,
    point: modelPointInput,
    room: note,
    floor: note,
    walls: note,
    ceiling: note,
  }),
] as const;
export const documentItemInput = z.discriminatedUnion("kind", documentItems);
export const documentItemLimit = 640;
export type DocumentItem = z.infer<typeof documentItemInput>;
export type Sheet = Extract<DocumentItem, { kind: "sheet" }>;
export type SheetViewport = Extract<DocumentItem, { kind: "viewport" }>;
export type NamedDrawingView = Extract<DocumentItem, { kind: "view" }>;
export type DrawingMark = Extract<
  DocumentItem,
  { kind: "chain" | "leader" | "tag" | "hatch" }
>;

const pixelPointInput = z.strictObject({
  x: z.number().min(0).max(2048),
  y: z.number().min(0).max(2048),
});
export const underlayCalibrationInput = z.strictObject({
  pixels: z.tuple([pixelPointInput, pixelPointInput]),
  model: z.tuple([modelPointInput, modelPointInput]),
});
export const underlayInput = z.strictObject({
  id: identifier,
  storeyId: identifier,
  name: z.string().trim().min(1).max(120),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("image") }),
    z.strictObject({
      kind: z.literal("pdf"),
      page: z.int().positive().max(1000),
    }),
  ]),
  raster: z
    .string()
    .max(500000)
    .regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/),
  width: z.int().positive().max(2048),
  height: z.int().positive().max(2048),
  opacity: z.number().min(0.1).max(0.8),
  visible: z.boolean(),
  calibration: underlayCalibrationInput,
});
export const underlayLimit = 4;
export type Underlay = z.infer<typeof underlayInput>;
export type UnderlayCalibration = z.infer<typeof underlayCalibrationInput>;

export const dxfUnits = ["mm", "cm", "m", "in", "ft"] as const;
export const drawingReferenceInput = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(120),
  storeyId: identifier,
  version: z.int().positive().max(2_147_483_647),
  unit: z.enum(dxfUnits),
  offset: modelPointInput,
  visible: z.boolean(),
  layers: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(80),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        lineStyle: z.enum(["solid", "dashed", "dotted"]),
      }),
    )
    .min(1)
    .max(64),
  shapes: z
    .array(
      z.strictObject({
        layer: z.string().min(1).max(80),
        geometry: sketchGeometry,
      }),
    )
    .min(1)
    .max(512),
});
export const drawingReferenceLimit = 6;
export type DrawingReference = z.infer<typeof drawingReferenceInput>;

const elevationMmInput = z.int().min(-100_000).max(100_000);
export const serviceSystemInput = z.enum(["electrical", "plumbing"]);
export const serviceNodeInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("point"),
    point: modelPointInput,
    zMm: elevationMmInput,
  }),
  z.strictObject({
    kind: z.literal("utility"),
    utilityId: identifier,
    zMm: elevationMmInput,
  }),
]);
const coordinationId = {
  id: identifier,
  storeyId: identifier,
  name: z.string().trim().min(1).max(100),
};
export const serviceRouteInput = z.strictObject({
  kind: z.literal("route"),
  ...coordinationId,
  system: serviceSystemInput,
  diameterMm: z.int().min(5).max(1000),
  nodes: z.array(serviceNodeInput).min(2).max(32),
});
export const equipmentZoneInput = z.strictObject({
  kind: z.literal("zone"),
  ...coordinationId,
  polygon: z.array(modelPointInput).min(3).max(64),
  bottomMm: elevationMmInput,
  topMm: elevationMmInput,
});
export const coordinationSubjectInput = z.strictObject({
  kind: z.enum([
    "route",
    "zone",
    "slab",
    "wall",
    "fixture",
    "door",
    "egress",
    "turning",
    "approach",
  ]),
  id: identifier,
});
export const coordinationFindingInput = z.strictObject({
  key: z.string().min(1).max(1000),
  rule: z.string().min(1).max(100),
  edition: z.string().min(1).max(100),
  storeyId: identifier,
  title: z.string().min(1).max(240),
  detail: z.string().min(1).max(480),
  subjects: z.array(coordinationSubjectInput).min(1).max(3),
  point: z.strictObject({
    x: z.number().min(-1_010_000).max(1_010_000),
    y: z.number().min(-1_010_000).max(1_010_000),
    z: z.number().min(-1_200_000).max(1_200_000),
  }),
  measuredMm: z.number().nonnegative().optional(),
  requiredMm: z.number().nonnegative().optional(),
  outline: z.array(pointSchema).min(3).max(64).optional(),
});
export const coordinationIssueInput = z.strictObject({
  kind: z.literal("issue"),
  id: identifier,
  finding: coordinationFindingInput,
  sourceRevision: z.int().min(0).max(2_147_483_647),
  note: z.string().trim().max(400).default(""),
  status: z.enum(["open", "resolved"]),
  ...authors,
});
export const reviewPackId = "us-ibc2021-ada2010-v1";
export const ruleProfileInput = z.strictObject({
  kind: z.literal("profile"),
  id: identifier,
  storeyId: identifier,
  pack: z.literal(reviewPackId),
  jurisdiction: z.string().trim().min(1).max(100),
  occupancy: z.enum(["B", "R-2"]).optional(),
  sprinkler: z.enum(["none", "nfpa13", "nfpa13r"]).optional(),
});
export const egressPathInput = z.strictObject({
  kind: z.literal("egress"),
  ...coordinationId,
  exitDoorId: identifier,
  waypoints: z.array(modelPointInput).min(1).max(64),
});
export const approachCheckInput = z.strictObject({
  kind: z.literal("approach"),
  ...coordinationId,
  doorId: identifier,
  side: z.enum(["front-pull", "front-push"]),
  closerAndLatch: z.boolean().optional(),
});
export const turningCheckInput = z.strictObject({
  kind: z.literal("turning"),
  ...coordinationId,
  center: modelPointInput,
});
export const accessCheckInput = z.discriminatedUnion("kind", [
  approachCheckInput,
  turningCheckInput,
]);
export type RuleProfile = z.infer<typeof ruleProfileInput>;
export type EgressPath = z.infer<typeof egressPathInput>;
export type ApproachCheck = z.infer<typeof approachCheckInput>;
export type TurningCheck = z.infer<typeof turningCheckInput>;

export const coordinationItemInput = z.discriminatedUnion("kind", [
  serviceRouteInput,
  equipmentZoneInput,
  coordinationIssueInput,
  ruleProfileInput,
  egressPathInput,
  approachCheckInput,
  turningCheckInput,
]);
export const coordinationLimit = 240;
export type ServiceRoute = z.infer<typeof serviceRouteInput>;
export type EquipmentZone = z.infer<typeof equipmentZoneInput>;
export type CoordinationIssue = z.infer<typeof coordinationIssueInput>;
export type CoordinationFinding = z.infer<typeof coordinationFindingInput>;
export type CoordinationSubject = z.infer<typeof coordinationSubjectInput>;
export type CoordinationItem = z.infer<typeof coordinationItemInput>;

export const planCommandSchema = z.union([
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("coordination.write"),
      item: coordinationItemInput,
    }),
    z.strictObject({ type: z.literal("coordination.remove"), id: identifier }),
  ]),
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("reference.write"),
      item: drawingReferenceInput,
    }),
    z.strictObject({ type: z.literal("reference.remove"), id: identifier }),
  ]),
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("underlay.write"), item: underlayInput }),
    z.strictObject({ type: z.literal("underlay.remove"), id: identifier }),
  ]),
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("document.write"),
      item: documentItemInput,
    }),
    z.strictObject({ type: z.literal("document.remove"), id: identifier }),
  ]),
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
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("storey.write"), storey: storeyInput }),
    z.strictObject({
      type: z.literal("wall_type.write"),
      wallType: wallTypeInput,
    }),
    z.strictObject({
      type: z.literal("wall.assembly"),
      id: identifier,
      wallTypeId: identifier.nullable(),
      referenceLine: wallReferenceInput,
    }),
  ]),
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("building.write"),
      item: buildingElementInput,
    }),
    z.strictObject({
      type: z.literal("building.view"),
      view: buildingViewInput,
    }),
    z.strictObject({
      type: z.literal("building.remove"),
      id: identifier,
      collection: z.enum(["elements", "views"]),
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
  storeyId: storeyIdInput,
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
  documentItems: z.array(documentItemInput).max(documentItemLimit).optional(),
  coordination: z
    .array(coordinationItemInput)
    .max(coordinationLimit)
    .optional(),
  underlays: z.array(underlayInput).max(underlayLimit).optional(),
  drawingReferences: z
    .array(drawingReferenceInput)
    .max(drawingReferenceLimit)
    .optional(),
  buildingElements: z.array(buildingElementInput).max(256).optional(),
  buildingViews: z.array(buildingViewInput).max(80).optional(),
  storeys: z.array(storeyInput).max(32).optional(),
  wallTypes: z.array(wallTypeInput).max(128).optional(),
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
