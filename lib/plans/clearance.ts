import { fixtureCatalog } from "./catalog";
import {
  bounds,
  boundsMeet,
  dot,
  fixtureFootprint,
  length,
  subtract,
  wallFootprint,
} from "./footprints";
import { doorSwing, wallRuns } from "./openings";
import type { DraftPlanState, Point } from "./model";

// Published metric values in 2010 ADA Standards §§ 404.2.3 and 403.5.1.
export const doorwayMinimumMm = 815;
export const walkwayMinimumMm = 915;
const minimumOpposingEdgeMm = 300;
const epsilon = 0.0001;
const issueLimit = 200;

export type ClearanceIssue = {
  id: string;
  kind: "door-width" | "door-swing" | "collision" | "walkway";
  title: string;
  detail: string;
  polygons?: Point[][];
  segment?: [Point, Point];
  measuredMm?: number;
  requiredMm?: number;
};

type Shape = {
  key: string;
  entity: string;
  label: string;
  polygon: Point[];
  bounds: ReturnType<typeof bounds>;
  edges: Edge[];
};
type Edge = { a: Point; direction: Point; outward: Point; length: number };
const advance = (p: Point, v: Point, scale: number): Point => ({
  x: p.x + v.x * scale,
  y: p.y + v.y * scale,
});

function edges(polygon: Point[]): Edge[] {
  return polygon.map((a, index) => {
    const vector = subtract(polygon[(index + 1) % polygon.length], a);
    const span = length(vector);
    const direction = { x: vector.x / span, y: vector.y / span };
    return {
      a,
      direction,
      length: span,
      outward: { x: direction.y, y: -direction.x },
    };
  });
}

function projected(polygon: readonly Point[], axis: Point) {
  let low = Infinity,
    high = -Infinity;
  for (const point of polygon) {
    const value = dot(point, axis);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return { low, high };
}

function overlaps(a: Shape, b: Shape) {
  if (!boundsMeet(a.bounds, b.bounds)) return false;
  for (const { outward } of [...a.edges, ...b.edges]) {
    const p = projected(a.polygon, outward);
    const q = projected(b.polygon, outward);
    if (Math.min(p.high, q.high) - Math.max(p.low, q.low) <= epsilon)
      return false;
  }
  return true;
}

function shape(
  key: string,
  entity: string,
  label: string,
  polygon: Point[],
): Shape {
  return {
    key,
    entity,
    label,
    polygon,
    bounds: bounds(polygon),
    edges: edges(polygon),
  };
}

function clipPositive(polygon: Point[], axis: "x" | "y") {
  const result: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (a[axis] >= 0) result.push(a);
    if ((a[axis] > 0 && b[axis] < 0) || (a[axis] < 0 && b[axis] > 0)) {
      result.push(advance(a, subtract(b, a), a[axis] / (a[axis] - b[axis])));
    }
  }
  return result;
}

// Clip the obstacle to the quadrant between the closed and open door leaves.
// The closest point in that clipped polygon then gives exact circular-sector clearance.
function swingIntersects(
  hinge: Point,
  u: Point,
  v: Point,
  radius: number,
  polygon: Point[],
) {
  const local = polygon.map((p) => {
    const d = subtract(p, hinge);
    return { x: dot(d, u), y: dot(d, v) };
  });
  const clipped = clipPositive(clipPositive(local, "x"), "y");
  if (clipped.length < 3) return false;
  let twiceArea = 0;
  let nearest = Infinity;
  let sumX = 0,
    sumY = 0;
  for (let i = 0; i < clipped.length; i++) {
    const a = clipped[i],
      b = clipped[(i + 1) % clipped.length];
    twiceArea += a.x * b.y - b.x * a.y;
    const direction = subtract(b, a);
    const squared = dot(direction, direction);
    const t = squared
      ? Math.max(0, Math.min(1, -dot(a, direction) / squared))
      : 0;
    nearest = Math.min(nearest, length(advance(a, direction, t)));
    sumX += a.x;
    sumY += a.y;
  }
  return (
    Math.abs(twiceArea) > epsilon &&
    sumX > epsilon &&
    sumY > epsilon &&
    nearest < radius - epsilon
  );
}

function gapBetween(first: Shape, second: Shape, obstacles: readonly Shape[]) {
  let result: { width: number; segment: [Point, Point] } | undefined;
  for (const a of first.edges) {
    for (const b of second.edges) {
      if (dot(a.direction, b.direction) > -1 + 1e-9) continue;
      const width = dot(subtract(b.a, a.a), a.outward);
      if (
        !(width > epsilon && width < walkwayMinimumMm - epsilon) ||
        (result && width >= result.width)
      )
        continue;
      const end = dot(subtract(b.a, a.a), a.direction);
      const start = Math.max(0, end - b.length);
      const stop = Math.min(a.length, end);
      if (stop - start < minimumOpposingEdgeMm) continue;
      // Review an exposed cross-section and avoid measuring through intervening solids.
      for (const fraction of [0.5, 0.25, 0.75]) {
        const p = advance(a.a, a.direction, start + fraction * (stop - start));
        const q = advance(p, a.outward, width);
        const probe = shape("", "", "", wallFootprint(p, q, 0.5));
        if (
          obstacles.some(
            (item) =>
              item !== first && item !== second && overlaps(probe, item),
          )
        )
          continue;
        result = { width, segment: [p, q] };
        break;
      }
    }
  }
  return result;
}

