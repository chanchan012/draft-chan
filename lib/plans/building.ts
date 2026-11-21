import polygonClipping from "polygon-clipping";
import { clipPolygon, drawingArea, drawingPolygons } from "./clipping";
import { dot, subtract, wallFootprint } from "./footprints";
import {
  type BuildingElement,
  type DraftPlanState,
  type Point,
  type Roof,
  type Slab,
  type Stair,
} from "./model";
import { polygonAreaMm2 } from "./polygon";
import { storeyById } from "./storeys";

const EPS = 1e-7;
export const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

function spans(ring: readonly Point[]) {
  return ring.map((a, i) => [a, ring[(i + 1) % ring.length]] as const);
}

function segmentsTouch(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) =>
    cross(subtract(q, p), subtract(r, p));
  const hits = (p: Point, q: Point, r: Point) =>
    r.x >= Math.min(p.x, q.x) &&
    r.x <= Math.max(p.x, q.x) &&
    r.y >= Math.min(p.y, q.y) &&
    r.y <= Math.max(p.y, q.y);
  const s0 = side(a, b, c);
  const s1 = side(a, b, d);
  const s2 = side(c, d, a);
  const s3 = side(c, d, b);
  return (
    (s0 * s1 < 0 && s2 * s3 < 0) ||
    (s0 === 0 && hits(a, b, c)) ||
    (s1 === 0 && hits(a, b, d)) ||
    (s2 === 0 && hits(c, d, a)) ||
    (s3 === 0 && hits(c, d, b))
  );
}

export function validateRing(ring: readonly Point[], name: string) {
  if (
    new Set(ring.map(({ x, y }) => x + "," + y)).size !== ring.length ||
    polygonAreaMm2(ring) < 1
  )
    throw new Error(
      name + " needs a polygon with distinct vertices and a positive area.",
    );
  const edges = spans(ring);
  for (const [i, [a, b]] of edges.entries()) {
    const c = ring[(i + 2) % ring.length];
    if (
      cross(subtract(a, b), subtract(c, b)) === 0 &&
      dot(subtract(a, b), subtract(c, b)) > 0
    )
      throw new Error(name + " has a footprint that folds back on itself.");
    for (let j = i + 2; j < edges.length; j++) {
      if (i === 0 && j === edges.length - 1) continue;
      if (segmentsTouch(a, b, edges[j][0], edges[j][1]))
        throw new Error(name + " has intersecting footprint edges.");
    }
  }
}

export const stairFootprint = (stair: Stair) =>
  wallFootprint(stair.start, stair.end, stair.widthMm);
export function stairSteps(plan: DraftPlanState, stair: Stair) {
  const from = storeyById(plan, stair.fromStoreyId).elevationMm;
  const riser =
    (storeyById(plan, stair.toStoreyId).elevationMm - from) / stair.risers;
  return Array.from({ length: stair.risers }, (_, i) => ({
    baseMm: i === 0 ? from : from + riser * i,
    topMm: from + riser * (i + 1),
    footprint: wallFootprint(
      lerpPoint(stair.start, stair.end, i / stair.risers),
      lerpPoint(stair.start, stair.end, (i + 1) / stair.risers),
      stair.widthMm,
    ),
  }));
}

export function openingsForSlab(plan: DraftPlanState, slabId: string) {
  return (plan.buildingElements ?? []).flatMap<{
    id: string;
    source: "opening" | "stair";
    footprint: Point[];
  }>((item) => {
    if (item.kind === "opening" && item.slabId === slabId)
      return [
        { id: item.id, source: "opening" as const, footprint: item.footprint },
      ];
    if (item.kind === "stair" && item.openingSlabId === slabId)
      return [
        {
          id: item.id,
          source: "stair" as const,
          footprint: stairFootprint(item),
        },
      ];
    return [];
  });
}

export function slabPolygons(plan: DraftPlanState, slab: Slab) {
  const outer = clipPolygon([slab.footprint]);
  const holes = openingsForSlab(plan, slab.id);
  return holes.length
    ? drawingPolygons(
        polygonClipping.difference(
          outer,
          ...holes.map((hole) => clipPolygon([hole.footprint])),
        ),
      )
    : [[slab.footprint]];
}

export function storeyVoids(plan: DraftPlanState, id: string) {
  return (plan.buildingElements ?? []).flatMap((item) =>
    item.kind === "slab" && item.storeyId === id
      ? openingsForSlab(plan, item.id)
      : [],
  );
}

