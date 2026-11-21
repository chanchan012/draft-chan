import { describe, it, expect } from "vitest";
import {
  cadEditCommands,
  cadEditSchema,
  type CadEdit,
} from "../lib/plans/cad-edit";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { summarizeChanges } from "../lib/plans/change-summary";
import { initialGraph } from "../lib/plans/plan-state";
import { sketchPoints } from "../lib/plans/sketch";

const actor = { kind: "human", id: "test" } as const;
const p = (x: number, y: number) => ({ x, y });
const wall = (id: string) => ({ kind: "wall", id }) as const;
const sketch = (id: string) => ({ kind: "sketch", id }) as const;
const a = wall("starter-wall-1");
const b = wall("starter-wall-2");
const seeded = () => {
  const graph = initialGraph({ width: 4000, depth: 3000 });
  graph.openings.push({
    id: "door",
    wallId: a.id,
    offsetMm: 1000,
    widthMm: 900,
    hinge: "start",
    swing: "right",
  });
  graph.windows = [
    {
      id: "window",
      wallId: a.id,
      offsetMm: 3000,
      widthMm: 600,
      sillMm: 800,
      heightMm: 1100,
    },
  ];
  graph.sketches = [
    {
      id: "s",
      geometry: { kind: "construction", start: p(0, 0), end: p(1200, 0) },
    },
    {
      id: "t",
      geometry: { kind: "construction", start: p(0, 0), end: p(0, 1200) },
    },
    {
      id: "boundary",
      geometry: {
        kind: "construction",
        start: p(600, -100),
        end: p(600, 1800),
      },
    },
    {
      id: "extension",
      geometry: {
        kind: "construction",
        start: p(-200, -100),
        end: p(-200, 1800),
      },
    },
  ];
  const store = createDraftPlanStore(graph);
  let index = 0;
  const run = (input: CadEdit) =>
    store.getState().executeBatch(
      cadEditCommands(
        store.getState().plan,
        cadEditSchema.parse(input),
        () => "new-" + ++index,
      ),
      actor,
    );
  return { run, store, graph };
};
describe("CAD edits", () => {
  it("rotates and mirrors hosts, flips mirrored door swings, and reports every opening", () => {
    const { run, store, graph } = seeded();
    run({
      operation: "transform",
      entities: [a],
      transform: { mode: "rotate", pivot: p(0, 0), angleDeg: 90 },
    });
    expect(store.getState().plan.walls[0].end).toEqual(p(0, 4000));
    run({
      operation: "transform",
      entities: [a],
      transform: {
        mode: "mirror",
        axisStart: p(0, 0),
        axisEnd: p(4000, 0),
        copy: false,
      },
    });
    expect(store.getState().plan.openings[0]).toMatchObject({
      wallId: a.id,
      offsetMm: 1000,
      swing: "left",
    });
    expect(
      summarizeChanges(graph, store.getState().plan).affectedOpenings,
    ).toEqual([
      { id: "door", wallId: a.id },
      { id: "window", wallId: a.id },
    ]);
    store.getState().undo();
    expect(store.getState().plan.openings[0].swing).toBe("right");
  });
  it("copies hosted openings in each instance, including rotated polar arrays", () => {
    const { run, store } = seeded();
    run({
      operation: "array",
      entities: [a],
      count: 3,
      pattern: { mode: "linear", step: p(0, 500) },
    });
    expect(store.getState().plan.walls).toHaveLength(6);
    expect(store.getState().plan.openings).toHaveLength(3);
    expect(store.getState().plan.windows).toHaveLength(3);
    store.getState().undo();
    run({
      operation: "array",
      entities: [a],
      count: 3,
      pattern: { mode: "polar", center: p(0, 0), stepDeg: 90 },
    });
    expect(store.getState().plan.walls).toContainEqual(
      expect.objectContaining({ end: p(-4000, 0) }),
    );
    expect(store.getState().past).toHaveLength(1);
  });
  it("rejects cuts through openings and retains world positions when a start is extended", () => {
    const { run, store } = seeded();
    expect(() =>
      run({
        operation: "trim_extend",
        entity: a,
        boundary: sketch("boundary"),
        mode: "trim",
        endpoint: "start",
      }),
    ).toThrow("opening door");
    expect(store.getState().past).toHaveLength(0);
    run({
      operation: "trim_extend",
      entity: a,
      boundary: sketch("extension"),
      mode: "extend",
      endpoint: "start",
    });
    expect(store.getState().plan.openings[0].offsetMm).toBe(1200);
    expect(store.getState().plan.windows?.[0].offsetMm).toBe(3200);
  });
  it("rounds sketch corners and chamfers walls in one undo step", () => {
    const { run, store } = seeded();
    run({
      operation: "corner",
      first: sketch("s"),
      second: sketch("t"),
      mode: "fillet",
      sizeMm: 200,
    });
    const arc = store
      .getState()
      .plan.sketches!.find(({ id }) => id === "new-1")!.geometry;
    expect(arc).toMatchObject({ kind: "arc", radiusMm: 200, sweepDeg: 90 });
    const [one, two] = sketchPoints(arc);
    expect(one.x).toBeCloseTo(0);
    expect(two.y).toBeCloseTo(0);
    store.getState().undo();
    run({
      operation: "corner",
      first: a,
      second: b,
      mode: "chamfer",
      sizeMm: 200,
    });
    expect(store.getState().plan.rooms).toHaveLength(1);
    expect(store.getState().plan.walls).toHaveLength(5);
    expect(store.getState().past).toHaveLength(1);
  });
});
