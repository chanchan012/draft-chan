import { utilityCatalog } from "./catalog";
import {
  bounds,
  boundsMeet,
  dot,
  fixtureFootprint,
  subtract,
  wallFootprint,
} from "./footprints";
import {
  compareText,
  type DraftPlanState,
  type Point,
  type Wall,
} from "./model";
import { pointAlong } from "./openings";

export const entityKinds = [
  "wall",
  "door",
  "window",
  "fixture",
  "utility",
  "dimension",
  "room",
] as const;
export const snapKinds = [
  "endpoint",
  "midpoint",
  "intersection",
  "perpendicular",
  "face",
] as const;
export const wallEdges = ["center", "positive", "negative"] as const;
export const lengthUnits = ["mm", "cm", "m", "in", "ft"] as const;
export type EntityKind = (typeof entityKinds)[number];
export type SnapKind = (typeof snapKinds)[number];
export type WallEdge = (typeof wallEdges)[number];
export type LengthUnit = (typeof lengthUnits)[number];
export const millimeters = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
} satisfies Record<LengthUnit, number>;

export type EntityRef = { kind: EntityKind; id: string };
type PlanObject =
  | DraftPlanState["walls"][number]
  | DraftPlanState["rooms"][number]
  | DraftPlanState["openings"][number]
  | NonNullable<DraftPlanState["windows"]>[number]
  | DraftPlanState["fixtures"][number]
  | DraftPlanState["utilities"][number]
  | NonNullable<DraftPlanState["annotations"]>[number];
type Envelope = ReturnType<typeof bounds>;
type Segment = { start: Point; end: Point };
export type WallRef = { wallId: string; edge: WallEdge };
export type SnapResult = {
  kind: SnapKind;
  point: Point;
  distanceMm: number;
  references: WallRef[];
};

function entries(
  plan: DraftPlanState,
  kinds = entityKinds as readonly EntityKind[],
) {
  const hosts = new Map(plan.walls.map((wall) => [wall.id, wall]));
  function entry(
    kind: EntityKind,
    entity: PlanObject,
    points: Point[],
    layer: string = kind,
  ) {
    return { kind, id: entity.id, layer, bounds: bounds(points), entity };
  }
  return kinds.flatMap((kind) => {
    switch (kind) {
      case "wall":
        return plan.walls.map((wall) =>
          entry(
            kind,
            wall,
            wallFootprint(wall.start, wall.end, wall.thicknessMm),
          ),
        );
      case "room":
        return plan.rooms.map((room) => entry(kind, room, room.polygon));
      case "door":
      case "window":
        return (kind === "door" ? plan.openings : (plan.windows ?? [])).flatMap(
          (opening) => {
            const wall = hosts.get(opening.wallId);
            if (!wall) return [];
            const start = pointAlong(
              wall,
              opening.offsetMm - opening.widthMm / 2,
            );
            const end = pointAlong(
              wall,
              opening.offsetMm + opening.widthMm / 2,
            );
            return [
              entry(
                kind,
                opening,
                wallFootprint(start, end, wall.thicknessMm),
                "openings",
              ),
            ];
          },
        );
      case "fixture":
        return plan.fixtures.map((fixture) =>
          entry(kind, fixture, fixtureFootprint(fixture), "furniture"),
        );
      case "utility":
        return plan.utilities.map((utility) =>
          entry(
            kind,
            utility,
            [utility.position],
            utilityCatalog[utility.template].layer,
          ),
        );
      case "dimension":
        return (plan.annotations ?? []).map((item) =>
          entry(kind, item, [item.start, item.end]),
        );
    }
  });
}

export function inspectEntity(plan: DraftPlanState, ref: EntityRef) {
  return entries(plan, [ref.kind]).find(({ id }) => id === ref.id);
}

export function queryEntities(
  plan: DraftPlanState,
  filter: {
    kind?: EntityKind;
    layer?: string;
    bounds?: Envelope;
    offset: number;
    limit: number;
  },
) {
  const matches = entries(plan, filter.kind ? [filter.kind] : undefined)
    .filter(
      (entry) =>
        (!filter.layer || entry.layer === filter.layer) &&
        (!filter.bounds || boundsMeet(entry.bounds, filter.bounds)),
    )
    .sort((a, b) => compareText(a.kind, b.kind) || compareText(a.id, b.id));
  const end = filter.offset + filter.limit;
  return {
    entities: matches
      .slice(filter.offset, end)
      .map(({ entity: _, ...summary }) => summary),
    total: matches.length,
    nextOffset: end < matches.length ? end : null,
  };
}

export function modelPrecision(point: Point): Point {
  return { x: Math.round(point.x) + 0, y: Math.round(point.y) + 0 };
}

