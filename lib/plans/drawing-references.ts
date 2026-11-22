import {
  drawingReferenceInput,
  sketchSchema,
  type DrawingReference,
  type DraftPlanState,
  type Point,
} from "./model";
import type { StagedDxf } from "./dxf-import";
import { sketchPoints } from "./sketch";
import { storeyById } from "./storeys";

export function validateDrawingReferences(plan: DraftPlanState) {
  const items = plan.drawingReferences ?? [];
  if (new Set(items.map(({ id }) => id)).size !== items.length)
    throw new Error("Drawing reference IDs must be unique.");
  let vertices = 0;
  for (const item of items) {
    storeyById(plan, item.storeyId);
    const layers = new Set(item.layers.map(({ name }) => name));
    if (layers.size !== item.layers.length)
      throw new Error("Reference layers need unique names.");
    for (const { layer, geometry } of item.shapes) {
      if (!layers.has(layer))
        throw new Error("A reference shape needs an existing reference layer.");
      if (!sketchSchema.safeParse({ id: item.id, geometry }).success)
        throw new Error("A reference contains invalid geometry.");
      vertices += geometry.kind === "polyline" ? geometry.points.length : 2;
    }
  }
  if (vertices > 12_000)
    throw new Error("The plan can store up to 12,000 reference vertices.");
}

export function createDrawingReference(
  stage: StagedDxf,
  name: string,
  storeyId: string,
  id: string,
  selected?: string[],
  previous?: DrawingReference,
  offset: Point = { x: 0, y: 0 },
) {
  if (!stage.unit)
    throw new Error(
      "Choose the source length unit before attaching the reference.",
    );
  const picked = selected && new Set(selected);
  const shapes = stage.shapes.filter(
    ({ layer }) => !picked || picked.has(layer),
  );
  if (!shapes.length)
    throw new Error("Choose at least one layer with reference geometry.");
  const used = new Set(shapes.map(({ layer }) => layer));
  const layers = stage.layers
    .filter(({ name }) => used.has(name))
    .map(({ name, color, lineStyle }) => ({ name, color, lineStyle }));
  return drawingReferenceInput.parse({
    id,
    name,
    storeyId,
    unit: stage.unit,
    layers,
    shapes,
    offset: previous?.offset ?? offset,
    visible: previous?.visible ?? true,
    version: (previous?.version ?? 0) + 1,
  });
}

export function referenceMetadata({ shapes, ...rest }: DrawingReference) {
  return { ...rest, entities: shapes.length };
}

export function referencePoints(plan: DraftPlanState, storeyId: string) {
  return (plan.drawingReferences ?? [])
    .filter((item) => item.storeyId === storeyId && item.visible)
    .flatMap(({ shapes, offset }) =>
      shapes.flatMap(({ geometry }) =>
        sketchPoints(geometry).map(({ x, y }) => ({
          x: x + offset.x,
          y: y + offset.y,
        })),
      ),
    );
}
