import { describe, expect, it } from "vitest";
import {
  fitCamera,
  modelPoint,
  projectIso,
  snapPoint,
  snapWallPoint,
  zoomCamera,
} from "../lib/plans/cad";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { doorBounds, doorSwing, wallRuns } from "../lib/plans/openings";
import type { Door, DraftActor, Wall } from "../lib/plans/model";

const actor: DraftActor = { kind: "human", id: "architect" };
const wall: Wall = {
  id: "wall",
  start: { x: 0, y: 0 },
  end: { x: 4000, y: 0 },
  thicknessMm: 120,
  kind: "interior",
};
const door: Door = {
  id: "door",
  wallId: wall.id,
  offsetMm: 2000,
  widthMm: 900,
  hinge: "start",
  swing: "left",
};

describe("CAD coordinates", () => {
  it("snaps in millimeters or inches and respects the selected ortho axis", () => {
    expect(snapPoint({ x: 149, y: 156 }, 100)).toEqual({ x: 100, y: 200 });
    expect(snapPoint({ x: 153, y: -152 }, 25.4)).toEqual({ x: 152, y: -152 });
    expect(snapPoint({ x: 1200, y: 230 }, 100, { x: 17, y: 59 }, true)).toEqual(
      { x: 1200, y: 59 },
    );
    expect(snapWallPoint({ x: 3980, y: 30 }, [wall], 250, 60)).toEqual(
      wall.end,
    );
  });
  it("retains the world point under the cursor when zooming", () => {
    const size = { width: 640, height: 480 };
    const camera = fitCamera([wall], size);
    const point = { x: 113, y: 329 };
    const zoom = zoomCamera(camera, size, point, 1.3);
    expect(modelPoint(point, size, zoom)).toEqual(
      modelPoint(point, size, camera),
    );
    expect(projectIso({ x: 1000, y: 1000 }, 2500)).toEqual({ x: 0, y: -1500 });
  });
});

describe("wall-mounted openings", () => {
  it("cuts the wall run and draws the swing from the selected hinge", () => {
    expect(doorBounds(door)).toEqual([1550, 2450]);
    expect(wallRuns(wall, [door])).toHaveLength(2);
    const shape = doorSwing(wall, door);
    expect(shape.hinge.x).toBeCloseTo(1550);
    expect(shape.leaf.y).toBeCloseTo(-900);
    expect(doorSwing(wall, { ...door, hinge: "end" }).leaf.y).toBeCloseTo(900);
  });
  it("rejects invalid placement and overlapping doors without changing history", () => {
    const s = createDraftPlanStore();
    s.getState().execute({ type: "wall.add", wall }, actor);
    expect(() =>
      s
        .getState()
        .execute({ type: "door.add", door: { ...door, offsetMm: 0 } }, actor),
    ).toThrow(/fit/);
    s.getState().execute({ type: "door.add", door }, actor);
    const prior = s.getState().past;
    expect(() =>
      s
        .getState()
        .execute({ type: "door.add", door: { ...door, id: "overlap" } }, actor),
    ).toThrow(/overlaps/);
    expect(s.getState().past).toBe(prior);
    expect(() =>
      s
        .getState()
        .execute(
          {
            type: "wall.update",
            id: wall.id,
            changes: { end: { x: 1000, y: 0 } },
          },
          actor,
        ),
    ).toThrow(/fit/);
  });
  it("restores hosted doors on undo when their wall is deleted", () => {
    const s = createDraftPlanStore();
    s.getState().execute({ type: "wall.add", wall }, actor);
    s.getState().execute({ type: "door.add", door }, actor);
    s.getState().execute(
      { type: "door.update", id: door.id, changes: { swing: "right" } },
      actor,
    );
    s.getState().execute({ type: "wall.remove", id: wall.id }, actor);
    expect(s.getState().plan.openings).toEqual([]);
    s.getState().undo();
    expect(s.getState().plan.openings[0]).toMatchObject({
      id: door.id,
      swing: "right",
      updatedBy: actor,
    });
    s.getState().undo();
    expect(s.getState().plan.openings[0].swing).toBe("left");
    s.getState().redo();
    expect(s.getState().plan.openings[0].swing).toBe("right");
  });
});