function segmentFor(wall: Wall, edge: WallEdge): Segment {
  if (edge === "center") return { start: wall.start, end: wall.end };
  const [a, b, c, d] = wallFootprint(wall.start, wall.end, wall.thicknessMm);
  return edge === "positive" ? { start: d, end: c } : { start: a, end: b };
}

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const addAlong = (a: Point, direction: Point, t: number): Point => ({
  x: a.x + direction.x * t,
  y: a.y + direction.y * t,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function projection(point: Point, { start, end }: Segment, clamp = false) {
  const direction = subtract(end, start);
  const t = dot(subtract(point, start), direction) / dot(direction, direction);
  if (!clamp && (t < 0 || t > 1)) return;
  return addAlong(start, direction, clamp ? Math.max(0, Math.min(1, t)) : t);
}

function intersection(a: Segment, b: Segment) {
  const v = subtract(a.end, a.start);
  const w = subtract(b.end, b.start);
  const divisor = cross(v, w);
  if (Math.abs(divisor) <= 1e-10 * Math.hypot(v.x, v.y) * Math.hypot(w.x, w.y))
    return;
  const gap = subtract(b.start, a.start);
  const t = cross(gap, w) / divisor;
  const u = cross(gap, v) / divisor;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return addAlong(a.start, v, t);
}

export function resolveSnap(
  walls: readonly Wall[],
  point: Point,
  options: {
    radiusMm: number;
    modes?: readonly SnapKind[];
    anchor?: Point;
    ortho?: boolean;
  },
): SnapResult | undefined {
  const { radiusMm, modes = snapKinds, anchor, ortho } = options;
  const zone = {
    left: point.x - radiusMm,
    right: point.x + radiusMm,
    top: point.y - radiusMm,
    bottom: point.y + radiusMm,
  };
  const near = walls.filter((wall) =>
    boundsMeet(
      zone,
      bounds([wall.start, wall.end]),
      modes.includes("face") ? wall.thicknessMm / 2 : 0,
    ),
  );
  let best: SnapResult | undefined;
  let bestKey = "";
  function offer(
    kind: SnapKind,
    snapped: Point | undefined,
    references: WallRef[],
  ) {
    if (!snapped) return;
    const rounded = modelPrecision(snapped);
    if (anchor) {
      const start = modelPrecision(anchor);
      if (
        (rounded.x === start.x && rounded.y === start.y) ||
        (ortho && rounded.x !== start.x && rounded.y !== start.y)
      )
        return;
    }
    const distanceMm = distance(point, snapped);
    if (distanceMm > radiusMm) return;
    const key = JSON.stringify([snapKinds.indexOf(kind), references]);
    if (
      !best ||
      distanceMm < best.distanceMm - 1e-8 ||
      (Math.abs(distanceMm - best.distanceMm) <= 1e-8 && key < bestKey)
    ) {
      best = { kind, point: snapped, distanceMm, references };
      bestKey = key;
    }
  }
  const ordered = near.sort((a, b) => compareText(a.id, b.id));
  for (const [i, wall] of ordered.entries()) {
    const center: WallRef = { wallId: wall.id, edge: "center" };
    if (modes.includes("endpoint")) {
      offer("endpoint", wall.start, [center]);
      offer("endpoint", wall.end, [center]);
    }
    if (modes.includes("midpoint")) {
      offer(
        "midpoint",
        addAlong(wall.start, subtract(wall.end, wall.start), 0.5),
        [center],
      );
    }
    if (anchor && modes.includes("perpendicular")) {
      offer("perpendicular", projection(anchor, wall), [center]);
    }
    if (modes.includes("face")) {
      for (const edge of ["positive", "negative"] as const) {
        offer("face", projection(anchor ?? point, segmentFor(wall, edge)), [
          { wallId: wall.id, edge },
        ]);
      }
    }
    if (modes.includes("intersection")) {
      for (let j = i + 1; j < ordered.length; j++) {
        offer("intersection", intersection(wall, ordered[j]), [
          center,
          { wallId: ordered[j].id, edge: "center" },
        ]);
      }
    }
  }
  return best;
}

export function measurePoints(
  start: Point,
  end: Point,
  unit: LengthUnit = "mm",
) {
  const distanceMm = distance(start, end);
  return {
    start,
    end,
    distanceMm,
    value: distanceMm / millimeters[unit],
    unit,
  };
}

export function measureWallEdges(
  walls: readonly Wall[],
  from: WallRef,
  to: WallRef,
  unit: LengthUnit,
) {
  const first = walls.find(({ id }) => id === from.wallId);
  const second = walls.find(({ id }) => id === to.wallId);
  if (!first || !second) return;
  const a = segmentFor(first, from.edge);
  const b = segmentFor(second, to.edge);
  const crossing = intersection(a, b);
  const candidates: [Point, Point][] = crossing
    ? [[crossing, crossing]]
    : [
        [a.start, projection(a.start, b, true)!],
        [a.end, projection(a.end, b, true)!],
        [projection(b.start, a, true)!, b.start],
        [projection(b.end, a, true)!, b.end],
      ];
  const [start, end] = candidates.reduce((best, next) =>
    distance(...next) < distance(...best) ? next : best,
  );
  return { ...measurePoints(start, end, unit), references: [from, to] };
}
