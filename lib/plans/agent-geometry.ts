import { fixtureCatalog, type FixtureKind } from "./catalog";
import { bounds, boundsMeet, fixtureFootprint } from "./footprints";
import {
  type Door,
  type DraftPlanState,
  type Fixture,
  type Point,
  type Room,
  type Wall,
} from "./model";
import { doorBounds, pointAlong, wallLength } from "./openings";
import { storeyOf } from "./storeys";
import { loadDraftPlan } from "./plan-state";
import { inRoom, polygonAreaMm2 } from "./polygon";

const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const direction = (a: Point, b: Point) => ({ x: b.x - a.x, y: b.y - a.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

export function wallById(plan: DraftPlanState, id: string) {
  const wall = plan.walls.find((candidate) => candidate.id === id);
  if (!wall)
    throw new Error(
      "Wall unavailable. Read the floorplan graph for current IDs.",
    );
  return wall;
}

function remapOpenings(
  plan: DraftPlanState,
  map: (
    id: string,
    offset: number,
    width: number,
  ) => { wallId: string; offsetMm: number; reversed: boolean } | null,
) {
  const remap = (opening: Pick<Door, "wallId" | "offsetMm" | "widthMm">) =>
    map(opening.wallId, opening.offsetMm, opening.widthMm);
  return {
    openings: plan.openings.map((opening) => {
      const next = remap(opening);
      return next
        ? {
            ...opening,
            wallId: next.wallId,
            offsetMm: next.offsetMm,
            hinge: next.reversed
              ? ((opening.hinge === "start" ? "end" : "start") as Door["hinge"])
              : opening.hinge,
          }
        : opening;
    }),
    windows: plan.windows?.map((window) => {
      const next = remap(window);
      return next
        ? { ...window, wallId: next.wallId, offsetMm: next.offsetMm }
        : window;
    }),
  };
}

export function splitWall(
  plan: DraftPlanState,
  id: string,
  point: Point,
  newId: string,
) {
  const wall = wallById(plan, id);
  const heading = direction(wall.start, wall.end);
  const along = dot(heading, direction(wall.start, point));
  if (
    cross(wall.start, wall.end, point) !== 0 ||
    along <= 0 ||
    along >= dot(heading, heading)
  )
    throw new Error(
      "The split point must be strictly inside the wall centerline.",
    );
  const distance = wallLength({ start: wall.start, end: point });
  const mapped = remapOpenings(plan, (wallId, offsetMm, widthMm) => {
    if (wallId !== id) return null;
    const [low, high] = doorBounds({ offsetMm, widthMm });
    if (low < distance && high > distance)
      throw new Error("The split point crosses a hosted opening.");
    return low >= distance
      ? {
          wallId: newId,
          offsetMm: Math.round(offsetMm - distance),
          reversed: false,
        }
      : null;
  });
  return loadDraftPlan({
    ...plan,
    ...mapped,
    rooms: [],
    walls: [
      ...plan.walls.filter((item) => item.id !== id),
      { ...wall, end: point },
      {
        id: newId,
        start: point,
        end: wall.end,
        kind: wall.kind,
        thicknessMm: wall.thicknessMm,
        ...(wall.storeyId ? { storeyId: wall.storeyId } : {}),
        ...(wall.wallTypeId ? { wallTypeId: wall.wallTypeId } : {}),
        ...(wall.referenceLine ? { referenceLine: wall.referenceLine } : {}),
      },
    ],
  });
}

export function joinWalls(plan: DraftPlanState, first: string, second: string) {
  const a = wallById(plan, first);
  const b = wallById(plan, second);
  if (
    a.id === b.id ||
    storeyOf(a) !== storeyOf(b) ||
    a.kind !== b.kind ||
    a.thicknessMm !== b.thicknessMm ||
    a.wallTypeId !== b.wallTypeId ||
    (a.referenceLine ?? "center") !== (b.referenceLine ?? "center")
  )
    throw new Error(
      "Join two distinct walls with matching thickness and kind.",
    );
  const joint = [a.start, a.end].find(
    (point) => equal(point, b.start) || equal(point, b.end),
  );
  if (!joint) throw new Error("The walls must share an endpoint.");
  const start = equal(joint, a.start) ? a.end : a.start;
  const end = equal(joint, b.start) ? b.end : b.start;
  if (
    cross(start, joint, end) !== 0 ||
    dot(direction(joint, start), direction(joint, end)) >= 0
  )
    throw new Error(
      "The walls must continue in a straight line without overlapping.",
    );
  const heading = direction(start, end);
  const sameDirection = (wall: Wall) =>
    dot(direction(wall.start, wall.end), heading) > 0;
  if (
    a.referenceLine &&
    a.referenceLine !== "center" &&
    sameDirection(a) !== sameDirection(b)
  )
    throw new Error(
      "Face-aligned walls must have compatible reference directions.",
    );
  const length = wallLength({ start, end });
  const mapped = remapOpenings(plan, (wallId, offset) => {
    const wall = wallId === a.id ? a : wallId === b.id ? b : null;
    if (!wall) return null;
    return {
      wallId: a.id,
      offsetMm: Math.round(
        dot(direction(start, pointAlong(wall, offset)), heading) / length,
      ),
      reversed: dot(direction(wall.start, wall.end), heading) < 0,
    };
  });
  return loadDraftPlan({
    ...plan,
    ...mapped,
    rooms: [],
    walls: [
      ...plan.walls.filter(({ id }) => id !== a.id && id !== b.id),
      {
        ...a,
        start,
        end,
        referenceLine:
          a.referenceLine === "center" || !a.referenceLine || sameDirection(a)
            ? a.referenceLine
            : a.referenceLine === "positive"
              ? "negative"
              : "positive",
      },
    ],
  });
}

export function spatialAudit(plan: DraftPlanState) {
  const rooms = plan.rooms.map(({ id, polygon, holes }) => ({
    id,
    areaM2: polygonAreaMm2(polygon, holes) / 1_000_000,
    polygon,
  }));
  const doorwayClearances = plan.openings.map((door) => ({
    id: door.id,
    wallId: door.wallId,
    modeledWidthMm: door.widthMm,
    benchmarkMm: 815,
  }));
  const adjacency = plan.openings.map((door) => {
    const wall = wallById(plan, door.wallId);
    const center = pointAlong(wall, door.offsetMm);
    const heading = direction(wall.start, wall.end);
    const distance = (wall.thicknessMm / 2 + 10) / wallLength(wall);
    const onSide = (side: number) =>
      plan.rooms.find(
        (room) =>
          storeyOf(room) === storeyOf(wall) &&
          inRoom(room, {
            x: center.x - heading.y * distance * side,
            y: center.y + heading.x * distance * side,
          }),
      )?.id ?? null;
    return { doorwayId: door.id, first: onSide(1), second: onSide(-1) };
  });
  return { rooms, doorwayClearances, adjacency };
}

export const roomPresets = {
  bedroom: ["queenBed", "wardrobe"],
  living: ["sofa", "coffeeTable"],
  kitchen: ["kitchenSink", "baseCabinet"],
  bath: ["toilet", "vanity"],
} as const satisfies Record<string, readonly FixtureKind[]>;

function fitsRoom(room: Room, fixture: Fixture) {
  const corners = fixtureFootprint(fixture);
  if (!corners.every((point) => inRoom(room, point))) return false;
  const { left, right, top, bottom } = bounds(corners);
  return ![room.polygon, ...(room.holes ?? [])].some((ring) =>
    ring.some((vertex, i) => {
      if (
        vertex.x >= left &&
        vertex.x <= right &&
        vertex.y >= top &&
        vertex.y <= bottom
      )
        return true;
      const next = ring[(i + 1) % ring.length];
      return corners.some((a, j) => {
        const b = corners[(j + 1) % corners.length];
        return (
          cross(a, b, vertex) * cross(a, b, next) < 0 &&
          cross(vertex, next, a) * cross(vertex, next, b) < 0
        );
      });
    }),
  );
}

export function furnishRoom(
  plan: DraftPlanState,
  roomId: string,
  preset: keyof typeof roomPresets,
) {
  const room = plan.rooms.find(({ id }) => id === roomId);
  if (!room)
    throw new Error(
      "Room unavailable. Read the spatial audit for current room IDs.",
    );
  const { left, right, top, bottom } = bounds(room.polygon);
  const occupied = plan.fixtures
    .filter((fixture) => storeyOf(fixture) === storeyOf(room))
    .map((fixture) => bounds(fixtureFootprint(fixture)));
  const fixtures: Fixture[] = [];
  for (const template of roomPresets[preset]) {
    const { widthMm, depthMm, heightMm } = fixtureCatalog[template];
    let found: Fixture | undefined;
    const id = crypto.randomUUID();
    for (const rotation of [0, 90] as const) {
      for (let row = 1; row <= 18 && !found; row++) {
        for (let col = 1; col <= 18 && !found; col++) {
          const candidate = {
            id,
            ...(room.storeyId ? { storeyId: room.storeyId } : {}),
            template,
            widthMm,
            depthMm,
            heightMm,
            rotation,
            position: {
              x: Math.round(left + ((right - left) * col) / 19),
              y: Math.round(top + ((bottom - top) * row) / 19),
            },
          };
          const outline = bounds(fixtureFootprint(candidate));
          if (occupied.some((other) => boundsMeet(outline, other, 100)))
            continue;
          if (
            !fitsRoom(room, {
              ...candidate,
              widthMm: widthMm + 300,
              depthMm: depthMm + 300,
            })
          )
            continue;
          found = candidate;
          occupied.push(outline);
        }
      }
      if (found) break;
    }
    if (!found)
      throw new Error("The entire preset could not fit in this room.");
    fixtures.push(found);
  }
  return fixtures;
}
