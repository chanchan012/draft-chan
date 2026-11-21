import { utilityCatalog, type UtilityLayer } from "./catalog";
import { bounds, fixtureFootprint, wallMaterialFootprint } from "./footprints";
import { wallHit } from "./cad";
import { doorBounds, pointAlong, wallLength } from "./openings";
import { shiftSketch, sketchDistance, sketchPoints } from "./sketch";
import type { DraftPlanState, PlanCommand, Point } from "./model";

export type Selection = {
  kind:
    | "wall"
    | "door"
    | "window"
    | "dimension"
    | "fixture"
    | "utility"
    | "sketch";
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
    if (inside(bounds(wallMaterialFootprint(wall))))
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
  for (const window of plan.windows ?? []) {
    const wall = walls.get(window.wallId);
    if (
      wall &&
      inside(
        bounds(doorBounds(window).map((offset) => pointAlong(wall, offset))),
      )
    )
      result.push({ kind: "window", id: window.id });
  }
  for (const dimension of plan.annotations ?? []) {
    if (inside(bounds([dimension.start, dimension.end])))
      result.push({ kind: "dimension", id: dimension.id });
  }
  for (const sketch of plan.sketches ?? []) {
    if (inside(bounds(sketchPoints(sketch.geometry))))
      result.push({ kind: "sketch", id: sketch.id });
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
  const dimension = plan.annotations?.find(({ start, end }) => {
    const dx = end.x - start.x,
      dy = end.y - start.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) /
          (dx * dx + dy * dy),
      ),
    );
    return (
      Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t) <=
      7 / scale
    );
  });
  if (dimension) return { kind: "dimension", id: dimension.id };
  const hit = wallHit(point, plan.walls, 11 / scale);
  if (!hit) {
    const sketch = plan.sketches?.findLast(
      (item) => sketchDistance(item.geometry, point) <= 7 / scale,
    );
    return sketch ? { kind: "sketch", id: sketch.id } : null;
  }
  const door = plan.openings.find((item) => {
    const [start, end] = doorBounds(item);
    return (
      item.wallId === hit.wall.id && hit.offset >= start && hit.offset <= end
    );
  });
  if (door) return { kind: "door", id: door.id };
  const window = plan.windows?.find((item) => {
    const [start, end] = doorBounds(item);
    return (
      item.wallId === hit.wall.id && hit.offset >= start && hit.offset <= end
    );
  });
  return window
    ? { kind: "window", id: window.id }
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
    ...(plan.sketches ?? []).flatMap((item): PlanCommand[] =>
      keys.has("sketch:" + item.id)
        ? [
            {
              type: "sketch.update",
              id: item.id,
              geometry: shiftSketch(item.geometry, delta),
            },
          ]
        : [],
    ),
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
    ...(plan.windows ?? []).flatMap((window): PlanCommand[] => {
      if (!keys.has("window:" + window.id) || keys.has("wall:" + window.wallId))
        return [];
      const wall = walls.get(window.wallId)!;
      const along =
        ((wall.end.x - wall.start.x) * delta.x +
          (wall.end.y - wall.start.y) * delta.y) /
        wallLength(wall);
      return [
        {
          type: "window.update",
          id: window.id,
          changes: { offsetMm: Math.round(window.offsetMm + along) },
        },
      ];
    }),
    ...(plan.annotations ?? []).flatMap((dimension): PlanCommand[] =>
      keys.has("dimension:" + dimension.id)
        ? [
            {
              type: "dimension.update",
              id: dimension.id,
              changes: {
                start: shifted(dimension.start),
                end: shifted(dimension.end),
              },
            },
          ]
        : [],
    ),
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
    ...(plan.sketches ?? []).flatMap((item): PlanCommand[] =>
      keys.has("sketch:" + item.id)
        ? [{ type: "sketch.remove", id: item.id }]
        : [],
    ),
    ...plan.openings.flatMap((door): PlanCommand[] =>
      keys.has("door:" + door.id) && !keys.has("wall:" + door.wallId)
        ? [{ type: "door.remove", id: door.id }]
        : [],
    ),
    ...(plan.windows ?? []).flatMap((window): PlanCommand[] =>
      keys.has("window:" + window.id) && !keys.has("wall:" + window.wallId)
        ? [{ type: "window.remove", id: window.id }]
        : [],
    ),
    ...(plan.annotations ?? []).flatMap((dimension): PlanCommand[] =>
      keys.has("dimension:" + dimension.id)
        ? [{ type: "dimension.remove", id: dimension.id }]
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
      case "sketch.update":
        result.sketches = result.sketches?.map((item) =>
          item.id === edit.id ? { ...item, geometry: edit.geometry } : item,
        );
        break;
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
      case "window.update":
        result.windows = result.windows?.map((window) =>
          window.id === edit.id ? { ...window, ...edit.changes } : window,
        );
        break;
      case "dimension.update":
        result.annotations = result.annotations?.map((dimension) =>
          dimension.id === edit.id
            ? { ...dimension, ...edit.changes }
            : dimension,
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
