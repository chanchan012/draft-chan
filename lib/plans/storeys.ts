import {
  compareText,
  defaultStoreyId,
  type Constraint,
  type DraftActor,
  type DraftPlanState,
  type PlanCommand,
  type Storey,
  type WallType,
} from "./model";
import { solveWallTopology } from "./wall-topology";

export const groundStorey: Storey = Object.freeze({
  id: defaultStoreyId,
  name: "Ground floor",
  elevationMm: 0,
  wallHeightMm: 2450,
});
export const storeyOf = (entity: { storeyId?: string }) =>
  entity.storeyId ?? defaultStoreyId;
export const planStoreys = (plan: Pick<DraftPlanState, "storeys">) =>
  plan.storeys ?? [groundStorey];
export function storeyById(
  plan: Pick<DraftPlanState, "storeys">,
  id: string = defaultStoreyId,
) {
  const level = planStoreys(plan).find((item) => item.id === id);
  if (!level) throw new Error("Storey " + id + " is unavailable.");
  return level;
}
export const assemblyThickness = (type: WallType) =>
  type.layers.reduce((sum, layer) => sum + layer.thicknessMm, 0);

function constraintWalls(c: Constraint) {
  return "first" in c
    ? [c.first.wallId, c.second.wallId]
    : [c.firstWallId, c.secondWallId];
}

export function validateStoreys(plan: DraftPlanState) {
  const levels = planStoreys(plan);
  const known = new Set(levels.map((level) => level.id));
  if (!known.has(defaultStoreyId) || known.size !== levels.length)
    throw new Error("Include the ground storey and use distinct storey IDs.");
  if (new Set(levels.map((level) => level.elevationMm)).size !== levels.length)
    throw new Error("Each storey needs a distinct elevation.");
  if (
    new Set(levels.map((level) => level.name.toLowerCase())).size !==
    levels.length
  )
    throw new Error("Each storey needs a distinct name.");
  for (const item of [
    ...plan.walls,
    ...plan.fixtures,
    ...plan.utilities,
    ...(plan.annotations ?? []),
    ...(plan.sketches ?? []),
  ])
    if (!known.has(storeyOf(item)))
      throw new Error(
        "Object " + item.id + " references an unavailable storey.",
      );
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  for (const c of plan.constraints ?? []) {
    const [a, b] = constraintWalls(c).map((id) => walls.get(id));
    if (a && b && storeyOf(a) !== storeyOf(b))
      throw new Error("Constraint " + c.id + " crosses storeys.");
  }
  const assemblies = plan.wallTypes ?? [];
  if (
    new Set(assemblies.map((type) => type.id)).size !== assemblies.length ||
    new Set(assemblies.map((type) => type.name.toLowerCase())).size !==
      assemblies.length
  )
    throw new Error("Wall assemblies need distinct IDs and names.");
  for (const wall of plan.walls) {
    if (!wall.wallTypeId) continue;
    const type = assemblies.find((item) => item.id === wall.wallTypeId);
    if (!type || wall.thicknessMm !== assemblyThickness(type))
      throw new Error("Wall " + wall.id + " has an invalid assembly.");
  }
  for (const opening of plan.windows ?? []) {
    const host = walls.get(opening.wallId);
    if (
      host &&
      opening.heightMm + opening.sillMm >
        storeyById(plan, storeyOf(host)).wallHeightMm
    )
      throw new Error(
        "Window " + opening.id + " exceeds its storey wall height.",
      );
  }
}

export function resolveWallTypes(plan: DraftPlanState, actor: DraftActor) {
  if (!plan.wallTypes?.length) return;
  const thickness = new Map(
    plan.wallTypes.map((type) => [type.id, assemblyThickness(type)]),
  );
  for (const [i, wall] of plan.walls.entries()) {
    const next = wall.wallTypeId && thickness.get(wall.wallTypeId);
    if (next && wall.thicknessMm !== next)
      plan.walls[i] = { ...wall, thicknessMm: next, updatedBy: actor };
  }
}

export function storeyRooms(walls: DraftPlanState["walls"]) {
  const groups = new Map<string, DraftPlanState["walls"]>();
  for (const wall of walls) {
    const id = storeyOf(wall);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(wall);
  }
  return [...groups]
    .sort(([a], [b]) => compareText(a, b))
    .flatMap(([storeyId, walls]) =>
      solveWallTopology(walls).rooms.map((room) =>
        storeyId === defaultStoreyId
          ? room
          : { ...room, storeyId, id: "level:" + storeyId + ":" + room.id },
      ),
    );
}

export function storeyPlan(
  plan: DraftPlanState,
  storeyId: string,
): DraftPlanState {
  const matches = (item: { storeyId?: string }) => storeyOf(item) === storeyId;
  const walls = plan.walls.filter(matches);
  const wallIds = new Set(walls.map((wall) => wall.id));
  return {
    ...plan,
    walls,
    rooms: plan.rooms.filter(matches),
    openings: plan.openings.filter((item) => wallIds.has(item.wallId)),
    windows: plan.windows?.filter((item) => wallIds.has(item.wallId)),
    fixtures: plan.fixtures.filter(matches),
    utilities: plan.utilities.filter(matches),
    annotations: plan.annotations?.filter(matches),
    sketches: plan.sketches?.filter(matches),
    constraints: plan.constraints?.filter((c) =>
      constraintWalls(c).every((id) => wallIds.has(id)),
    ),
  };
}

export function onStorey(command: PlanCommand, id: string): PlanCommand {
  if (id === defaultStoreyId) return command;
  const storeyId = id;
  switch (command.type) {
    case "wall.add":
      return {
        ...command,
        wall: { ...command.wall, storeyId: command.wall.storeyId ?? storeyId },
      };
    case "fixture.add":
      return {
        ...command,
        fixture: {
          ...command.fixture,
          storeyId: command.fixture.storeyId ?? storeyId,
        },
      };
    case "utility.add":
      return {
        ...command,
        utility: {
          ...command.utility,
          storeyId: command.utility.storeyId ?? storeyId,
        },
      };
    case "sketch.add":
      return {
        ...command,
        sketch: {
          ...command.sketch,
          storeyId: command.sketch.storeyId ?? storeyId,
        },
      };
    case "dimension.add":
      return {
        ...command,
        annotation: {
          ...command.annotation,
          storeyId: command.annotation.storeyId ?? storeyId,
        },
      };
    case "block.insert":
      return command.placement.kind === "fixture"
        ? {
            ...command,
            placement: {
              ...command.placement,
              storeyId: command.placement.storeyId ?? storeyId,
            },
          }
        : command;
    default:
      return command;
  }
}
