import { describe, expect, it } from "vitest";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { dxfImportCommands, stageDxf } from "../lib/plans/dxf-import";
import { initialGraph } from "../lib/plans/plan-state";
import {
  underlayPoint,
  underlayTransform,
  validateUnderlays,
} from "../lib/plans/underlays";
import type { Underlay, UnderlayCalibration } from "../lib/plans/model";
import { dxfFixture } from "./dxf-fixture";

describe("DXF staging", () => {
  it("reports units, layer styles and skipped entities before importing typed geometry", () => {
    const stage = stageDxf(dxfFixture);
    expect(stage).toMatchObject({
      unit: "in",
      declaredUnit: "in",
      layers: [
        { name: "Reference", lineStyle: "dashed", supported: 1, skipped: 1 },
        { name: "Survey", lineStyle: "solid", supported: 3, skipped: 0 },
      ],
      unsupported: [{ reason: "SPLINE · Unsupported entity", count: 1 }],
    });
    expect(stage.shapes.map(({ geometry }) => geometry)).toEqual([
      { kind: "construction", start: { x: 0, y: 0 }, end: { x: 2540, y: 508 } },
      {
        kind: "polyline",
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 2540, y: 0 },
          { x: 2540, y: 508 },
        ],
      },
      { kind: "circle", center: { x: 508, y: 508 }, radiusMm: 101.6 },
      {
        kind: "arc",
        center: { x: 1270, y: 762 },
        radiusMm: 152.39999999999998,
        startDeg: 270,
        sweepDeg: 100,
      },
    ]);
    const store = createDraftPlanStore(initialGraph());
    const edit = dxfImportCommands(store.getState().plan, stage, "ground", [
      "Survey",
    ]);
    expect(edit.imported).toBe(3);
    store
      .getState()
      .executeBatch(edit.commands, { kind: "human", id: "draft" });
    expect(store.getState().plan.sketches).toHaveLength(3);
    expect(store.getState().plan.drawingLayers?.[0]).toMatchObject({
      name: "Survey",
      members: [{ kind: "sketch" }, { kind: "sketch" }, { kind: "sketch" }],
    });
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().plan.sketches ?? []).toHaveLength(0);
  });

  it("requires an override if unitless and reports curves with unsupported bulge or bad coordinates", () => {
    const raw = dxfFixture
      .replace("$INSUNITS\n70\n1", "$INSUNITS\n70\n0")
      .replace("10\n0\n20\n0\n10\n100", "10\n0\n20\n0\n42\n0.5\n10\n100")
      .replace("11\n100\n21\n-20", "11\nabc\n21\n-20");
    expect(stageDxf(raw).shapes).toHaveLength(0);
    const stage = stageDxf(raw, "mm");
    expect(stage.shapes).toHaveLength(2);
    expect(stage.unsupported.map(({ reason }) => reason)).toEqual([
      "LINE · Outside model limits or degenerate at 1 mm precision",
      "LWPOLYLINE · Bulges or widths",
      "SPLINE · Unsupported entity",
    ]);
    expect(() => stageDxf("0\nSECTION\n2\nENTITIES")).toThrow(/ENDSEC/);
  });
});

describe("calibrated underlays", () => {
  const calibration: UnderlayCalibration = {
    pixels: [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
    ],
    model: [
      { x: 100, y: 200 },
      { x: 100, y: 1200 },
    ],
  };
  it("reproduces a third check point after rotation and scaling", () => {
    expect(underlayTransform(calibration).scale).toBe(10);
    expect(underlayPoint(calibration, { x: 110, y: 20 })).toEqual({
      x: 100,
      y: 1200,
    });
    const c = underlayPoint(calibration, { x: 60, y: 60 });
    expect(c).toEqual({ x: -300, y: 700 });
    expect(Math.hypot(c.x - 100, c.y - 200)).toBeCloseTo(
      Math.hypot(50, 40) * 10,
      9,
    );
    const item: Underlay = {
      id: "survey",
      name: "Survey",
      storeyId: "ground",
      source: { kind: "pdf", page: 2 },
      raster: "data:image/jpeg;base64,/9j/QQ==",
      width: 90,
      height: 90,
      opacity: 0.5,
      visible: true,
      calibration,
    };
    expect(() =>
      validateUnderlays({ ...initialGraph(), underlays: [item] }),
    ).toThrow(/inside/);
    expect(() =>
      underlayTransform({
        ...calibration,
        pixels: [calibration.pixels[0], calibration.pixels[0]],
      }),
    ).toThrow(/distinct/);
  });
});
