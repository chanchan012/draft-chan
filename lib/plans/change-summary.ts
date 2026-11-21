import { studioSnapshot } from "./studio-document";
import type { DraftPlanState } from "./model";

const collections = [
  ["wall", "walls"],
  ["storey", "storeys"],
  ["wall_type", "wallTypes"],
  ["building_element", "buildingElements"],
  ["building_view", "buildingViews"],
  ["document_item", "documentItems"],
  ["door", "openings"],
  ["window", "windows"],
  ["fixture", "fixtures"],
  ["utility", "utilities"],
  ["dimension", "annotations"],
  ["sketch", "sketches"],
  ["constraint", "constraints"],
  ["layer", "drawingLayers"],
  ["block", "blocks"],
  ["block_instance", "blockInstances"],
] as const;

export function summarizeChanges(
  before: DraftPlanState,
  after: DraftPlanState,
) {
  const earlier = studioSnapshot(before, "mm");
  const later = studioSnapshot(after, "mm");
  const changes = collections.flatMap(([kind, field]) => {
    const old = new Map(
      (earlier[field] ?? []).map((entity) => [entity.id, entity]),
    );
    const current = new Map(
      (later[field] ?? []).map((entity) => [entity.id, entity]),
    );
    return [...new Set([...old.keys(), ...current.keys()])]
      .sort()
      .flatMap((id) => {
        const before = old.get(id);
        const after = current.get(id);
        if (JSON.stringify(before) === JSON.stringify(after)) return [];
        return [
          {
            kind,
            id,
            action: before ? (after ? "updated" : "removed") : "added",
            before,
            after,
          },
        ];
      });
  });
  const hosts = new Set(
    changes.filter(({ kind }) => kind === "wall").map(({ id }) => id),
  );
  const affectedOpenings = [
    ...earlier.openings,
    ...earlier.windows,
    ...later.openings,
    ...later.windows,
  ]
    .filter(({ wallId }) => hosts.has(wallId))
    .filter(
      (opening, i, items) =>
        items.findIndex(({ id }) => id === opening.id) === i,
    )
    .map(({ id, wallId }) => ({ id, wallId }));
  const warnings =
    hosts.size && earlier.annotations.length
      ? [
          "Dimension annotations use independent points. Include them in a transform or review their endpoints after editing walls.",
        ]
      : [];
  return { changes, affectedOpenings, warnings };
}
