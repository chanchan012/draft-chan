import polygonClipping, { type Polygon } from "polygon-clipping";
import { wallHeight } from "./cad";
import { wallMaterialCenter, wallMaterialFootprint } from "./footprints";
import type { DraftPlanState, Point, Room, Wall } from "./model";
import { doorBounds, pointAlong, wallLength } from "./openings";
import { inRoom } from "./polygon";
import { wallMesh, wallOutline } from "./wall-mesh";

export const slabDepth = 165;
export const cutawayHeight = { interior: 1030, front: 1020 } as const;
type WallRole = keyof typeof cutawayHeight | "rear" | "standalone";
type Section = {
  role: WallRole;
  base: number;
  height: number;
  rings: Point[][];
};

function unionRings(parts: Point[][][]): Point[][][] {
  if (parts.length < 2) return parts;
  const polygons = parts.map(
    (rings): Polygon => rings.map((ring) => ring.map(({ x, y }) => [x, y])),
  );
  try {
    return polygonClipping
      .union(polygons)
      .map((rings) =>
        rings.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))),
      );
  } catch {
    // A contour failure should still leave the plan visible and editable.
    return parts;
  }
}

export function wallRole(wall: Wall, rooms: readonly Room[]): WallRole {
  const span = wallLength(wall);
  const center = pointAlong(wall, span / 2);
  const normal = {
    x: (wall.start.y - wall.end.y) / span,
    y: (wall.end.x - wall.start.x) / span,
  };
  const left = rooms.some((room) =>
    inRoom(room, { x: center.x + normal.x, y: center.y + normal.y }),
  );
  const right = rooms.some((room) =>
    inRoom(room, { x: center.x - normal.x, y: center.y - normal.y }),
  );
  if (left && right) return "interior";
  if (!left && !right)
    return rooms.length && wall.kind === "interior" ? "interior" : "standalone";
  const outward = (normal.x + normal.y) * (left ? -1 : 1);
  return outward > 0 ? "front" : "rear";
}

function viewHeight(role: WallRole, heightMm = wallHeight) {
  return role === "front" || role === "interior"
    ? Math.min(heightMm, cutawayHeight[role])
    : heightMm;
}

export function buildIsometric(
  plan: Pick<DraftPlanState, "walls" | "rooms" | "openings" | "windows">,
  heightMm = wallHeight,
) {
  const rooms = plan.rooms.map((room) => [room.polygon, ...(room.holes ?? [])]);
  const slab = rooms.length
    ? unionRings([...rooms, ...wallOutline(plan.walls).map((ring) => [ring])])
    : [];
  const mesh = wallMesh(plan.walls, [
    ...plan.openings,
    ...(plan.windows ?? []),
  ]);
  const host = new Map(
    plan.walls.map((wall) => [
      wall.id,
      { wall, role: wallRole(wall, plan.rooms) },
    ]),
  );
  const groups = new Map<
    string,
    { role: WallRole; base: number; height: number; footprints: Point[][][] }
  >();
  function section(
    role: WallRole,
    footprint: Point[],
    base: number,
    height: number,
  ) {
    if (height <= 0) return;
    const key = `${role}:${base}:${height}`;
    const group = groups.get(key) ?? { role, base, height, footprints: [] };
    group.footprints.push([footprint]);
    groups.set(key, group);
  }
  for (const { wall, role } of host.values()) {
    for (const { start, end } of mesh.runs.get(wall.id)!)
      section(
        role,
        wallMaterialFootprint(wall, { start, end }),
        0,
        viewHeight(role, heightMm),
      );
  }
  for (const joint of mesh.joints) {
    const [a, b] = joint.walls.map((wall) => host.get(wall.id)!.role);
    const role = viewHeight(a, heightMm) <= viewHeight(b, heightMm) ? a : b;
    section(role, joint.footprint, 0, viewHeight(role, heightMm));
  }

  const windows = (plan.windows ?? []).flatMap((window) => {
    const { wall, role } = host.get(window.wallId)!;
    const max = viewHeight(role, heightMm);
    const [start, end] = doorBounds(window).map((offset) =>
      pointAlong(wall, offset),
    );
    const footprint = wallMaterialFootprint(wall, { start, end });
    const lintel = window.sillMm + window.heightMm;
    section(role, footprint, 0, Math.min(max, window.sillMm));
    section(role, footprint, lintel, max - lintel);
    const height = Math.min(max, lintel) - window.sillMm;
    return height > 0
      ? [
          {
            id: window.id,
            role,
            ...wallMaterialCenter(wall, { start, end }),
            base: window.sillMm,
            height,
          },
        ]
      : [];
  });
  const walls: Section[] = [...groups.values()].flatMap(
    ({ role, base, height, footprints }) =>
      unionRings(footprints).map((rings) => ({ role, base, height, rings })),
  );
  return { slab, rooms, walls, windows };
}
