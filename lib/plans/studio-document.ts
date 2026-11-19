import { z } from "zod";
import {
  displayUnits,
  doorInput,
  fixtureInput,
  utilityInput,
  placementLimit,
  openingLimit,
  wallInput,
  wallLimit,
  wallSchema,
  type DisplayUnit,
  type Door,
  type Fixture,
  type Utility,
  type DraftActor,
  type DraftPlanState,
  type Wall,
} from "./model";
import { loadDraftPlan } from "./plan-state";

export interface StudioDocument {
  id: string;
  name: string;
  revision: number;
  unit: DisplayUnit;
  graph: DraftPlanState;
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
  };
}

function attribute<T extends Wall | Door | Fixture | Utility>(
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
  return loadDraftPlan({
    ...previous,
    walls,
    openings,
    fixtures,
    utilities,
    rooms: [],
  });
}
