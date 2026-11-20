import type {
  DimensionAnnotation,
  DisplayUnit,
  Fixture,
  Point,
  Utility,
  Wall,
} from "./model";
import { fixtureFootprint, bounds } from "./footprints";
import { wallLength } from "./openings";

export interface Viewport {
  width: number;
  height: number;
}
export interface Camera extends Point {
  scale: number;
}
export const wallHeight = 2450;
export const gridSteps = {
  mm: [50, 100, 250, 500],
  in: [1, 6, 12, 24],
} as const;
export const extent = 1_000_000;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const constrain = (point: Point): Point => ({
  x: clamp(Math.round(point.x), -extent, extent),
  y: clamp(Math.round(point.y), -extent, extent),
});

export function unitFactor(unit: DisplayUnit) {
  return unit === "mm" ? 1 : 25.4;
}

export function snapPoint(
  point: Point,
  grid: number,
  start?: Point,
  ortho = false,
): Point {
  // Round only after snapping so inch increments do not accumulate drift.
  const x = Math.round(point.x / grid) * grid;
  const y = Math.round(point.y / grid) * grid;
  if (!start || !ortho) return constrain({ x, y });
  return Math.abs(point.x - start.x) >= Math.abs(point.y - start.y)
    ? constrain({ x, y: start.y })
    : constrain({ x: start.x, y });
}

export function wallHit(point: Point, walls: readonly Wall[], radius: number) {
  let result: { wall: Wall; offset: number; distance: number } | undefined;
  for (const wall of walls) {
    const length = wallLength(wall);
    const dx = (wall.end.x - wall.start.x) / length;
    const dy = (wall.end.y - wall.start.y) / length;
    const offset = clamp(
      (point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy,
      0,
      length,
    );
    const distance = Math.hypot(
      point.x - wall.start.x - offset * dx,
      point.y - wall.start.y - offset * dy,
    );
    if (
      distance <= radius + wall.thicknessMm / 2 &&
      (!result || distance < result.distance)
    ) {
      result = { wall, offset, distance };
    }
  }
  return result;
}

export function snapWallPoint(
  point: Point,
  walls: readonly Wall[],
  grid: number,
  radius: number,
  start?: Point,
  ortho = false,
) {
  let nearest: Point | undefined;
  let best = radius;
  for (const wall of walls) {
    for (const candidate of [wall.start, wall.end]) {
      if (start && ortho && start.x !== candidate.x && start.y !== candidate.y)
        continue;
      if (start && start.x === candidate.x && start.y === candidate.y) continue;
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (distance <= best) {
        best = distance;
        nearest = candidate;
      }
    }
  }
  return nearest ?? snapPoint(point, grid, start, ortho);
}

export function projectIso(point: Point, elevation = 0): Point {
  return {
    x: ((point.x - point.y) * Math.sqrt(3)) / 2,
    y: (point.x + point.y) / 2 - elevation,
  };
}

export function fitCamera(
  walls: readonly Wall[],
  viewport: Viewport,
  isometric = false,
  fixtures: readonly Fixture[] = [],
  utilities: readonly Utility[] = [],
  dimensions: readonly DimensionAnnotation[] = [],
): Camera {
  if (
    !walls.length &&
    !fixtures.length &&
    (isometric || (!utilities.length && !dimensions.length))
  )
    return {
      x: 0,
      y: 0,
      scale: Math.min(0.11, Math.min(viewport.width, viewport.height) / 4200),
    };
  const points = walls.flatMap((wall) =>
    [wall.start, wall.end].flatMap((p) => {
      const r = wall.thicknessMm / 2;
      const bounds = [
        { x: p.x - r, y: p.y - r },
        { x: p.x + r, y: p.y + r },
        { x: p.x + r, y: p.y - r },
        { x: p.x - r, y: p.y + r },
      ];
      return isometric
        ? bounds.flatMap((corner) => [
            projectIso(corner),
            projectIso(corner, wallHeight),
          ])
        : bounds;
    }),
  );
  for (const fixture of fixtures) {
    const footprint = fixtureFootprint(fixture);
    points.push(
      ...(isometric
        ? footprint.flatMap((corner) => [
            projectIso(corner),
            projectIso(corner, fixture.heightMm),
          ])
        : footprint),
    );
  }
  if (!isometric) {
    points.push(...utilities.map(({ position }) => position));
    points.push(...dimensions.flatMap(({ start, end }) => [start, end]));
  }
  const { left, right, top, bottom } = bounds(points);
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    scale: clamp(
      Math.min(
        (viewport.width * (isometric ? 0.86 : 0.78)) /
          Math.max(1200, right - left),
        (viewport.height * (isometric ? 0.78 : 0.73)) /
          Math.max(1200, bottom - top),
      ),
      0.00001,
      0.45,
    ),
  };
}

export function modelPoint(
  point: Point,
  viewport: Viewport,
  camera: Camera,
): Point {
  return {
    x: camera.x + (point.x - viewport.width / 2) / camera.scale,
    y: camera.y + (point.y - viewport.height / 2) / camera.scale,
  };
}

export function zoomCamera(
  camera: Camera,
  viewport: Viewport,
  anchor: Point,
  factor: number,
): Camera {
  const point = modelPoint(anchor, viewport, camera);
  const scale = clamp(camera.scale * factor, 0.00001, 2);
  return {
    x: point.x - (anchor.x - viewport.width / 2) / scale,
    y: point.y - (anchor.y - viewport.height / 2) / scale,
    scale,
  };
}

// Keep the original model point below the moving midpoint of a two-finger gesture.
export function pinchCamera(
  baseline: Camera,
  viewport: Viewport,
  from: Point,
  to: Point,
  initialDistance: number,
  distance: number,
): Camera {
  const zoomed = zoomCamera(
    baseline,
    viewport,
    from,
    distance / Math.max(1, initialDistance),
  );
  return {
    x: zoomed.x + (from.x - to.x) / zoomed.scale,
    y: zoomed.y + (from.y - to.y) / zoomed.scale,
    scale: zoomed.scale,
  };
}
