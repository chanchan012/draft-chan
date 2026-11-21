import {
  cross,
  lerpPoint,
  roofProfile,
  slabPolygons,
  stairSteps,
} from "./building";
import { dot, subtract, wallMaterialFootprint } from "./footprints";
import type { BuildingView, DraftPlanState, Point, Roof } from "./model";
import { doorBounds, pointAlong, wallRuns } from "./openings";
import { inRoom } from "./polygon";
import { planStoreys, storeyById, storeyOf } from "./storeys";

type SurfaceKind = "wall" | "slab" | "stair" | "roof" | "glazing";
type Surface = {
  id: string;
  kind: SurfaceKind;
  depth: number;
  polygon: Point[];
};
type Range = [number, number];
const epsilon = 1e-7;
const axes = {
  north: { along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } },
  south: { along: { x: -1, y: 0 }, inward: { x: 0, y: -1 } },
  west: { along: { x: 0, y: -1 }, inward: { x: 1, y: 0 } },
  east: { along: { x: 0, y: 1 }, inward: { x: -1, y: 0 } },
} as const;

function sectionAxis(view: Extract<BuildingView, { kind: "section" }>) {
  const direction = subtract(view.end, view.start);
  const length = Math.hypot(direction.x, direction.y);
  if (length <= epsilon)
    throw new Error("A section needs two distinct points.");
  const along = { x: direction.x / length, y: direction.y / length };
  const point = (x: number) => lerpPoint(view.start, view.end, x / length);
  function intervals(rings: Point[][]): Range[] {
    const stops = [0, length];
    for (const ring of rings) {
      for (const [i, start] of ring.entries()) {
        const end = ring[(i + 1) % ring.length];
        const side = subtract(end, start);
        const offset = subtract(start, view.start);
        const denominator = cross(along, side);
        if (Math.abs(denominator) <= epsilon) {
          if (Math.abs(cross(along, offset)) < epsilon)
            stops.push(
              dot(offset, along),
              dot(subtract(end, view.start), along),
            );
          continue;
        }
        const t = cross(offset, side) / denominator;
        const u = cross(offset, along) / denominator;
        if (u >= -epsilon && u <= 1 + epsilon) stops.push(t);
      }
    }
    const sorted = stops
      .filter((stop) => stop >= 0 && stop <= length)
      .sort((a, b) => a - b);
    const room = { id: "section", polygon: rings[0], holes: rings.slice(1) };
    return sorted.slice(1).flatMap((end, i) => {
      const start = sorted[i];
      return end - start > epsilon && inRoom(room, point((start + end) / 2))
        ? [[start, end]]
        : [];
    });
  }
  return { length, point, intervals };
}

const extent = (points: Point[], direction: Point): Range => {
  const values = points.map((point) => dot(point, direction));
  return [Math.min(...values), Math.max(...values)];
};

function envelope(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  function chain(source: Point[]) {
    const hull: Point[] = [];
    for (const point of source) {
      while (
        hull.length >= 2 &&
        cross(
          subtract(hull.at(-1)!, hull.at(-2)!),
          subtract(point, hull.at(-1)!),
        ) <= epsilon
      )
        hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  }
  return [...chain(sorted), ...chain(sorted.reverse())];
}

export function deriveBuildingView(plan: DraftPlanState, view: BuildingView) {
  const section = view.kind === "section" ? sectionAxis(view) : undefined;
  const elevation =
    view.kind === "elevation" ? axes[view.direction] : undefined;
  const levels = [...planStoreys(plan)].sort(
    (a, b) => a.elevationMm - b.elevationMm,
  );
  const surfaces: Surface[] = [];

  function prism(
    id: string,
    kind: SurfaceKind,
    rings: Point[][],
    baseMm: number,
    topMm: number,
  ) {
    if (topMm - baseMm < epsilon) return;
    const ranges = section
      ? section.intervals(rings)
      : [extent(rings[0], elevation!.along)];
    const depth = elevation ? extent(rings[0], elevation.inward)[0] : 0;
    for (const [start, end] of ranges)
      if (end - start > epsilon)
        surfaces.push({
          id,
          kind,
          depth,
          polygon: [
            { x: start, y: baseMm },
            { x: end, y: baseMm },
            { x: end, y: topMm },
            { x: start, y: topMm },
          ],
        });
  }

  function roofSurface(roof: Roof) {
    const profile = roofProfile(plan, roof);
    if (section) {
      for (const [start, end] of section.intervals([roof.footprint])) {
        const a = section.point(start);
        const b = section.point(end);
        const c = profile.coordinate(a);
        const d = profile.coordinate(b);
        const t = (profile.ridge - c) / (d - c);
        const stops =
          roof.profile === "gable" && t > 0 && t < 1
            ? [start, start + (end - start) * t, end]
            : [start, end];
        const top = stops.map((x) => ({
          x,
          y: profile.height(section.point(x)),
        }));
        surfaces.push({
          id: roof.id,
          kind: "roof",
          depth: 0,
          polygon: [
            ...top,
            ...[...top]
              .reverse()
              .map((point) => ({ ...point, y: point.y - roof.thicknessMm })),
          ],
        });
      }
    } else {
      const { along, inward } = elevation!;
      const top = [...roof.footprint, ...profile.ridgePoints].map((point) => ({
        x: dot(point, along),
        y: profile.height(point),
      }));
      const polygon = envelope([
        ...top,
        ...top.map((point) => ({ ...point, y: point.y - roof.thicknessMm })),
      ]);
      if (polygon.length >= 3)
        surfaces.push({
          id: roof.id,
          kind: "roof",
          depth: extent(roof.footprint, inward)[0],
          polygon,
        });
    }
  }

  const openings = [...plan.openings, ...(plan.windows ?? [])];
  for (const wall of plan.walls) {
    const level = storeyById(plan, storeyOf(wall));
    const base = level.elevationMm;
    const top = base + level.wallHeightMm;
    for (const run of wallRuns(wall, openings))
      prism(wall.id, "wall", [wallMaterialFootprint(wall, run)], base, top);
    for (const opening of openings.filter((item) => item.wallId === wall.id)) {
      const [start, end] = doorBounds(opening).map((mm) =>
        pointAlong(wall, mm),
      );
      const footprint = [wallMaterialFootprint(wall, { start, end })];
      const sill = base + ("sillMm" in opening ? opening.sillMm : 0);
      const lintel = Math.min(
        top,
        sill + ("heightMm" in opening ? opening.heightMm : 2100),
      );
      prism(wall.id, "wall", footprint, base, sill);
      prism(wall.id, "wall", footprint, lintel, top);
      if ("sillMm" in opening)
        prism(opening.id, "glazing", footprint, sill, lintel);
    }
  }

  for (const item of plan.buildingElements ?? []) {
    if (item.kind === "slab") {
      const top = storeyById(plan, item.storeyId).elevationMm + item.offsetMm;
      for (const polygon of slabPolygons(plan, item))
        prism(item.id, "slab", polygon, top - item.thicknessMm, top);
    } else if (item.kind === "stair") {
      for (const step of stairSteps(plan, item))
        prism(item.id, "stair", [step.footprint], step.baseMm, step.topMm);
    } else if (item.kind === "roof") roofSurface(item);
  }
  if (elevation) surfaces.sort((a, b) => b.depth - a.depth);
  return {
    view,
    surfaces,
    storeys: levels.map(({ id, elevationMm, name }) => ({
      id,
      elevationMm,
      name,
    })),
    ...(section ? { cutLengthMm: section.length } : {}),
  };
}
