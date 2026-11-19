import { describe, expect, it } from "vitest";
import { checkClearances } from "../lib/plans/clearance";
import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";
import { createDraftPlanStore } from "../lib/plans/command-store";
import {
  applyStudioSnapshot,
  saveStudioSchema,
  studioSnapshot,
} from "../lib/plans/studio-document";
import type {
  Door,
  DraftActor,
  Fixture,
  Point,
  Wall,
} from "../lib/plans/model";

const human: DraftActor = { kind: "human", id: "designer" };
const pt = (x: number, y: number): Point => ({ x, y });
const wall = (id: string, start: Point, end: Point): Wall => ({
  id,
  start,
  end,
  thicknessMm: 120,
  kind: "interior",
});
const fixture = (
  id: string,
  x: number,
  y: number,
  widthMm = 300,
  depthMm = 300,
): Fixture => ({
  id,
  position: pt(x, y),
  template: "chair",
  widthMm,
  depthMm,
  heightMm: 700,
  rotation: 0,
});
const host = wall("host", pt(0, 0), pt(4000, 0));
const door: Door = {
  id: "door",
  wallId: host.id,
  offsetMm: 2000,
  widthMm: 800,
  hinge: "start",
  swing: "left",
};
const audit = (walls: Wall[], fixtures: Fixture[], openings: Door[] = []) =>
  checkClearances(
    loadDraftPlan({ ...initialGraph(), walls, openings, fixtures }),
  ).issues;

describe("clearance review", () => {
  it("uses the published doorway and passage thresholds", () => {
    const narrow = audit([host], [], [{ ...door, widthMm: 814 }]);
    expect(narrow).toContainEqual(
      expect.objectContaining({
        kind: "door-width",
        measuredMm: 814,
        requiredMm: 815,
      }),
    );
    expect(
      audit([host], [], [{ ...door, widthMm: 815 }]).filter(
        ({ kind }) => kind === "door-width",
      ),
    ).toHaveLength(0);
    const second = (space: number) =>
      wall("second", pt(0, space + 120), pt(4000, space + 120));
    expect(audit([host, second(914)], [])).toContainEqual(
      expect.objectContaining({
        kind: "walkway",
        measuredMm: 914,
        requiredMm: 915,
      }),
    );
    expect(audit([host, second(915)], [])).toHaveLength(0);
  });

  it("finds obstacles inside a swept quadrant while ignoring the opposite side and arc tangency", () => {
    const occupied = fixture("inside", 1860, -300);
    const opposite = fixture("outside", 1860, 300);
    const tangent = fixture("tangent", 2450, -50, 100, 100);
    const findings = audit([host], [occupied, opposite, tangent], [door]);
    const hits = findings.filter(({ kind }) => kind === "door-swing");
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toContain("inside");
    expect(hits[0].polygons![0]).toHaveLength(26);
  });

  it("flags a wall crossing a swing and overlapping swings from separate openings", () => {
    const divider = wall("divider", pt(1800, -750), pt(1800, -180));
    expect(audit([host, divider], [], [door])).toContainEqual(
      expect.objectContaining({
        kind: "door-swing",
        detail: "The door sweeps into wall.",
      }),
    );
    const parallel = wall("parallel", pt(0, -660), pt(4000, -660));
    const other: Door = {
      ...door,
      id: "other",
      wallId: parallel.id,
      swing: "right",
    };
    expect(
      audit([host, parallel], [], [door, other]).some(
        ({ title }) => title === "Door swings overlap",
      ),
    ).toBe(true);
  });

  it("checks rotated footprints and ignores tangent contact", () => {
    const rotated = {
      ...fixture("rotated", 150, 350, 750, 230),
      rotation: 90 as const,
    };
    expect(
      audit([host], [rotated]).some(({ kind }) => kind === "collision"),
    ).toBe(true);
    const a = fixture("a", 2000, 2000);
    const b = fixture("b", 2300, 2000);
    expect(audit([], [a, b]).some(({ kind }) => kind === "collision")).toBe(
      false,
    );
    expect(
      audit([], [a, { ...b, position: pt(2299, 2000) }]).some(
        ({ kind }) => kind === "collision",
      ),
    ).toBe(true);
  });

  it("reports a fixture narrowing a route and skips a measurement through intervening solids", () => {
    const counter = fixture("counter", 1500, 650, 1000, 200);
    const facing = wall("facing", pt(0, 1400), pt(4000, 1400));
    expect(audit([host, facing], [counter])).toContainEqual(
      expect.objectContaining({
        kind: "walkway",
        measuredMm: 490,
      }),
    );
    const lower = wall("near", pt(0, 800), pt(4000, 800));
    const obstruction = fixture("obstruction", 2000, 400, 2600, 100);
    const blocked = audit([host, lower], [obstruction]);
    expect(
      blocked.filter(
        ({ kind, detail }) =>
          kind === "walkway" && detail.includes("wall and wall"),
      ),
    ).toHaveLength(0);
  });
});

describe("placed catalog items and utilities", () => {
  it("loads pre-layer plans and preserves historical metadata", () => {
    const { utilities: _new, ...legacy } = initialGraph();
    expect(
      loadDraftPlan({ ...legacy, dimensions: [{ id: "dimension" }] }),
    ).toMatchObject({
      utilities: [],
      fixtures: [],
      dimensions: [{ id: "dimension" }],
    });
  });

  it("undoes, redoes, edits and deletes fixtures and symbols with attribution", () => {
    const s = createDraftPlanStore();
    const item = fixture("chair", 350, 600);
    const marker = {
      id: "power",
      template: "outlet" as const,
      position: pt(200, 300),
    };
    s.getState().execute({ type: "fixture.add", fixture: item }, human);
    s.getState().execute({ type: "utility.add", utility: marker }, human);
    s.getState().execute(
      { type: "fixture.update", id: item.id, changes: { rotation: 90 } },
      { kind: "ai", id: "designer-ai" },
    );
    expect(s.getState().plan.fixtures[0]).toMatchObject({
      rotation: 90,
      createdBy: human,
      updatedBy: { kind: "ai" },
    });
    expect(
      s
        .getState()
        .execute(
          { type: "fixture.update", id: item.id, changes: { rotation: 90 } },
          human,
        ),
    ).toBe(false);
    s.getState().undo();
    expect(s.getState().plan.fixtures[0].rotation).toBe(0);
    s.getState().redo();
    expect(s.getState().plan.fixtures[0].rotation).toBe(90);
    expect(() =>
      s.getState().execute({ type: "utility.add", utility: marker }, human),
    ).toThrow(/already exists/);
    s.getState().execute({ type: "utility.remove", id: marker.id }, human);
    expect(s.getState().plan.utilities).toEqual([]);
    s.getState().undo();
    expect(s.getState().plan.utilities).toContainEqual(
      expect.objectContaining(marker),
    );
  });

  it("saves placements and preserves them when an earlier client omits the new fields", () => {
    const empty = initialGraph();
    const snapshot = studioSnapshot(empty, "mm");
    const data = saveStudioSchema.parse({
      ...snapshot,
      revision: 0,
      fixtures: [fixture("chair", 350, 600)],
      utilities: [{ id: "drain", template: "drain", position: pt(1000, 2000) }],
    });
    const saved = applyStudioSnapshot(empty, data, human);
    expect(saved.fixtures[0].createdBy).toEqual(human);
    expect(saved.utilities[0].createdBy).toEqual(human);
    const legacy = saveStudioSchema.parse({
      walls: [],
      openings: [],
      unit: "mm",
      revision: 1,
    });
    expect(applyStudioSnapshot(saved, legacy, human)).toEqual(saved);
  });
});
