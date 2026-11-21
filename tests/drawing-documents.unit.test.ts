import { describe, expect, it } from "vitest";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { documentMarks, paperDrawing } from "../lib/plans/sheet-drawing";
import { initialGraph } from "../lib/plans/plan-state";
import {
  studioSnapshot,
  applyStudioSnapshot,
} from "../lib/plans/studio-document";
import type { DocumentItem, Sheet } from "../lib/plans/model";

const actor = { kind: "human", id: "architect" } as const;
const p = (x: number, y: number) => ({ x, y });
const sheet: Sheet = {
  kind: "sheet",
  id: "sheet",
  number: "A101",
  name: "Ground",
  size: "A3",
  orientation: "landscape",
};
const items: DocumentItem[] = [
  sheet,
  {
    kind: "view",
    id: "view",
    source: { kind: "plan", storeyId: "ground" },
    center: p(2500, 1500),
    name: "Ground floor",
  },
  {
    kind: "viewport",
    id: "viewport",
    sheetId: "sheet",
    viewId: "view",
    x: 10,
    y: 10,
    width: 400,
    height: 255,
    scale: 50,
  },
  {
    kind: "chain",
    id: "chain",
    axis: "horizontal",
    storeyId: "ground",
    offsetMm: -300,
    anchors: [
      { kind: "wall", id: "starter-wall-1", end: "start" },
      { kind: "wall", id: "starter-wall-1", end: "end" },
    ],
  },
];
const makePlan = () => initialGraph({ width: 5000, depth: 3000 });
const writeItems = (
  store: ReturnType<typeof createDraftPlanStore>,
  entries = items,
) =>
  store.getState().executeBatch(
    entries.map((item) => ({ type: "document.write", item })),
    actor,
  );

describe("drawing documents", () => {
  it("projects a 5000 mm line at printed scale and derives edited chain dimensions", () => {
    const store = createDraftPlanStore(makePlan());
    writeItems(store);
    const current = () => store.getState().plan;
    const drawing = paperDrawing(current(), sheet);
    expect([drawing.width, drawing.height]).toEqual([420, 297]);
    const wall = drawing.panels[0].primitives.find(
      (item) => item.kind === "path" && item.source === "starter-wall-1",
    );
    expect(wall?.kind).toBe("path");
    if (wall?.kind !== "path") throw new Error("Expected projected wall");
    expect(wall.points[1].x - wall.points[0].x).toBe(100);
    expect(drawing.panels[0].primitives).toContainEqual(
      expect.objectContaining({ kind: "text", text: "5000" }),
    );
    store
      .getState()
      .execute(
        {
          type: "wall.update",
          id: "starter-wall-1",
          changes: { end: p(5500, 0) },
        },
        actor,
      );
    expect(documentMarks(current(), "ground", 50).primitives).toContainEqual(
      expect.objectContaining({ text: "5500" }),
    );
    store.getState().undo();
    expect(documentMarks(current(), "ground", 50).primitives).toContainEqual(
      expect.objectContaining({ text: "5000" }),
    );
    const saved = applyStudioSnapshot(
      makePlan(),
      { revision: 1, ...studioSnapshot(current(), "mm") },
      actor,
    );
    expect(saved.documentItems).toEqual(current().documentItems);
  });

  it("validates dependent viewports and reports a removed geometry anchor", () => {
    const store = createDraftPlanStore(makePlan());
    writeItems(store);
    expect(() =>
      store.getState().execute({ type: "document.remove", id: "view" }, actor),
    ).toThrow(/existing sheet and named view/);
    expect(() =>
      writeItems(store, [
        {
          ...(items[2] as Extract<DocumentItem, { kind: "viewport" }>),
          x: 120,
        },
      ]),
    ).toThrow(/fit on the sheet/);
    store
      .getState()
      .execute({ type: "wall.remove", id: "starter-wall-1" }, actor);
    expect(documentMarks(store.getState().plan, "ground", 50)).toEqual({
      primitives: [],
      unresolved: ["chain"],
    });
  });
});
