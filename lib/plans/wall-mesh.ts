import {
  length,
  subtract,
  wallMaterialFootprint,
  wallMaterialOffsets,
} from "./footprints";
import { wallRuns } from "./openings";
import { compareText, type Point, type Wall } from "./model";

type WallEnd = { wall: Wall; direction: Point; angle: number; sign: number };
const turn = Math.PI * 2;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const add = (p: Point, v: Point, scale = 1): Point => ({
  x: p.x + v.x * scale,
  y: p.y + v.y * scale,
});

export function wallMesh(
  walls: readonly Wall[],
  openings: Parameters<typeof wallRuns>[1] = [],
) {
  const byWall = new Map<string, (typeof openings)[number][]>();
  for (const opening of openings) {
    const list = byWall.get(opening.wallId) ?? [];
    list.push(opening);
    byWall.set(opening.wallId, list);
  }
  const runs = new Map(
    walls.map((wall) => [wall.id, wallRuns(wall, byWall.get(wall.id) ?? [])]),
  );
  const vertices = new Map<string, { point: Point; arms: WallEnd[] }>();

  for (const wall of walls) {
    for (const { start, end } of runs.get(wall.id)!) {
      const direction = subtract(end, start);
      const magnitude = length(direction);
      for (const [point, sign] of [
        [start, 1],
        [end, -1],
      ] as const) {
        const id =
          (wall.storeyId && wall.storeyId !== "ground"
            ? wall.storeyId + ":"
            : "") + `${point.x},${point.y}`;
        const vertex = vertices.get(id) ?? { point, arms: [] };
        const unit = {
          x: (direction.x * sign) / magnitude,
          y: (direction.y * sign) / magnitude,
        };
        vertex.arms.push({
          wall,
          direction: unit,
          angle: Math.atan2(unit.y, unit.x),
          sign,
        });
        vertices.set(id, vertex);
      }
    }
  }

  const joints: { id: string; walls: [Wall, Wall]; footprint: Point[] }[] = [];
  for (const [id, { point, arms }] of vertices) {
    if (arms.length < 2) continue;
    arms.sort(
      (a, b) =>
        a.angle - b.angle ||
        a.wall.thicknessMm - b.wall.thicknessMm ||
        compareText(a.wall.id, b.wall.id),
    );
    for (let i = 0; i < arms.length; i++) {
      const b = arms[i];
      const a = arms[(i + 1) % arms.length];
      const gap = a.angle - b.angle + (i + 1 === arms.length ? turn : 0);
      const directional =
        (a.wall.referenceLine && a.wall.referenceLine !== "center") ||
        (b.wall.referenceLine && b.wall.referenceLine !== "center");
      if (
        gap <= 1e-9 ||
        Math.abs(gap - Math.PI) <= 1e-9 ||
        gap >= turn - 1e-9 ||
        (!directional && gap <= Math.PI)
      )
        continue;

      // The straight runs cover the inside of the corner. Bridge their outer
      // edges, beveling acute joins before a miter can form a long spike.
      const ra = wallMaterialOffsets(a.wall)[
        a.sign === 1 ? "negative" : "positive"
      ];
      const rb = wallMaterialOffsets(b.wall)[
        b.sign === 1 ? "positive" : "negative"
      ];
      if (!ra && !rb) continue;
      const first = add(point, { x: a.direction.y, y: -a.direction.x }, ra);
      const last = add(point, { x: -b.direction.y, y: b.direction.x }, rb);
      const distance =
        cross(subtract(last, first), b.direction) /
        cross(a.direction, b.direction);
      const miter = add(first, a.direction, distance);
      const footprint =
        length(subtract(miter, point)) <= 3 * Math.max(ra, rb)
          ? [point, first, miter, last]
          : [point, first, last];
      joints.push({ id, walls: [a.wall, b.wall], footprint });
    }
  }
  return { runs, joints };
}

export function wallOutline(
  walls: readonly Wall[],
  openings: Parameters<typeof wallRuns>[1] = [],
) {
  const { runs, joints } = wallMesh(walls, openings);
  return [
    ...walls.flatMap((wall) =>
      runs.get(wall.id)!.map((run) => wallMaterialFootprint(wall, run)),
    ),
    ...joints.map(({ footprint }) => footprint),
  ];
}
