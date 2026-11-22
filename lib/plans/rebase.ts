import { compareText } from "./model";
import type { studioSnapshot } from "./studio-document";

export type StudioSnapshot = ReturnType<typeof studioSnapshot>;
export const encodeSnapshot = (snapshot: StudioSnapshot) =>
  JSON.stringify(snapshot);

function mergeItems<T extends { id: string }>(
  base: T[],
  draft: T[],
  saved: T[],
): T[] {
  const indexed = (items: T[]) => new Map(items.map((item) => [item.id, item]));
  const original = indexed(base);
  const local = indexed(draft);
  const remote = indexed(saved);
  const ids = new Set([...original.keys(), ...local.keys(), ...remote.keys()]);
  const merged: T[] = [];
  for (const id of [...ids].sort(compareText)) {
    const before = JSON.stringify(original.get(id));
    const left = local.get(id);
    const right = remote.get(id);
    const localValue = JSON.stringify(left);
    const remoteValue = JSON.stringify(right);
    if (
      localValue !== before &&
      remoteValue !== before &&
      localValue !== remoteValue
    )
      throw new Error("Both editors changed the same element.");
    const next = localValue !== before ? left : right;
    if (next) merged.push(next);
  }
  return merged;
}

export function rebaseSnapshot(
  base: StudioSnapshot,
  draft: StudioSnapshot,
  saved: StudioSnapshot,
): StudioSnapshot {
  return {
    unit: draft.unit === base.unit ? saved.unit : draft.unit,
    walls: mergeItems(base.walls, draft.walls, saved.walls),
    openings: mergeItems(base.openings, draft.openings, saved.openings),
    fixtures: mergeItems(base.fixtures, draft.fixtures, saved.fixtures),
    utilities: mergeItems(base.utilities, draft.utilities, saved.utilities),
    windows: mergeItems(base.windows, draft.windows, saved.windows),
    storeys:
      base.storeys || draft.storeys || saved.storeys
        ? mergeItems(
            base.storeys ?? [],
            draft.storeys ?? [],
            saved.storeys ?? [],
          )
        : undefined,
    buildingElements: mergeItems(
      base.buildingElements,
      draft.buildingElements,
      saved.buildingElements,
    ),
    buildingViews: mergeItems(
      base.buildingViews,
      draft.buildingViews,
      saved.buildingViews,
    ),
    documentItems: mergeItems(
      base.documentItems,
      draft.documentItems,
      saved.documentItems,
    ),
    underlays: mergeItems(base.underlays, draft.underlays, saved.underlays),
    drawingReferences: mergeItems(
      base.drawingReferences,
      draft.drawingReferences,
      saved.drawingReferences,
    ),
    wallTypes: mergeItems(base.wallTypes, draft.wallTypes, saved.wallTypes),
    drawingLayers: mergeItems(
      base.drawingLayers,
      draft.drawingLayers,
      saved.drawingLayers,
    ),
    blocks: mergeItems(base.blocks, draft.blocks, saved.blocks),
    blockInstances: mergeItems(
      base.blockInstances,
      draft.blockInstances,
      saved.blockInstances,
    ),
    constraints: mergeItems(
      base.constraints,
      draft.constraints,
      saved.constraints,
    ),
    sketches: mergeItems(base.sketches, draft.sketches, saved.sketches),
    annotations: mergeItems(
      base.annotations,
      draft.annotations,
      saved.annotations,
    ),
  };
}
