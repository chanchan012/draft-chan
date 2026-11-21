import { expect, it } from "vitest";
import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { groundStorey, planStoreys, storeyPlan } from "../lib/plans/storeys";
import { querySpaces } from "../lib/plans/spaces";
import { measureWallEdges } from "../lib/plans/precision";
import { renderBlueprint } from "../lib/plans/blueprints";
import {
  applyStudioSnapshot,
  studioSnapshot,
} from "../lib/plans/studio-document";

const actor = { kind: "human", id: "architect" } as const;
const upper = {
  id: "upper",
  name: "Upper floor",
  elevationMm: 3000,
  wallHeightMm: 2700,
};

it("opens legacy plans on ground and keeps stacked wall topology and quantities independent", () => {
  const original = initialGraph({ width: 4000, depth: 3000 });
  const store = createDraftPlanStore(original);
  expect(planStoreys(store.getState().plan)).toEqual([groundStorey]);
  store.getState().executeBatch(
    [
      { type: "storey.write", storey: upper },
      ...original.walls.map((wall, i) => ({
        type: "wall.add" as const,
        wall: { ...wall, id: "upper-" + i, storeyId: upper.id },
      })),
    ],
    actor,
  );
  const model = store.getState().plan;
  expect(model.rooms).toHaveLength(2);
  expect(storeyPlan(model, upper.id).rooms[0].storeyId).toBe("upper");
  expect(querySpaces(model).map((level) => level.netAreaM2)).toEqual([
    11.1744, 11.1744,
  ]);
  expect(querySpaces(model, "upper")[0].grossAreaM2).toBeCloseTo(12.8544);
  expect(renderBlueprint("svg", model, "Stacked")).toContain(
    ">Upper floor</text>",
  );
  const saved = applyStudioSnapshot(
    original,
    { revision: 0, ...studioSnapshot(model, "mm") },
    actor,
  );
  expect(saved.rooms).toEqual(model.rooms);
});

it("keeps an authored face anchored while a thicker assembly reduces net width", () => {
  const graph = initialGraph({ width: 4000, depth: 3000 });
  const store = createDraftPlanStore(graph);
  const reference = graph.walls[0];
  const assembly = {
    id: "outside",
    name: "External",
    layers: [
      { material: "Core", thicknessMm: 170 },
      { material: "Finish", thicknessMm: 30 },
    ],
  };
  store.getState().executeBatch(
    [
      { type: "wall_type.write", wallType: assembly },
      {
        type: "wall.assembly",
        id: reference.id,
        wallTypeId: assembly.id,
        referenceLine: "negative",
      },
    ],
    actor,
  );
  const before = querySpaces(store.getState().plan)[0].netAreaM2;
  store
    .getState()
    .execute(
      {
        type: "wall_type.write",
        wallType: {
          ...assembly,
          layers: [{ material: "Core", thicknessMm: 300 }],
        },
      },
      actor,
    );
  const plan = loadDraftPlan(store.getState().plan);
  expect(plan.walls[0]).toMatchObject({
    start: reference.start,
    end: reference.end,
    thicknessMm: 300,
    referenceLine: "negative",
  });
  expect(querySpaces(plan)[0].netAreaM2).toBeCloseTo(before - 0.388);
  expect(
    measureWallEdges(
      plan.walls,
      { wallId: reference.id, edge: "negative" },
      { wallId: reference.id, edge: "positive" },
      "mm",
    )?.distanceMm,
  ).toBeCloseTo(300);
});
