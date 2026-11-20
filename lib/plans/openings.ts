import { compareText, type Door, type Point, type Wall } from "./model";
type Opening = Pick<Door, "id" | "wallId" | "offsetMm" | "widthMm">;

export function wallLength(wall: Pick<Wall, "start" | "end">) {
  return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
}

export function pointAlong(wall: Wall, offset: number): Point {
  const ratio = offset / wallLength(wall);
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * ratio,
    y: wall.start.y + (wall.end.y - wall.start.y) * ratio,
  };
}

export function doorBounds(door: Pick<Opening, "offsetMm" | "widthMm">) {
  return [
    door.offsetMm - door.widthMm / 2,
    door.offsetMm + door.widthMm / 2,
  ] as const;
}

export function validateOpenings(
  walls: readonly Wall[],
  doors: readonly Opening[],
) {
  const lengths = new Map(walls.map((wall) => [wall.id, wallLength(wall)]));
  const ids = new Set<string>();
  const ends = new Map<string, number>();
  const ordered = [...doors].sort(
    (a, b) =>
      compareText(a.wallId, b.wallId) || doorBounds(a)[0] - doorBounds(b)[0],
  );
  for (const door of ordered) {
    if (ids.has(door.id)) throw new Error("Opening IDs must be unique.");
    ids.add(door.id);
    const length = lengths.get(door.wallId);
    if (length === undefined)
      throw new Error("Place the opening on an existing wall.");
    const [start, end] = doorBounds(door);
    if (start < 0 || end > length)
      throw new Error("The opening must fit between the wall endpoints.");
    if (start < (ends.get(door.wallId) ?? 0))
      throw new Error("This opening overlaps another opening.");
    ends.set(door.wallId, end);
  }
}

export function wallRuns(wall: Wall, doors: readonly Opening[]) {
  const gaps = doors
    .filter((door) => door.wallId === wall.id)
    .map(doorBounds)
    .sort((a, b) => a[0] - b[0]);
  const runs: { start: Point; end: Point }[] = [];
  let from = 0;
  for (const [start, end] of gaps) {
    if (start > from)
      runs.push({
        start: pointAlong(wall, from),
        end: pointAlong(wall, start),
      });
    from = end;
  }
  if (from < wallLength(wall))
    runs.push({ start: pointAlong(wall, from), end: wall.end });
  return runs;
}

export function doorSwing(wall: Wall, door: Door) {
  const [start, end] = doorBounds(door);
  const reverse = door.hinge === "end";
  const hinge = pointAlong(wall, reverse ? end : start);
  const closed = pointAlong(wall, reverse ? start : end);
  const side = door.swing === "left" ? -1 : 1;
  const leaf = {
    x: hinge.x - (closed.y - hinge.y) * side,
    y: hinge.y + (closed.x - hinge.x) * side,
  };
  return { hinge, closed, leaf, clockwise: side === 1 };
}
