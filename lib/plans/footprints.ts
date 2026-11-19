import type { Fixture, Point } from "./model";

export const subtract = (a: Point, b: Point): Point => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const length = (vector: Point) => Math.hypot(vector.x, vector.y);

const cardinal = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] } as const;

export function fixtureFootprint({
  position,
  widthMm,
  depthMm,
  rotation,
}: Fixture): Point[] {
  const [cos, sin] = cardinal[rotation];
  const w = widthMm / 2,
    d = depthMm / 2;
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ].map(([x, y]) => ({
    x: position.x + x * cos - y * sin,
    y: position.y + x * sin + y * cos,
  }));
}

export function wallFootprint(
  start: Point,
  end: Point,
  thicknessMm: number,
): Point[] {
  const v = subtract(end, start);
  const radius = thicknessMm / (2 * length(v));
  const x = -v.y * radius,
    y = v.x * radius;
  return [
    { x: start.x - x, y: start.y - y },
    { x: end.x - x, y: end.y - y },
    { x: end.x + x, y: end.y + y },
    { x: start.x + x, y: start.y + y },
  ];
}

export function bounds(points: readonly Point[]) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom };
}
type Bounds = ReturnType<typeof bounds>;
export function boundsMeet(a: Bounds, b: Bounds, pad = 0) {
  return (
    a.right + pad >= b.left &&
    b.right + pad >= a.left &&
    a.bottom + pad >= b.top &&
    b.bottom + pad >= a.top
  );
}
