import {
  compareText,
  draftPlanSchema,
  wallSchema,
  type DraftActor,
  type DraftPlanState,
  type Point,
  type Wall,
} from "./model";
import { entityKey, validateOrganization } from "./organization";
import { validateConstraints } from "./constraints";
import { validateOpenings } from "./openings";
import { polygonAreaMm2 } from "./polygon";
import { validateBuilding } from "./building";
import { storeyRooms, validateStoreys } from "./storeys";
import { solveWallTopology } from "./wall-topology";

function rectangleWalls(corners: Point[], author?: DraftActor): Wall[] {
  return corners.map((start, index) =>
    wallSchema.parse({
      id: "starter-wall-" + (index + 1),
      start,
      end: corners[(index + 1) % corners.length],
      thicknessMm: 120,
      kind: "interior",
      ...(author ? { createdBy: author, updatedBy: author } : {}),
    }),
  );
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function initialGraph(
  room?: { width: number; depth: number },
  author?: DraftActor,
): DraftPlanState {
  const walls = room
    ? rectangleWalls(rectangle(0, 0, room.width, room.depth), author)
    : [];
  return {
    version: 1,
    walls,
    rooms: solveWallTopology(walls).rooms,
    openings: [],
    fixtures: [],
    utilities: [],
    dimensions: [],
  };
}

export function loadDraftPlan(input: unknown): DraftPlanState {
  // Saved plans are JSON. Detach the input before the store freezes history.
  const state = draftPlanSchema.parse(structuredClone(input));
  if (!state.walls.length && state.rooms.length) {
    const [legacy] = state.rooms;
    const points = legacy.polygon;
    if (
      state.rooms.length !== 1 ||
      points.length !== 4 ||
      legacy.holes?.length
    ) {
      throw new Error("A room-only plan must contain one rectangular starter.");
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const corners = rectangle(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    );
    if (
      polygonAreaMm2(points) !== polygonAreaMm2(corners) ||
      new Set(points.map((p) => `${p.x},${p.y}`)).size !== 4 ||
      !corners.every((corner) =>
        points.some((p) => p.x === corner.x && p.y === corner.y),
      )
    )
      throw new Error("A room-only plan must contain one rectangular starter.");
    state.walls = rectangleWalls(corners);
  }
  if (new Set(state.walls.map((wall) => wall.id)).size !== state.walls.length) {
    throw new Error("A plan must have unique wall IDs.");
  }
  validateOpenings(state.walls, [...state.openings, ...(state.windows ?? [])]);
  state.walls.sort((a, b) => compareText(a.id, b.id));
  state.openings.sort((a, b) => compareText(a.id, b.id));
  state.windows?.sort((a, b) => compareText(a.id, b.id));
  for (const placements of [
    state.fixtures,
    state.utilities,
    state.annotations ?? [],
    state.sketches ?? [],
    state.constraints ?? [],
    state.buildingElements ?? [],
    state.buildingViews ?? [],
    state.drawingLayers ?? [],
    state.blocks ?? [],
    state.blockInstances ?? [],
  ]) {
    if (new Set(placements.map(({ id }) => id)).size !== placements.length) {
      throw new Error("Placement IDs must be unique on each layer.");
    }
    placements.sort((a, b) => compareText(a.id, b.id));
  }
  for (const layer of state.drawingLayers ?? [])
    layer.members.sort((a, b) => compareText(entityKey(a), entityKey(b)));
  state.storeys?.sort((a, b) => compareText(a.id, b.id));
  state.wallTypes?.sort((a, b) => compareText(a.id, b.id));
  validateStoreys(state);
  validateBuilding(state);
  validateOrganization(state);
  validateConstraints(state.walls, state.constraints);
  state.rooms = storeyRooms(state.walls);
  return state;
}
