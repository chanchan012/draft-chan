import type { MultiPolygon, Polygon } from "polygon-clipping";
import type { Point } from "./model";
import { polygonAreaMm2 } from "./polygon";

export const clipPolygon = (rings: readonly (readonly Point[])[]): Polygon =>
  rings.map((ring) => ring.map(({ x, y }) => [x, y]));

export function drawingPolygons(polygons: MultiPolygon) {
  return polygons.map((rings) =>
    rings.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))),
  );
}

export const drawingArea = (polygons: readonly Point[][][]) =>
  polygons.reduce(
    (sum, [ring, ...holes]) => sum + polygonAreaMm2(ring, holes),
    0,
  );
