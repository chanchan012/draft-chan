import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";
import type { DraftPlanState } from "../lib/plans/model";

export function sheetFixture(): DraftPlanState {
  const plan = initialGraph({ width: 5000, depth: 3000 });
  plan.openings = [
    {
      id: "door",
      wallId: "starter-wall-2",
      offsetMm: 1200,
      widthMm: 900,
      hinge: "start",
      swing: "left",
    },
  ];
  plan.windows = [
    {
      id: "window",
      wallId: "starter-wall-3",
      offsetMm: 2500,
      widthMm: 1300,
      sillMm: 900,
      heightMm: 1000,
    },
  ];
  plan.documentItems = [
    {
      kind: "sheet",
      id: "sheet",
      number: "A101",
      name: "Ground plan",
      size: "A3",
      orientation: "landscape",
      project: "Oak House",
      drawnBy: "Casey",
    },
    {
      kind: "view",
      id: "view",
      source: { kind: "plan", storeyId: "ground" },
      center: { x: 2500, y: 1500 },
      name: "Ground floor",
    },
    {
      kind: "viewport",
      id: "panel",
      sheetId: "sheet",
      viewId: "view",
      x: 10,
      y: 10,
      width: 400,
      height: 250,
      scale: 50,
    },
    {
      kind: "chain",
      id: "overall",
      axis: "horizontal",
      storeyId: "ground",
      offsetMm: -400,
      anchors: [
        { kind: "wall", id: "starter-wall-1", end: "start" },
        { kind: "wall", id: "starter-wall-1", end: "end" },
      ],
    },
    {
      kind: "tag",
      id: "door-tag",
      storeyId: "ground",
      target: { kind: "door", id: "door" },
      labelAt: { x: 5480, y: 1200 },
      text: "D-01",
    },
    {
      kind: "tag",
      id: "window-tag",
      storeyId: "ground",
      target: { kind: "window", id: "window" },
      labelAt: { x: 2500, y: 3500 },
      text: "W-03",
    },
    {
      kind: "finish",
      id: "living",
      storeyId: "ground",
      point: { x: 2500, y: 1500 },
      room: "Living room",
      floor: "Oak parquet",
      walls: "Matte plaster",
      ceiling: "White paint",
    },
  ];
  return loadDraftPlan(plan);
}