export function roofProfile(plan: DraftPlanState, roof: Roof) {
  const level = storeyById(plan, roof.storeyId);
  const base = level.elevationMm + level.wallHeightMm + roof.offsetMm;
  const angle = (roof.directionDeg * Math.PI) / 180;
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const coordinates = roof.footprint.map((point) => dot(point, axis));
  const low = Math.min(...coordinates);
  const high = Math.max(...coordinates);
  const ridge = (low + high) / 2;
  const pitch = Math.tan((roof.pitchDeg * Math.PI) / 180);
  const coordinate = (point: Point) => dot(point, axis);
  function height(point: Point) {
    if (roof.profile === "flat") return base;
    const position = coordinate(point);
    return (
      base +
      pitch *
        Math.max(
          0,
          roof.profile === "shed"
            ? position - low
            : Math.min(position - low, high - position),
        )
    );
  }
  const ridgePoints =
    roof.profile === "gable"
      ? spans(roof.footprint).flatMap(([a, b]) => {
          const start = coordinate(a);
          const stop = coordinate(b);
          if ((start - ridge) * (stop - ridge) >= 0) return [];
          return [lerpPoint(a, b, (ridge - start) / (stop - start))];
        })
      : [];
  return { height, ridge, coordinate, ridgePoints };
}

function checkHosted(footprint: Point[], slab: Slab, name: string) {
  const outside = polygonClipping.difference(
    clipPolygon([footprint]),
    clipPolygon([slab.footprint]),
  );
  if (drawingArea(drawingPolygons(outside)) > 0.01)
    throw new Error(name + " must fit entirely inside slab " + slab.name + ".");
}

export function validateBuilding(plan: DraftPlanState) {
  const elements = plan.buildingElements ?? [];
  const views = plan.buildingViews ?? [];
  const slabs = new Map(
    elements.flatMap((item) =>
      item.kind === "slab" ? [[item.id, item] as const] : [],
    ),
  );
  for (const items of [elements, views]) {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error("Use distinct IDs for building elements and views.");
  }
  for (const item of elements) {
    if ("footprint" in item) validateRing(item.footprint, item.name);
    if ("storeyId" in item) storeyById(plan, item.storeyId);
    if (item.kind === "opening") {
      const slab = slabs.get(item.slabId);
      if (!slab)
        throw new Error(
          "Floor opening " + item.name + " needs an existing slab.",
        );
      checkHosted(item.footprint, slab, item.name);
    }
    if (item.kind === "stair") {
      const from = storeyById(plan, item.fromStoreyId);
      const to = storeyById(plan, item.toStoreyId);
      if (to.elevationMm <= from.elevationMm)
        throw new Error("A stair must rise to a higher storey.");
      if (
        Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) <
        item.risers
      )
        throw new Error("The stair needs a positive run for every tread.");
      const footprint = stairFootprint(item);
      if (
        footprint.some(
          (point) =>
            Math.abs(point.x) > 1_000_000 + EPS ||
            Math.abs(point.y) > 1_000_000 + EPS,
        )
      )
        throw new Error("The stair footprint exceeds the drawing bounds.");
      if (item.openingSlabId) {
        const slab = slabs.get(item.openingSlabId);
        if (slab?.storeyId !== item.toStoreyId)
          throw new Error(
            "The stair opening needs a slab on its destination storey.",
          );
        checkHosted(footprint, slab, item.name);
      }
    }
    if (
      item.kind === "roof" &&
      (item.profile === "flat") !== (item.pitchDeg === 0)
    )
      throw new Error(
        "Flat roofs use a zero pitch. Shed and gable roofs need a positive pitch.",
      );
  }
  for (const view of views)
    if (
      view.kind === "section" &&
      view.start.x === view.end.x &&
      view.start.y === view.end.y
    )
      throw new Error("A section needs two distinct cut points.");
}

export function elementsOnStorey(plan: DraftPlanState, id: string) {
  const slabIds = new Set(
    (plan.buildingElements ?? []).flatMap((item) =>
      item.kind === "slab" && item.storeyId === id ? [item.id] : [],
    ),
  );
  return (plan.buildingElements ?? []).filter((item) =>
    item.kind === "stair"
      ? item.fromStoreyId === id || item.toStoreyId === id
      : item.kind === "opening"
        ? slabIds.has(item.slabId)
        : item.storeyId === id,
  );
}

export function buildingElementFootprint(item: BuildingElement) {
  return item.kind === "stair" ? stairFootprint(item) : item.footprint;
}
