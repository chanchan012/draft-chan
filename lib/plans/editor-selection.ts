import { utilityCatalog, type UtilityLayer } from "./catalog";
import { bounds, fixtureFootprint, wallFootprint } from "./footprints";
import { wallHit } from "./cad";
import { doorBounds, pointAlong, wallLength } from "./openings";
import type { DraftPlanState, PlanCommand, Point } from "./model";

export type Selection = {
  kind: "wall" | "door" | "fixture" | "utility";
  id: string;
};
type Layers = Record<UtilityLayer, boolean>;
export const selectionKey = ({ kind, id }: Selection) => kind + ":" + id;
type Box = ReturnType<typeof bounds>;

export function isSelected(items: readonly Selection[], item: Selection) {
  return items.some(({ id, kind }) => id === item.id && kind === item.kind);
}

export function selectInBox(
  plan: DraftPlanState,
  from: Point,
  to: Point,
  layers: Layers,
): Selection[] {
  const area = bounds([from, to]);
  const inside = (box: Box) =>
    box.left >= area.left &&
    box.right <= area.right &&
    box.top >= area.top &&
    box.bottom <= area.bottom;
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const result: Selection[] = [];
  for (const wall of plan.walls) {
    if (inside(bounds(wallFootprint(wall.start, wall.end, wall.thicknessMm))))
      result.push({ kind: "wall", id: wall.id });
  }
  for (const door of plan.openings) {
    const wall = walls.get(door.wallId);
    if (
      wall &&
      inside(bounds(doorBounds(door).map((offset) => pointAlong(wall, offset))))
    )
      result.push({ kind: "door", id: door.id });
  }
  for (const fixture of plan.fixtures) {
    if (inside(bounds(fixtureFootprint(fixture))))
      result.push({ kind: "fixture", id: fixture.id });
  }
  for (const marker of plan.utilities) {
    if (
      layers[utilityCatalog[marker.template].layer] &&
      inside(bounds([marker.position]))
    )
      result.push({ kind: "utility", id: marker.id });
  }
  return result;
}

export function selectAt(
  plan: DraftPlanState,
  point: Point,
  scale: number,
  layers: Layers,
): Selection | null {
  const marker = plan.utilities.find(
    (item) =>
      layers[utilityCatalog[item.template].layer] &&
      Math.hypot(point.x - item.position.x, point.y - item.position.y) <=
        10 / scale,
  );
  if (marker) return { kind: "utility", id: marker.id };
  const fixture = plan.fixtures.findLast((item) => {
    const edge = bounds(fixtureFootprint(item));
    return (
      point.x >= edge.left &&
      point.x <= edge.right &&
      point.y >= edge.top &&
      point.y <= edge.bottom
    );
  });
  if (fixture) return { kind: "fixture", id: fixture.id };
  const hit = wallHit(point, plan.walls, 11 / scale);
  if (!hit) return null;
  const door = plan.openings.find((item) => {
    const [start, end] = doorBounds(item);
    return (
      item.wallId === hit.wall.id && hit.offset >= start && hit.offset <= end
    );
  });
  return door
    ? { kind: "door", id: door.id }
    : { kind: "wall", id: hit.wall.id };
}

export function moveSelection(
  plan: DraftPlanState,
  items: readonly Selection[],
  delta: Point,
): PlanCommand[] {
  if (!delta.x && !delta.y) return [];
  const shifted = (point: Point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  });
  const keys = new Set(items.map(selectionKey));
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  return [
    ...plan.walls.flatMap((wall): PlanCommand[] =>
      keys.has("wall:" + wall.id)
        ? [
            {
              type: "wall.update",
              id: wall.id,
              changes: { start: shifted(wall.start), end: shifted(wall.end) },
            },
          ]
        : [],
    ),
    ...plan.openings.flatMap((door): PlanCommand[] => {
      if (!keys.has("door:" + door.id) || keys.has("wall:" + door.wallId))
        return [];
      const wall = walls.get(door.wallId)!;
      const length = wallLength(wall);
      const along =
        ((wall.end.x - wall.start.x) * delta.x +
          (wall.end.y - wall.start.y) * delta.y) /
        length;
      const offsetMm = Math.round(door.offsetMm + along);
      return [{ type: "door.update", id: door.id, changes: { offsetMm } }];
    }),
    ...plan.fixtures.flatMap((item): PlanCommand[] =>
      keys.has("fixture:" + item.id)
        ? [
            {
              type: "fixture.update",
              id: item.id,
              changes: { position: shifted(item.position) },
            },
          ]
        : [],
    ),
    ...plan.utilities.flatMap((item): PlanCommand[] =>
      keys.has("utility:" + item.id)
        ? [
            {
              type: "utility.update",
              id: item.id,
              changes: { position: shifted(item.position) },
            },
          ]
        : [],
    ),
  ];
}

export function removeSelection(
  plan: DraftPlanState,
  items: readonly Selection[],
): PlanCommand[] {
  const keys = new Set(items.map(selectionKey));
  return [
    ...plan.openings.flatMap((door): PlanCommand[] =>
      keys.has("door:" + door.id) && !keys.has("wall:" + door.wallId)
        ? [{ type: "door.remove", id: door.id }]
        : [],
    ),
    ...plan.walls.flatMap((wall): PlanCommand[] =>
      keys.has("wall:" + wall.id) ? [{ type: "wall.remove", id: wall.id }] : [],
    ),
    ...plan.fixtures.flatMap((item): PlanCommand[] =>
      keys.has("fixture:" + item.id)
        ? [{ type: "fixture.remove", id: item.id }]
        : [],
    ),
    ...plan.utilities.flatMap((item): PlanCommand[] =>
      keys.has("utility:" + item.id)
        ? [{ type: "utility.remove", id: item.id }]
        : [],
    ),
  ];
}

// A drag previews authored geometry. Room polygons are recalculated at commit.
export function previewSelection(
  plan: DraftPlanState,
  items: readonly Selection[],
  delta: Point,
): DraftPlanState {
  const result = { ...plan };
  const commands = moveSelection(plan, items, delta);
  for (const edit of commands) {
    switch (edit.type) {
      case "wall.update":
        result.walls = result.walls.map((wall) =>
          wall.id === edit.id ? { ...wall, ...edit.changes } : wall,
        );
        break;
      case "door.update":
        result.openings = result.openings.map((door) =>
          door.id === edit.id ? { ...door, ...edit.changes } : door,
        );
        break;
      case "fixture.update":
        result.fixtures = result.fixtures.map((item) =>
          item.id === edit.id ? { ...item, ...edit.changes } : item,
        );
        break;
      case "utility.update":
        result.utilities = result.utilities.map((item) =>
          item.id === edit.id ? { ...item, ...edit.changes } : item,
        );
        break;
    }
  }
  return result;
}
