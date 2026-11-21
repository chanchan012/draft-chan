import { expect, it } from "vitest";
import { cadEditCommands } from "../lib/plans/cad-edit";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { initialGraph } from "../lib/plans/plan-state";
import {
  applyStudioSnapshot,
  studioSnapshot,
} from "../lib/plans/studio-document";

it("copies linked objects and preserves native edits as instance overrides across saves", () => {
  const actor = { kind: "human", id: "drafter" } as const;
  const store = createDraftPlanStore(
    initialGraph({ width: 5000, depth: 4000 }),
  );
  const definition = {
    kind: "door",
    id: "entry-type",
    name: "Entry door",
    parameters: { widthMm: 900, hinge: "start", swing: "right" },
  } as const;
  const wallId = "starter-wall-1";
  store.getState().executeBatch(
    [
      { type: "block.define", definition },
      {
        type: "block.insert",
        id: "door",
        blockId: definition.id,
        placement: { kind: "door", wallId, offsetMm: 2000 },
      },
    ],
    actor,
  );
  store
    .getState()
    .execute(
      { type: "door.update", id: "door", changes: { hinge: "end" } },
      actor,
    );
  const beforeCopy = store.getState().plan;
  let index = 0;
  store.getState().executeBatch(
    cadEditCommands(
      beforeCopy,
      {
        operation: "transform",
        entities: [{ kind: "wall", id: wallId }],
        transform: {
          mode: "mirror",
          axisStart: { x: 0, y: 500 },
          axisEnd: { x: 5000, y: 500 },
          copy: true,
        },
      },
      () => "copy-" + ++index,
    ),
    actor,
  );
  expect(store.getState().plan.blockInstances).toMatchObject([
    { id: "copy-2", overrides: { hinge: "end", swing: "left" } },
    { id: "door", overrides: { hinge: "end" } },
  ]);

  const before = store.getState().plan;
  store.getState().execute(
    {
      type: "block.update",
      definition: {
        ...definition,
        parameters: { ...definition.parameters, widthMm: 1000 },
      },
    },
    actor,
  );
  const saved = applyStudioSnapshot(
    before,
    { revision: 1, ...studioSnapshot(store.getState().plan, "mm") },
    actor,
  );
  expect(saved.blockInstances).toEqual(before.blockInstances);
  expect(saved.openings.map((item) => item.widthMm)).toEqual([1000, 1000]);
});