export function checkClearances(plan: DraftPlanState): {
  issues: ClearanceIssue[];
  truncated: boolean;
} {
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const obstacles = [
    ...plan.walls.flatMap((wall) =>
      wallRuns(wall, plan.openings).map(({ start, end }, i) =>
        shape(
          "wall:" + wall.id + ":" + i,
          "wall:" + wall.id,
          "wall",
          wallFootprint(start, end, wall.thicknessMm),
        ),
      ),
    ),
    ...plan.fixtures.map((fixture) =>
      shape(
        "fixture:" + fixture.id,
        "fixture:" + fixture.id,
        fixtureCatalog[fixture.template].label,
        fixtureFootprint(fixture),
      ),
    ),
  ];
  const issues: ClearanceIssue[] = [];
  const doorSectors: Shape[] = [];

  for (const [index, door] of plan.openings.entries()) {
    const wall = walls.get(door.wallId);
    if (!wall) continue;
    const label = "Door " + (index + 1);
    const { hinge, closed, leaf } = doorSwing(wall, door);
    if (door.widthMm < doorwayMinimumMm) {
      issues.push({
        id: "door-width:" + door.id,
        kind: "door-width",
        title: label + " opening is narrow",
        detail: "The modeled opening is below the 815 mm doorway benchmark.",
        measuredMm: door.widthMm,
        requiredMm: doorwayMinimumMm,
        segment: [hinge, closed],
      });
    }
    const u = {
      x: (closed.x - hinge.x) / door.widthMm,
      y: (closed.y - hinge.y) / door.widthMm,
    };
    const v = {
      x: (leaf.x - hinge.x) / door.widthMm,
      y: (leaf.y - hinge.y) / door.widthMm,
    };
    const arc = Array.from({ length: 25 }, (_, step) => {
      const angle = (step * Math.PI) / 48;
      return advance(
        advance(hinge, u, Math.cos(angle) * door.widthMm),
        v,
        Math.sin(angle) * door.widthMm,
      );
    });
    const sector = shape(door.id, door.id, label, [hinge, ...arc]);
    // The full circle bounds safely contain the sector even between arc sample points.
    const circle = {
      left: hinge.x - door.widthMm,
      right: hinge.x + door.widthMm,
      top: hinge.y - door.widthMm,
      bottom: hinge.y + door.widthMm,
    };
    for (const obstacle of obstacles) {
      if (
        obstacle.entity === "wall:" + wall.id ||
        !boundsMeet(circle, obstacle.bounds)
      )
        continue;
      if (!swingIntersects(hinge, u, v, door.widthMm, obstacle.polygon))
        continue;
      issues.push({
        id: "swing:" + JSON.stringify([door.id, obstacle.key]),
        kind: "door-swing",
        title: label + " swing is blocked",
        detail: "The door sweeps into " + obstacle.label.toLowerCase() + ".",
        polygons: [sector.polygon, obstacle.polygon],
      });
    }
    for (const other of doorSectors) {
      if (overlaps(sector, other)) {
        issues.push({
          id: "swing-pair:" + JSON.stringify([door.id, other.key]),
          kind: "door-swing",
          title: "Door swings overlap",
          detail:
            label + " and " + other.label.toLowerCase() + " share swing space.",
          polygons: [sector.polygon, other.polygon],
        });
      }
    }
    doorSectors.push(sector);
    if (issues.length >= issueLimit)
      return { issues: issues.slice(0, issueLimit), truncated: true };
  }

  const reportedGaps = new Map<string, ClearanceIssue>();
  for (let i = 0; i < obstacles.length; i++) {
    const a = obstacles[i];
    for (let j = i + 1; j < obstacles.length; j++) {
      const b = obstacles[j];
      if (
        a.entity === b.entity ||
        !boundsMeet(a.bounds, b.bounds, walkwayMinimumMm)
      )
        continue;
      const names = a.label + " and " + b.label.toLowerCase();
      const hasFixture =
        a.entity.startsWith("fixture:") || b.entity.startsWith("fixture:");
      if (issues.length + reportedGaps.size >= issueLimit)
        return {
          issues: [...issues, ...reportedGaps.values()],
          truncated: true,
        };
      const id = JSON.stringify([a.entity, b.entity]);
      if (overlaps(a, b)) {
        if (
          hasFixture &&
          !issues.some((issue) => issue.id === "collision:" + id)
        ) {
          issues.push({
            id: "collision:" + id,
            kind: "collision",
            title: "Footprints overlap",
            detail: names + " occupy the same floor space.",
            polygons: [a.polygon, b.polygon],
          });
        }
        continue;
      }
      const gap = gapBetween(a, b, obstacles);
      if (!gap || (reportedGaps.get(id)?.measuredMm ?? Infinity) <= gap.width)
        continue;
      reportedGaps.set(id, {
        id: "walkway:" + id,
        kind: "walkway",
        title: "Narrow walkway gap",
        detail: "Review the gap between " + names.toLowerCase() + ".",
        measuredMm: gap.width,
        requiredMm: walkwayMinimumMm,
        segment: gap.segment,
      });
    }
  }
  return { issues: [...issues, ...reportedGaps.values()], truncated: false };
}
