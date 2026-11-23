import { z } from "zod";

import { defaultStoreyId, polygonSchema, wallSchema } from "./model";
import { polygonAreaMm2 } from "./polygon";
export { initialGraph } from "./plan-state";

export const newPlan = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    room: z
      .object({
        width: z.number().int().min(100).max(100000),
        depth: z.number().int().min(100).max(100000),
      })
      .optional(),
  })
  .strict();
export const renamePlan = newPlan
  .pick({ name: true })
  .extend({ revision: z.number().int().nonnegative() })
  .strict();

const roomBoundary = z.object({
  storeyId: z.string().optional(),
  polygon: polygonSchema,
  holes: z.array(polygonSchema).optional(),
});
function roomBoundaries(graph: unknown) {
  const rooms = z.object({ rooms: z.array(z.unknown()) }).safeParse(graph);
  if (!rooms.success) return [];
  return rooms.data.rooms.flatMap((room) => {
    const parsed = roomBoundary.safeParse(room);
    return parsed.success ? [parsed.data] : [];
  });
}
export function areaM2(graph: unknown) {
  return (
    roomBoundaries(graph).reduce(
      (sum, room) => sum + polygonAreaMm2(room.polygon, room.holes),
      0,
    ) / 1_000_000
  );
}
export function thumbnailSvg(graph: unknown) {
  const allRooms = roomBoundaries(graph);
  const decoded = z.object({ walls: z.array(z.unknown()) }).safeParse(graph);
  const allWalls = decoded.success
    ? decoded.data.walls.flatMap((raw) => {
        const wall = wallSchema.safeParse(raw);
        return wall.success ? [wall.data] : [];
      })
    : [];
  let shapes = '<path d="M148 84h24m-12-12v24" fill="none" stroke="#969d88"/>';
  const level = [...allRooms, ...allWalls].some(
    (item) => (item.storeyId ?? defaultStoreyId) === defaultStoreyId,
  )
    ? defaultStoreyId
    : ([...allRooms, ...allWalls][0]?.storeyId ?? defaultStoreyId);
  const rooms = allRooms.filter(
    (item) => (item.storeyId ?? defaultStoreyId) === level,
  );
  const walls = allWalls.filter(
    (item) => (item.storeyId ?? defaultStoreyId) === level,
  );
  if (rooms.length || walls.length) {
    const points = rooms
      .flatMap(({ polygon, holes = [] }) => [polygon, ...holes])
      .flat();
    points.push(...walls.flatMap((wall) => [wall.start, wall.end]));
    let xmin = Infinity,
      ymin = Infinity,
      xmax = -Infinity,
      ymax = -Infinity;
    for (const p of points) {
      xmin = Math.min(xmin, p.x);
      xmax = Math.max(xmax, p.x);
      ymin = Math.min(ymin, p.y);
      ymax = Math.max(ymax, p.y);
    }
    const scale = Math.min(
      268 / Math.max(1, xmax - xmin),
      124 / Math.max(1, ymax - ymin),
    );
    function project(p: { x: number; y: number }) {
      return [
        (160 + (p.x - (xmin + xmax) / 2) * scale).toFixed(2),
        (84 + (p.y - (ymin + ymax) / 2) * scale).toFixed(2),
      ].join(",");
    }
    const style = 'fill="#e6ddc8" stroke="#4b5145" stroke-width="3"';
    shapes = rooms
      .map(({ polygon, holes }) => {
        if (!holes?.length) {
          return `<polygon ${style} points="${polygon.map(project).join(" ")}"/>`;
        }
        const path = [polygon, ...holes]
          .map((ring) => `M${ring.map(project).join(" ")}Z`)
          .join(" ");
        return `<path ${style} fill-rule="evenodd" d="${path}"/>`;
      })
      .join("");
    if (!rooms.length) {
      shapes = walls
        .map(
          ({ start, end }) =>
            `<path d="M${project(start)}L${project(end)}" fill="none" stroke="#4b5145" stroke-width="3"/>`,
        )
        .join("");
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 168"><defs><pattern id="g" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#dadfd3" stroke-width=".7"/></pattern></defs><rect width="320" height="168" fill="#f4f6ee"/><rect width="320" height="168" fill="url(#g)"/>' +
    shapes +
    "</svg>"
  );
}
export interface PlanCard {
  shared?: "viewer" | "reviewer" | "editor";
  id: string;
  name: string;
  revision: number;
  areaM2: number;
  thumbnail: string | null;
  updatedAt: string;
}
