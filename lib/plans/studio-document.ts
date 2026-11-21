import { z } from "zod";
import {
  displayUnits,
  constraintInput,
  drawingLayerInput,
  blockInput,
  blockInstanceInput,
  constraintLimit,
  doorInput,
  fixtureInput,
  utilityInput,
  placementLimit,
  openingLimit,
  wallInput,
  wallLimit,
  wallSchema,
  windowInput,
  annotationInput,
  sketchInput,
  type Sketch,
  type DisplayUnit,
  type Door,
  type Fixture,
  type Utility,
  type DraftActor,
  type DraftPlanState,
  type Wall,
  type WindowOpening,
  type DimensionAnnotation,
} from "./model";
import { hasOrganization, reconcileOrganization } from "./organization";
import { loadDraftPlan } from "./plan-state";

export interface StudioDocument {
  id: string;
  name: string;
  revision: number;
  unit: DisplayUnit;
  graph: DraftPlanState;
  agentBatch?: { id: string; agentId: string };
}

export const saveStudioSchema = z.strictObject({
  revision: z.int().nonnegative().max(2_147_483_646),
  unit: displayUnits,
  walls: z
    .array(wallInput.refine((wall) => wallSchema.safeParse(wall).success))
    .max(wallLimit),
  openings: z.array(doorInput).max(openingLimit),
  fixtures: z.array(fixtureInput).max(placementLimit).optional(),
  utilities: z.array(utilityInput).max(placementLimit).optional(),
  windows: z.array(windowInput).max(openingLimit).optional(),
  drawingLayers: z.array(drawingLayerInput).max(64).optional(),
  blocks: z.array(blockInput).max(128).optional(),
  blockInstances: z.array(blockInstanceInput).max(3072).optional(),
  constraints: z.array(constraintInput).max(constraintLimit).optional(),
  sketches: z.array(sketchInput).max(placementLimit).optional(),
  annotations: z.array(annotationInput).max(placementLimit).optional(),
});
export type StudioSave = z.infer<typeof saveStudioSchema>;

export function studioSnapshot(plan: DraftPlanState, unit: DisplayUnit) {
  return {
    unit,
    walls: plan.walls.map((wall) => wallInput.strip().parse(wall)),
    openings: plan.openings.map((door) => doorInput.strip().parse(door)),
    fixtures: plan.fixtures.map((fixture) =>
      fixtureInput.strip().parse(fixture),
    ),
    utilities: plan.utilities.map((utility) =>
      utilityInput.strip().parse(utility),
    ),
    windows: (plan.windows ?? []).map((opening) =>
      windowInput.strip().parse(opening),
    ),
    drawingLayers: (plan.drawingLayers ?? []).map((item) =>
      drawingLayerInput.parse(item),
    ),
    blocks: (plan.blocks ?? []).map((item) => blockInput.parse(item)),
    blockInstances: (plan.blockInstances ?? []).map((item) =>
      blockInstanceInput.parse(item),
    ),
    constraints: (plan.constraints ?? []).map((c) => constraintInput.parse(c)),
    sketches: (plan.sketches ?? []).map((item) =>
      sketchInput.strip().parse(item),
    ),
    annotations: (plan.annotations ?? []).map((annotation) =>
      annotationInput.strip().parse(annotation),
    ),
  };
}

function attribute<
  T extends
    | Sketch
    | Wall
    | Door
    | Fixture
    | Utility
    | WindowOpening
    | DimensionAnnotation,
>(
  input: Omit<T, "createdBy" | "updatedBy">,
  previous: T | undefined,
  actor: DraftActor,
  schema: { parse(value: unknown): typeof input },
) {
  if (!previous) return { ...input, createdBy: actor, updatedBy: actor };
  if (JSON.stringify(input) === JSON.stringify(schema.parse(previous)))
    return previous;
  return {
    ...input,
    ...(previous.createdBy ? { createdBy: previous.createdBy } : {}),
    updatedBy: actor,
  };
}

export function applyStudioSnapshot(
  previous: DraftPlanState,
  input: StudioSave,
  actor: DraftActor,
) {
  const wallsById = new Map(previous.walls.map((wall) => [wall.id, wall]));
  const doorsById = new Map(previous.openings.map((door) => [door.id, door]));
  const walls = input.walls.map((wall) =>
    attribute<Wall>(wall, wallsById.get(wall.id), actor, wallInput.strip()),
  );
  const openings = input.openings.map((door) =>
    attribute<Door>(door, doorsById.get(door.id), actor, doorInput.strip()),
  );
  const priorFixtures = new Map(
    previous.fixtures.map((fixture) => [fixture.id, fixture]),
  );
  const priorUtilities = new Map(
    previous.utilities.map((utility) => [utility.id, utility]),
  );
  const fixtures =
    input.fixtures?.map((fixture) =>
      attribute<Fixture>(
        fixture,
        priorFixtures.get(fixture.id),
        actor,
        fixtureInput.strip(),
      ),
    ) ?? previous.fixtures;
  const utilities =
    input.utilities?.map((utility) =>
      attribute<Utility>(
        utility,
        priorUtilities.get(utility.id),
        actor,
        utilityInput.strip(),
      ),
    ) ?? previous.utilities;
  const priorWindows = new Map(
    previous.windows?.map((window) => [window.id, window]),
  );
  const priorAnnotations = new Map(
    previous.annotations?.map((annotation) => [annotation.id, annotation]),
  );
  const windows =
    input.windows?.map((window) =>
      attribute<WindowOpening>(
        window,
        priorWindows.get(window.id),
        actor,
        windowInput.strip(),
      ),
    ) ?? previous.windows;
  const annotations =
    input.annotations?.map((annotation) =>
      attribute<DimensionAnnotation>(
        annotation,
        priorAnnotations.get(annotation.id),
        actor,
        annotationInput.strip(),
      ),
    ) ?? previous.annotations;
  const priorSketches = new Map(
    previous.sketches?.map((item) => [item.id, item]),
  );
  const sketches =
    input.sketches?.map((item) =>
      attribute<Sketch>(
        item,
        priorSketches.get(item.id),
        actor,
        sketchInput.strip(),
      ),
    ) ?? previous.sketches;
  const next: DraftPlanState = {
    ...previous,
    walls,
    openings,
    fixtures,
    utilities,
    windows,
    annotations,
    sketches,
    constraints: input.constraints ?? previous.constraints,
    drawingLayers: input.drawingLayers ?? previous.drawingLayers,
    blocks: input.blocks ?? previous.blocks,
    blockInstances: input.blockInstances ?? previous.blockInstances,
    rooms: [],
  };
  if (!hasOrganization(previous) && !hasOrganization(next))
    return loadDraftPlan(next);
  const candidate = structuredClone(next);
  reconcileOrganization(previous, candidate, actor);
  return loadDraftPlan(candidate);
}
