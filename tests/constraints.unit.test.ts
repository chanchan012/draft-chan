import { expect, it } from "vitest";
import { constraintReport, ConstraintConflict } from "../lib/plans/constraints";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { initialGraph } from "../lib/plans/plan-state";
import {
  applyStudioSnapshot,
  studioSnapshot,
} from "../lib/plans/studio-document";
import { renderBlueprint } from "../lib/plans/blueprints";
import type { Constraint, WallEndpoint } from "../lib/plans/model";

const actor = { kind: "human", id: "architect" } as const;
const id = (wall: number) => "starter-wall-" + wall;
const point = (
  wall: number,
  endpoint: WallEndpoint["endpoint"],
): WallEndpoint => ({ wallId: id(wall), endpoint });
const room = () => {
  const graph = initialGraph({ width: 4000, depth: 3000 });
  graph.openings.push({
    id: "entry",
    wallId: id(1),
    offsetMm: 1900,
    widthMm: 900,
    hinge: "start",
    swing: "right",
  });
  const store = createDraftPlanStore(graph);
  const relation = (
    kind: "parallel" | "perpendicular" | "equal_length",
    a: number,
    b: number,
  ): Constraint => ({
    kind,
    id: kind + a + b,
    firstWallId: id(a),
    secondWallId: id(b),
  });
  const distance = (
    name: string,
    wall: number,
    distanceMm: number,
  ): Constraint => ({
    kind: "fixed_distance",
    id: name,
    first: point(wall, "start"),
    second: point(wall, "end"),
    distanceMm,
  });
  store.getState().executeBatch(
    [
      relation("parallel", 1, 3),
      relation("parallel", 2, 4),
      relation("perpendicular", 1, 2),
      relation("equal_length", 1, 3),
      distance("width", 1, 4000),
      distance("depth", 2, 3000),
    ].map((constraint) => ({ type: "constraint.add", constraint })),
    actor,
  );
  return { store, distance };
};

it("solves a room width without breaking square corners or hosted openings", () => {
  const { store } = room();
  expect(
    constraintReport(
      store.getState().plan.walls,
      store.getState().plan.constraints,
    ).degreesOfFreedom,
  ).toBe(3);
  store
    .getState()
    .execute(
      { type: "constraint.drive", id: "width", distanceMm: 4800 },
      actor,
    );
  const plan = store.getState().plan;
  expect(plan.walls[0]).toMatchObject({
    start: { x: -400, y: 0 },
    end: { x: 4400, y: 0 },
  });
  expect(plan.rooms).toHaveLength(1);
  expect(plan.openings[0]).toMatchObject({
    id: "entry",
    offsetMm: 1900,
    wallId: id(1),
  });
  expect(renderBlueprint("svg", plan, "Constraints")).toContain("4800 mm");
  const saved = applyStudioSnapshot(
    plan,
    { revision: 2, ...studioSnapshot(plan, "mm") },
    actor,
  );
  expect(saved.constraints).toEqual(plan.constraints);
  store.getState().undo();
  expect(store.getState().plan.walls[0].end.x).toBe(4000);
});

it("reports conflicting IDs and rejects solutions that cut an opening", () => {
  const { store, distance } = room();
  const original = store.getState().plan;
  expect(() =>
    store
      .getState()
      .execute(
        { type: "constraint.add", constraint: distance("impossible", 1, 2000) },
        actor,
      ),
  ).toThrow(ConstraintConflict);
  expect(() =>
    store
      .getState()
      .execute(
        { type: "constraint.drive", id: "width", distanceMm: 1200 },
        actor,
      ),
  ).toThrow("hosted opening entry");
  expect(store.getState().plan).toBe(original);
});

it("merges two separated endpoints with a coincident relation", () => {
  const graph = initialGraph();
  graph.walls = [
    {
      id: "a",
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 0 },
      thicknessMm: 100,
      kind: "interior",
    },
    {
      id: "b",
      start: { x: 1200, y: 150 },
      end: { x: 1200, y: 1000 },
      thicknessMm: 100,
      kind: "interior",
    },
  ];
  const store = createDraftPlanStore(graph);
  store.getState().execute(
    {
      type: "constraint.add",
      constraint: {
        id: "join",
        kind: "coincident",
        first: { wallId: "a", endpoint: "end" },
        second: { wallId: "b", endpoint: "start" },
      },
    },
    actor,
  );
  const [a, b] = store.getState().plan.walls;
  expect(a.end).toEqual(b.start);
  expect(a.end).toEqual({ x: 1100, y: 75 });
});
