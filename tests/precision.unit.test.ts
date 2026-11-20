import { calculateBom } from "../lib/plans/bom";
import { renderBlueprint } from "../lib/plans/blueprints";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { initialGraph } from "../lib/plans/plan-state";
import { polarTarget } from "../lib/plans/sketch";
import {
  applyStudioSnapshot,
  studioSnapshot,
} from "../lib/plans/studio-document";
import { expect, it } from "vitest";
import {
  measurePoints,
  measureWallEdges,
  resolveSnap,
} from "../lib/plans/precision";
import type { Wall } from "../lib/plans/model";

const wall = (id: string, a: number[], b: number[]): Wall => ({
  id,
  start: { x: a[0], y: a[1] },
  end: { x: b[0], y: b[1] },
  thicknessMm: 120,
  kind: "interior",
});

it("resolves segment intersections and perpendiculars with stable references", () => {
  const walls = [
    wall("a", [0, 0], [4000, 4000]),
    wall("b", [0, 4000], [4000, 0]),
  ];
  expect(
    resolveSnap(
      walls.reverse(),
      { x: 2005, y: 2004 },
      {
        radiusMm: 20,
        modes: ["intersection"],
      },
    ),
  ).toMatchObject({
    point: { x: 2000, y: 2000 },
    references: [
      { wallId: "a", edge: "center" },
      { wallId: "b", edge: "center" },
    ],
  });
  expect(
    resolveSnap(
      walls,
      { x: 1499, y: 1499 },
      {
        radiusMm: 20,
        anchor: { x: 1000, y: 2000 },
        modes: ["perpendicular"],
      },
    )?.point,
  ).toEqual({ x: 1500, y: 1500 });
});

it("measures a rotated room by its finished faces and converts without storage rounding", () => {
  const walls = [
    wall("a", [0, 0], [3000, 4000]),
    wall("b", [800, -600], [3800, 3400]),
  ];
  const measurement = measureWallEdges(
    walls,
    { wallId: "a", edge: "negative" },
    { wallId: "b", edge: "positive" },
    "m",
  )!;
  expect(measurement.distanceMm).toBeCloseTo(880);
  expect(measurement.value).toBeCloseTo(0.88);
  expect(
    measurePoints({ x: 0, y: 0 }, { x: 3657.6, y: 0 }, "ft").value,
  ).toBeCloseTo(12);
});

it("keeps saved sketch geometry in exports, outside room topology and quantities", () => {
  const actor = { kind: "human", id: "test" } as const;
  const graph = initialGraph({ width: 4000, depth: 4000 });
  const store = createDraftPlanStore(graph);
  const center = { x: 1000, y: 1200 };
  store.getState().executeBatch(
    [
      {
        type: "sketch.add",
        sketch: {
          id: "guide",
          geometry: {
            kind: "construction",
            start: center,
            end: { x: 1500, y: 1200 },
          },
        },
      },
      {
        type: "sketch.add",
        sketch: {
          id: "outline",
          geometry: {
            kind: "arc",
            center,
            radiusMm: 250,
            startDeg: 300,
            sweepDeg: 110,
          },
        },
      },
    ],
    actor,
  );
  const plan = store.getState().plan;
  expect(plan.rooms).toEqual(graph.rooms);
  expect(calculateBom(plan)).toEqual(calculateBom(graph));
  expect(
    applyStudioSnapshot(
      graph,
      { revision: 0, ...studioSnapshot(plan, "mm") },
      actor,
    ).sketches,
  ).toEqual(plan.sketches);
  expect(renderBlueprint("svg", plan, "draft")).toContain(
    'stroke-dasharray="32 20"',
  );
  expect(renderBlueprint("dxf", plan, "draft")).toMatch(/\n0\nARC\n/);
  expect(
    polarTarget({ x: 100, y: 100 }, { x: 209, y: 201 }, 45, 50),
  ).toMatchObject({
    x: expect.closeTo(206.066),
    y: expect.closeTo(206.066),
  });
});
