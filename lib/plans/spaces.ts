import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping";
import { storeyVoids } from "./building";
import { clipPolygon, drawingPolygons } from "./clipping";
import { dot, subtract } from "./footprints";
import type { DraftPlanState, Point } from "./model";
import { polygonAreaMm2 } from "./polygon";
import { planStoreys, storeyPlan } from "./storeys";
import { wallOutline } from "./wall-mesh";
import { solveWallTopology } from "./wall-topology";

export function querySpaces(plan: DraftPlanState, id?: string) {
  return planStoreys(plan)
    .filter((level) => !id || level.id === id)
    .sort((a, b) => a.elevationMm - b.elevationMm)
    .map((level) => {
      const drawing = storeyPlan(plan, level.id);
      const voids = storeyVoids(plan, level.id).map((item) =>
        clipPolygon([item.footprint]),
      );
      const { rooms, walls } = drawing;
      const wallsById = new Map(walls.map((wall) => [wall.id, wall]));
      const footprints = wallOutline(walls).map((ring) => clipPolygon([ring]));
      const solid = footprints.length ? polygonClipping.union(footprints) : [];
      const boundaryWalls = rooms.length
        ? solveWallTopology(walls).boundarySpans.flatMap((span, index) =>
            span.wallIds.map((id) => {
              const wall = wallsById.get(id)!;
              const forward =
                dot(
                  subtract(wall.end, wall.start),
                  subtract(span.end, span.start),
                ) > 0;
              const [start, end] = forward
                ? [span.start, span.end]
                : [span.end, span.start];
              return { ...wall, id: id + "#" + index, start, end };
            }),
          )
        : [];
      const outlines = rooms.map((room) =>
        clipPolygon([room.polygon, ...(room.holes ?? [])]),
      );
      const perimeterPolygons = outlines.length
        ? polygonClipping.union([
            ...outlines,
            ...wallOutline(boundaryWalls).map((ring) => clipPolygon([ring])),
          ])
        : [];
      const gross = drawingPolygons(
        voids.length && perimeterPolygons.length
          ? polygonClipping.difference(perimeterPolygons, ...voids)
          : perimeterPolygons,
      );
      const obstacles = [...solid, ...voids];
      const spaces = rooms.map((room, i) => {
        const clipped = obstacles.length
          ? polygonClipping.difference(outlines[i], ...obstacles)
          : [outlines[i].map((ring) => [...ring, ring[0]])];
        const net = drawingPolygons(clipped);
        return {
          id: room.id,
          storeyId: level.id,
          boundary: room.polygon,
          holes: room.holes ?? [],
          referenceAreaM2: polygonAreaMm2(room.polygon, room.holes) / 1_000_000,
          netAreaM2:
            net.reduce(
              (sum, [ring, ...holes]) => sum + polygonAreaMm2(ring, holes),
              0,
            ) / 1_000_000,
          net,
        };
      });
      return {
        ...level,
        spaces,
        netAreaM2: spaces.reduce((sum, space) => sum + space.netAreaM2, 0),
        grossAreaM2:
          gross.reduce(
            (sum, [ring, ...holes]) => sum + polygonAreaMm2(ring, holes),
            0,
          ) / 1_000_000,
      };
    });
}
