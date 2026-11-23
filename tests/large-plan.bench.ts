import { bench, describe } from "vitest";
import { summarizeChanges } from "../lib/plans/change-summary";
import { findClashes } from "../lib/plans/coordination";
import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";
import { renderBlueprint } from "../lib/plans/blueprints";
import type { DraftPlanState, Point } from "../lib/plans/model";

const graph = initialGraph();
const template = initialGraph({ width: 4000, depth: 3200 }).walls;
for (let index = 0; index < 96; index++) {
  const x = (index % 12) * 5000;
  const y = Math.floor(index / 12) * 4100;
  const offset = (point: Point) => ({ x: point.x + x, y: point.y + y });
  graph.walls.push(
    ...template.map((wall, edge) => ({
      ...wall,
      id: "wall-" + index + "-" + edge,
      start: offset(wall.start),
      end: offset(wall.end),
    })),
  );
  graph.fixtures.push({
    id: "fixture-" + index,
    template: "sofa",
    position: offset({ x: 1100, y: 1600 }),
    widthMm: 1800,
    depthMm: 800,
    heightMm: 850,
    rotation: 0,
  });
  if (index % 4 === 0) {
    (graph.coordination ??= []).push({
      id: "route-" + index,
      kind: "route",
      name: "Route " + index,
      storeyId: "ground",
      system: "plumbing",
      diameterMm: 40,
      nodes: [
        { kind: "point", point: offset({ x: 500, y: 1400 }), zMm: 40 },
        { kind: "point", point: offset({ x: 3500, y: 1400 }), zMm: 40 },
      ],
    });
  }
}
const plan = loadDraftPlan(graph);
if (plan.rooms.length !== 96 || plan.walls.length !== 384)
  throw new Error("Benchmark fixture changed");
const revised: DraftPlanState = {
  ...plan,
  fixtures: plan.fixtures.map((item, index) =>
    index < 12
      ? { ...item, position: { ...item.position, y: item.position.y + 300 } }
      : item,
  ),
};

describe("large plan · 384 walls, 96 rooms, 96 fixtures, 24 service routes", () => {
  bench("load and rebuild topology", () => {
    loadDraftPlan(graph);
  });
  bench("compare 12 fixture changes", () => {
    summarizeChanges(plan, revised);
  });
  bench("screen service clashes", () => {
    findClashes(plan);
  });
  bench("render SVG blueprint", () => {
    renderBlueprint("svg", plan, "Benchmark");
  });
});
