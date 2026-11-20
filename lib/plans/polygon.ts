import type { Point, Room } from "./model";

function inRing(point: Point, ring: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function inRoom(room: Room, point: Point) {
  return (
    inRing(point, room.polygon) &&
    !(room.holes ?? []).some((hole) => inRing(point, hole))
  );
}

export function signedAreaMm2(polygon: readonly Point[]) {
  const origin = polygon[0];
  if (!origin) return 0;
  let twiceArea = 0;
  let correction = 0;
  for (let index = 1; index + 1 < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[index + 1];
    const cross =
      (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
    const adjusted = cross - correction;
    const sum = twiceArea + adjusted;
    correction = sum - twiceArea - adjusted;
    twiceArea = sum;
  }
  return twiceArea / 2;
}

export function polygonAreaMm2(
  polygon: readonly Point[],
  holes: readonly (readonly Point[])[] = [],
) {
  const area = Math.abs(signedAreaMm2(polygon));
  const cutouts = holes.reduce(
    (sum, hole) => sum + Math.abs(signedAreaMm2(hole)),
    0,
  );
  return Math.max(0, area - cutouts);
}
