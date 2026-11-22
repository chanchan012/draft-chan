import type {
  DraftPlanState,
  Point,
  Underlay,
  UnderlayCalibration,
} from "./model";
import { storeyById } from "./storeys";

export function underlayTransform(calibration: UnderlayCalibration) {
  const {
    pixels: [p, q],
    model: [a, b],
  } = calibration;
  const dx = q.x - p.x,
    dy = q.y - p.y;
  const ux = b.x - a.x,
    uy = b.y - a.y;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength < 1 || ux * ux + uy * uy < 1)
    throw new Error("Choose two distinct points in the source and the model.");
  const cosine = (dx * ux + dy * uy) / squaredLength;
  const sine = (dx * uy - dy * ux) / squaredLength;
  const x = a.x - cosine * p.x + sine * p.y;
  const y = a.y - sine * p.x - cosine * p.y;
  return { cosine, sine, x, y, scale: Math.hypot(cosine, sine) };
}

export function underlayPoint(
  calibration: UnderlayCalibration,
  point: Point,
): Point {
  const { x, y, cosine, sine } = underlayTransform(calibration);
  return {
    x: x + cosine * point.x - sine * point.y,
    y: y + sine * point.x + cosine * point.y,
  };
}

export function validateUnderlays(plan: DraftPlanState) {
  const items = plan.underlays ?? [];
  if (new Set(items.map(({ id }) => id)).size !== items.length)
    throw new Error("Underlay IDs must be unique.");
  for (const item of items) {
    storeyById(plan, item.storeyId);
    if (
      item.calibration.pixels.some(
        ({ x, y }) => x > item.width || y > item.height,
      )
    )
      throw new Error("Calibration points must be inside the source preview.");
    const { scale } = underlayTransform(item.calibration);
    if (scale * Math.max(item.width, item.height) > 2_000_000)
      throw new Error(
        "The calibrated underlay exceeds the supported drawing size.",
      );
  }
}

export function underlayMetadata({ raster: _raster, ...metadata }: Underlay) {
  return metadata;
}
