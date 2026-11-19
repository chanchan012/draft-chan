import { describe, expect, it } from "vitest";
import { modelPoint, pinchCamera } from "../lib/plans/cad";
import { createDraftPlanStore } from "../lib/plans/command-store";
import {
  moveSelection,
  removeSelection,
  selectInBox,
} from "../lib/plans/editor-selection";
import { initialGraph } from "../lib/plans/plan-state";

describe("editor gestures", () => {
  it("keeps the same model point under a moving two-finger midpoint", () => {
    const size = { width: 500, height: 600 };
    const camera = { x: 50, y: -50, scale: 0.2 };
    const a = { x: 45, y: 70 },
      b = { x: 72, y: 95 };
    const zoomed = pinchCamera(camera, size, a, b, 50, 100);
    expect(zoomed.scale).toBeCloseTo(0.4);
    expect(modelPoint(b, size, zoomed)).toEqual(modelPoint(a, size, camera));
    expect(pinchCamera(camera, size, a, a, 50, 25).scale).toBeCloseTo(0.1);
  });

  it("moves a wall and its selected hosted door together and undoes a group deletion atomically", () => {
    const plan = initialGraph({ width: 5000, depth: 4000 });
    const actor = { kind: "human" as const, id: "editor" };
    const store = createDraftPlanStore(plan);
    store.getState().execute(
      {
        type: "door.add",
        door: {
          id: "door",
          wallId: "starter-wall-1",
          offsetMm: 1000,
          widthMm: 900,
          hinge: "start",
          swing: "left",
        },
      },
      actor,
    );
    const previous = store.getState().plan;
    const selected = selectInBox(
      previous,
      { x: -100, y: -100 },
      { x: 5100, y: 100 },
      { electrical: true, plumbing: true },
    );
    expect(selected.map(({ kind }) => kind)).toEqual(["wall", "door"]);
    store
      .getState()
      .executeBatch(
        moveSelection(previous, selected, { x: 100, y: 100 }),
        actor,
      );
    expect(store.getState().plan.walls[0].start).toEqual({ x: 100, y: 100 });
    expect(store.getState().plan.openings[0].offsetMm).toBe(1000);
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().plan).toEqual(previous);
    expect(() =>
      store.getState().executeBatch(
        [
          { type: "door.remove", id: "door" },
          { type: "wall.remove", id: "missing" },
        ],
        actor,
      ),
    ).toThrow();
    expect(store.getState().plan).toEqual(previous);
    store.getState().executeBatch(removeSelection(previous, selected), actor);
    expect(store.getState().plan.openings).toHaveLength(0);
    expect(store.getState().plan.walls).toHaveLength(3);
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().plan).toEqual(previous);
  });
});
