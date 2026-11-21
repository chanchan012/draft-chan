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
