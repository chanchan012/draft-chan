import { expect, it } from "vitest";
import { createDraftPlanStore } from "../lib/plans/command-store";
import {
  findClashes,
  issueFromFinding,
  routePoints,
} from "../lib/plans/coordination";
import {
  applyStudioSnapshot,
  studioSnapshot,
} from "../lib/plans/studio-document";
import { coordinationFixture } from "./coordination-fixture";
import type { ServiceRoute } from "../lib/plans/model";

const actor = { kind: "human", id: "designer" } as const;
const p = (x: number, y: number) => ({ x, y });

it("locates a riser through a slab and clears it when the slab contains an adequate opening", () => {
  const plan = coordinationFixture();
  const [clash] = findClashes(plan).findings;
  expect(clash).toMatchObject({
    rule: "service-slab",
    storeyId: "upper",
    edition: "Draft coordination 1.0",
    subjects: [
      { kind: "route", id: "riser" },
      { kind: "slab", id: "upper-slab" },
    ],
    point: { x: 900, y: 900, z: 2775 },
  });
  expect(findClashes(plan, "ground").findings).toEqual([]);
  plan.buildingElements?.push({
    kind: "opening",
    id: "hole",
    name: "Sleeve opening",
    slabId: "upper-slab",
    footprint: [p(800, 800), p(1000, 800), p(1000, 1000), p(800, 1000)],
  });
  expect(findClashes(plan).findings).toEqual([]);
});

it("follows connected utilities and distinguishes actual 3D route intersection from a projected crossing", () => {
  const plan = coordinationFixture();
  plan.buildingElements = [];
  plan.utilities = [
    { id: "supply", template: "coldWater", position: p(100, 500) },
  ];
  const pipe: ServiceRoute = {
    kind: "route",
    id: "pipe",
    name: "Cold water",
    system: "plumbing",
    storeyId: "ground",
    diameterMm: 50,
    nodes: [
      { kind: "utility", utilityId: "supply", zMm: 100 },
      { kind: "point", point: p(900, 500), zMm: 100 },
    ],
  };
  const conduit: ServiceRoute = {
    kind: "route",
    id: "conduit",
    name: "Conduit",
    system: "electrical",
    storeyId: "ground",
    diameterMm: 30,
    nodes: [
      { kind: "point", point: p(500, 0), zMm: 150 },
      { kind: "point", point: p(500, 1000), zMm: 150 },
    ],
  };
  plan.coordination = [pipe, conduit];
  expect(findClashes(plan).findings).toEqual([]);
  conduit.nodes = conduit.nodes.map((node) => ({ ...node, zMm: 120 }));
  expect(findClashes(plan).findings).toMatchObject([
    { rule: "service-route", measuredMm: 20, requiredMm: 40 },
  ]);
  const store = createDraftPlanStore(plan);
  store
    .getState()
    .execute(
      {
        type: "utility.update",
        id: "supply",
        changes: { position: p(200, 500) },
      },
      actor,
    );
  expect(routePoints(store.getState().plan, pipe)[0]).toEqual({
    x: 200,
    y: 500,
    z: 100,
  });
  expect(() =>
    store.getState().execute({ type: "utility.remove", id: "supply" }, actor),
  ).toThrow(/existing plumbing symbols/);
});

it("records evidence at a saved revision and retains the original evidence on resolution", () => {
  const plan = coordinationFixture();
  const [finding] = findClashes(plan).findings;
  const issue = issueFromFinding(plan, finding, 3, "Coordinate sleeve");
  const candidate = { ...plan, coordination: [...plan.coordination!, issue] };
  const saved = applyStudioSnapshot(
    plan,
    { revision: 3, ...studioSnapshot(candidate, "mm") },
    actor,
  );
  const persisted = saved.coordination!.find((item) => item.kind === "issue")!;
  expect(persisted).toMatchObject({
    sourceRevision: 3,
    createdBy: actor,
    finding: { key: finding.key },
  });
  const edited = {
    ...saved,
    coordination: saved.coordination!.map((item) =>
      item.kind === "issue" ? { ...item, status: "resolved" as const } : item,
    ),
  };
  const resolved = applyStudioSnapshot(
    saved,
    { revision: 4, ...studioSnapshot(edited, "mm") },
    actor,
  );
  expect(
    resolved.coordination!.find((item) => item.kind === "issue"),
  ).toMatchObject({ status: "resolved", sourceRevision: 3 });
});
