import { expect, it } from "vitest";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { createDrawingReference } from "../lib/plans/drawing-references";
import { dxfImportCommands, stageDxf } from "../lib/plans/dxf-import";
import { initialGraph } from "../lib/plans/plan-state";
import { renderTypedDxf } from "../lib/plans/typed-dxf";
import { renderIfc } from "../lib/server/ifc-export";
import { dxfFixture } from "./dxf-fixture";
import { ifcFixture } from "./ifc-fixture";

const actor = { kind: "human", id: "architect" } as const;

it("round-trips native sketch types, units, polyline closure and layer names", () => {
  const staged = stageDxf(dxfFixture);
  const store = createDraftPlanStore(initialGraph());
  const { commands } = dxfImportCommands(
    store.getState().plan,
    staged,
    "ground",
    ["Reference", "Survey"],
  );
  store.getState().executeBatch(commands, actor);
  const restored = stageDxf(renderTypedDxf(store.getState().plan));
  expect(restored.declaredUnit).toBe("mm");
  expect(restored.unsupported).toEqual([]);
  expect(restored.layers).toEqual(
    staged.layers.map((layer) => ({ ...layer, skipped: 0 })),
  );
  for (const original of staged.shapes) {
    const shape = restored.shapes.find(
      ({ geometry }) => geometry.kind === original.geometry.kind,
    );
    expect(shape).toEqual(original);
  }
});

it("refreshes a DXF reference in place without changing editable model geometry", () => {
  const store = createDraftPlanStore(initialGraph());
  const stage = stageDxf(dxfFixture);
  const reference = createDrawingReference(
    stage,
    "Survey",
    "ground",
    "survey",
    undefined,
    undefined,
    { x: 425, y: -200 },
  );
  store.getState().execute({ type: "reference.write", item: reference }, actor);
  const refresh = createDrawingReference(
    stageDxf(dxfFixture, "mm"),
    "New survey",
    "ground",
    "survey",
    ["Reference"],
    reference,
  );
  store.getState().execute({ type: "reference.write", item: refresh }, actor);
  expect(store.getState().plan.drawingReferences?.[0]).toMatchObject({
    id: "survey",
    version: 2,
    storeyId: "ground",
    offset: { x: 425, y: -200 },
    shapes: [{ layer: "Reference" }],
  });
  expect(store.getState().plan.sketches ?? []).toEqual([]);
  expect(stageDxf(renderTypedDxf(store.getState().plan)).shapes).toEqual([]);
  store.getState().undo();
  expect(store.getState().plan.drawingReferences?.[0]?.version).toBe(1);
});

it("exports IFC4 physical geometry, assigned wall types, host openings and slab voids", () => {
  const content = renderIfc(ifcFixture());
  expect(content).toContain("FILE_SCHEMA(('IFC4'))");
  expect(content).toContain("O''Riley plan");
  expect(content).toContain(".LENGTHUNIT.,.MILLI.,.METRE.");
  expect(content.match(/=IFCBUILDINGSTOREY\(/g)).toHaveLength(2);
  expect(content.match(/=IFCWALLTYPE\(/g)).toHaveLength(2);
  expect(content).toContain("'Masonry cavity'");
  expect(content).toContain("IFCMATERIALLAYERSET");
  expect(content.match(/=IFCRELVOIDSELEMENT\(/g)).toHaveLength(2);
  expect(content.match(/=IFCRELFILLSELEMENT\(/g)).toHaveLength(2);
  expect(content).toContain("IFCARBITRARYPROFILEDEFWITHVOIDS");
});
