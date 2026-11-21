import { expect, it } from "vitest";
import { deriveBuildingView } from "../lib/plans/building-views";
import {
  openingsForSlab,
  roofProfile,
  slabPolygons,
} from "../lib/plans/building";
import { drawingArea } from "../lib/plans/clipping";
import { renderBlueprint } from "../lib/plans/blueprints";
import { createDraftPlanStore } from "../lib/plans/command-store";
import { initialGraph } from "../lib/plans/plan-state";
import {
  applyStudioSnapshot,
  studioSnapshot,
} from "../lib/plans/studio-document";
import type { BuildingView, Roof, Slab, Stair } from "../lib/plans/model";

const actor = { kind: "human", id: "architect" } as const;
const p = (x: number, y: number) => ({ x, y });
const section: BuildingView = {
  kind: "section",
  id: "a-a",
  name: "A-A",
  start: p(0, 1500),
  end: p(6000, 1500),
};
const footprint = [p(0, 0), p(6000, 0), p(6000, 4000), p(0, 4000)];
const slab: Slab = {
  kind: "slab",
  id: "deck",
  name: "Upper deck",
  storeyId: "upper",
  footprint,
  thicknessMm: 240,
  offsetMm: 0,
};
const stairs: Stair = {
  kind: "stair",
  id: "stairs",
  name: "Main stair",
  fromStoreyId: "ground",
  toStoreyId: "upper",
  start: p(1000, 1500),
  end: p(4000, 1500),
  widthMm: 1000,
  risers: 15,
  openingSlabId: "deck",
};
const roof: Roof = {
  kind: "roof",
  id: "roof",
  name: "Main roof",
  storeyId: "upper",
  footprint,
  profile: "gable",
  directionDeg: 0,
  pitchDeg: 30,
  thicknessMm: 200,
  offsetMm: 0,
};
function makeBuilding() {
  const store = createDraftPlanStore(
    initialGraph({ width: 6000, depth: 4000 }),
  );
  store.getState().executeBatch(
    [
      {
        type: "storey.write",
        storey: {
          id: "upper",
          name: "Upper floor",
          elevationMm: 3000,
          wallHeightMm: 2600,
        },
      },
      { type: "building.write", item: slab },
      { type: "building.write", item: stairs },
      { type: "building.write", item: roof },
      { type: "building.view", view: section },
    ],
    actor,
  );
  return store;
}

it("moves a stair once and regenerates its exact linked slab opening and section", () => {
  const store = makeBuilding();
  const original = store.getState().plan;
  const after = { ...stairs, start: p(1700, 1500), end: p(4700, 1500) };
  store.getState().execute({ type: "building.write", item: after }, actor);
  const graph = store.getState().plan;
  expect(openingsForSlab(graph, slab.id)[0].footprint[0].x).toBe(1700);
  expect(drawingArea(slabPolygons(graph, slab))).toBeCloseTo(21_000_000);
  const output = deriveBuildingView(graph, section);
  const first = output.surfaces.find((item) => item.id === stairs.id);
  expect(first?.polygon[0]).toEqual(p(1700, 0));
  expect(
    output.surfaces
      .filter((item) => item.id === slab.id)
      .map((item) => item.polygon.map((point) => point.x)),
  ).toEqual([
    [0, 1700, 1700, 0],
    [4700, 6000, 6000, 4700],
  ]);
  expect(renderBlueprint("dxf", graph, "Building")).toContain("FLOOR_OPENINGS");
  const saved = applyStudioSnapshot(
    original,
    { revision: 1, ...studioSnapshot(graph, "mm") },
    actor,
  );
  expect(saved.buildingElements).toEqual(graph.buildingElements);
  expect(() =>
    store
      .getState()
      .execute(
        { type: "building.write", item: { ...after, end: p(6500, 1500) } },
        actor,
      ),
  ).toThrow("must fit entirely inside slab");
  expect(store.getState().plan).toBe(graph);
  store.getState().undo();
  expect(
    openingsForSlab(store.getState().plan, slab.id)[0].footprint[0].x,
  ).toBe(1000);
});

it("derives a roof ridge and elevation from storey heights and validates floor void polygons", () => {
  const store = makeBuilding();
  const graph = store.getState().plan;
  const appearance = deriveBuildingView(graph, {
    kind: "elevation",
    id: "north",
    name: "North",
    direction: "north",
  });
  const face = appearance.surfaces.find((item) => item.kind === "roof")!;
  expect(Math.max(...face.polygon.map((point) => point.y))).toBeCloseTo(
    5600 + 3000 * Math.tan(Math.PI / 6),
  );
  expect(roofProfile(graph, roof).ridgePoints).toHaveLength(2);
  expect(appearance.storeys).toMatchObject([
    { elevationMm: 0 },
    { elevationMm: 3000 },
  ]);
  expect(() =>
    store.getState().execute(
      {
        type: "building.write",
        item: {
          kind: "opening",
          id: "bad",
          name: "Bad void",
          slabId: slab.id,
          footprint: [p(0, 0), p(200, 300), p(0, 300), p(200, 0)],
        },
      },
      actor,
    ),
  ).toThrow(/positive area|intersecting/);
  expect(() =>
    store
      .getState()
      .execute(
        { type: "building.remove", collection: "elements", id: slab.id },
        actor,
      ),
  ).toThrow("destination storey");
});
