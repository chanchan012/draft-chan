import { z } from "zod";

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const polygon = z.array(point).min(3);
type Point = z.infer<typeof point>;

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

export function initialGraph(room?: { width: number; depth: number }) {
  const rooms = room
    ? [
        {
          id: "room-1",
          polygon: [
            { x: 0, y: 0 },
            { x: room.width, y: 0 },
            { x: room.width, y: room.depth },
            { x: 0, y: room.depth },
          ],
        },
      ]
    : [];
  return {
    version: 1,
    walls: [],
    rooms,
    openings: [],
    fixtures: [],
    dimensions: [],
  };
}
function roomPolygons(graph: unknown): Point[][] {
  const rooms = z.object({ rooms: z.array(z.unknown()) }).safeParse(graph);
  if (!rooms.success) return [];
  return rooms.data.rooms.flatMap((room) => {
    const parsed = z.object({ polygon }).safeParse(room);
    return parsed.success ? [parsed.data.polygon] : [];
  });
}
export function areaM2(graph: unknown) {
  return roomPolygons(graph).reduce((sum, points) => {
    const twice = points.reduce((total, a, index) => {
      const b = points[(index + 1) % points.length];
      return total + a.x * b.y - b.x * a.y;
    }, 0);
    return sum + Math.abs(twice) / 2_000_000;
  }, 0);
}
export function thumbnailSvg(graph: unknown) {
  const polygons = roomPolygons(graph);
  let shapes = '<path d="M148 84h24m-12-12v24" fill="none" stroke="#969d88"/>';
  if (polygons.length) {
    const points = polygons.flat();
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
    shapes = polygons
      .map(
        (poly) =>
          '<polygon fill="#e6ddc8" stroke="#4b5145" stroke-width="3" points="' +
          poly
            .map((p) =>
              [
                (160 + (p.x - (xmin + xmax) / 2) * scale).toFixed(2),
                (84 + (p.y - (ymin + ymax) / 2) * scale).toFixed(2),
              ].join(","),
            )
            .join(" ") +
          '"/>',
      )
      .join("");
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 168"><defs><pattern id="g" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#dadfd3" stroke-width=".7"/></pattern></defs><rect width="320" height="168" fill="#f4f6ee"/><rect width="320" height="168" fill="url(#g)"/>' +
    shapes +
    "</svg>"
  );
}
export interface PlanCard {
  id: string;
  name: string;
  revision: number;
  areaM2: number;
  thumbnail: string | null;
  updatedAt: string;
}
