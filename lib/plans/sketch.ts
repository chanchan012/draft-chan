import { dot, subtract } from "./footprints";
import type { Point, SketchGeometry } from "./model";

const radians = Math.PI / 180;
export const normalizeDegrees = (degrees: number) =>
  ((degrees % 360) + 360) % 360;
export function directionDegrees(origin: Point, point: Point) {
  return normalizeDegrees(
    Math.atan2(point.y - origin.y, point.x - origin.x) / radians,
  );
}

export function pointAt(
  origin: Point,
  distance: number,
  degrees: number,
): Point {
  return {
    x: origin.x + Math.cos(degrees * radians) * distance,
    y: origin.y + Math.sin(degrees * radians) * distance,
  };
}

export function polarTarget(
  origin: Point,
  point: Point,
  step: number,
  grid: number,
) {
  const heading = Math.round(directionDegrees(origin, point) / step) * step;
  const distance =
    Math.round(Math.hypot(point.x - origin.x, point.y - origin.y) / grid) *
    grid;
  return pointAt(origin, distance, heading);
}

export function arcFromPoints(
  center: Point,
  start: Point,
  end: Point,
): SketchGeometry {
  const startDeg = directionDegrees(center, start);
  return {
    kind: "arc",
    center,
    radiusMm: Math.hypot(start.x - center.x, start.y - center.y),
    startDeg,
    sweepDeg: normalizeDegrees(directionDegrees(center, end) - startDeg),
  };
}

export function sketchPoints(geometry: SketchGeometry): Point[] {
  if (geometry.kind === "construction") return [geometry.start, geometry.end];
  if (geometry.kind === "polyline") return [...geometry.points];
  const { center, radiusMm } = geometry;
  if (geometry.kind === "circle") {
    return [
      { x: center.x - radiusMm, y: center.y - radiusMm },
      { x: center.x + radiusMm, y: center.y + radiusMm },
    ];
  }
  const { startDeg, sweepDeg } = geometry;
  return [
    startDeg,
    startDeg + sweepDeg,
    ...[0, 90, 180, 270].filter(
      (angle) => normalizeDegrees(angle - startDeg) <= sweepDeg,
    ),
  ].map((angle) => pointAt(center, radiusMm, angle));
}

export function shiftSketch(
  geometry: SketchGeometry,
  offset: Point,
): SketchGeometry {
  const shift = (p: Point) => ({ x: p.x + offset.x, y: p.y + offset.y });
  switch (geometry.kind) {
    case "construction":
      return {
        ...geometry,
        start: shift(geometry.start),
        end: shift(geometry.end),
      };
    case "polyline":
      return { ...geometry, points: geometry.points.map(shift) };
    default:
      return { ...geometry, center: shift(geometry.center) };
  }
}

export function sketchDistance(geometry: SketchGeometry, point: Point): number {
  const distance = (p: Point) => Math.hypot(p.x - point.x, p.y - point.y);
  if (geometry.kind === "circle")
    return Math.abs(distance(geometry.center) - geometry.radiusMm);
  if (geometry.kind === "arc") {
    const relative = normalizeDegrees(
      directionDegrees(geometry.center, point) - geometry.startDeg,
    );
    if (relative <= geometry.sweepDeg)
      return Math.abs(distance(geometry.center) - geometry.radiusMm);
    return Math.min(
      distance(pointAt(geometry.center, geometry.radiusMm, geometry.startDeg)),
      distance(
        pointAt(
          geometry.center,
          geometry.radiusMm,
          geometry.startDeg + geometry.sweepDeg,
        ),
      ),
    );
  }
  const points = sketchPoints(geometry);
  if (geometry.kind === "polyline" && geometry.closed) points.push(points[0]);
  return points.slice(1).reduce((nearest, end, i) => {
    const start = points[i];
    const v = subtract(end, start);
    const t = Math.max(
      0,
      Math.min(1, dot(subtract(point, start), v) / dot(v, v)),
    );
    return Math.min(
      nearest,
      distance({ x: start.x + v.x * t, y: start.y + v.y * t }),
    );
  }, Infinity);
}

export function sketchPath(geometry: SketchGeometry) {
  const pair = ({ x, y }: Point) => x + " " + y;
  if (geometry.kind === "circle") {
    const { center, radiusMm: r } = geometry;
    return `M ${center.x - r} ${center.y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  }
  if (geometry.kind === "arc") {
    const { center, radiusMm: r, startDeg, sweepDeg } = geometry;
    return `M ${pair(pointAt(center, r, startDeg))} A ${r} ${r} 0 ${Number(sweepDeg > 180)} 1 ${pair(pointAt(center, r, startDeg + sweepDeg))}`;
  }
  return `M ${sketchPoints(geometry).map(pair).join(" L ")}${geometry.kind === "polyline" && geometry.closed ? " Z" : ""}`;
}
