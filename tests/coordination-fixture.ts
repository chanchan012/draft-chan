import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";
import type { ServiceRoute } from "../lib/plans/model";
const point = (x: number, y: number) => ({ x, y });

export const plumbingRiser: ServiceRoute = {
  kind: "route",
  id: "riser",
  name: "Plumbing riser",
  storeyId: "ground",
  system: "plumbing",
  diameterMm: 50,
  nodes: [
    { kind: "point", point: point(900, 900), zMm: 2200 },
    { kind: "point", point: point(900, 900), zMm: 3400 },
  ],
};

export function coordinationFixture() {
  const plan = initialGraph();
  plan.storeys = [
    { id: "ground", name: "Ground floor", elevationMm: 0, wallHeightMm: 2700 },
    { id: "upper", name: "Upper floor", elevationMm: 3000, wallHeightMm: 2700 },
  ];
  plan.buildingElements = [
    {
      kind: "slab",
      id: "upper-slab",
      name: "Upper slab",
      storeyId: "upper",
      offsetMm: 0,
      thicknessMm: 200,
      footprint: [
        point(0, 0),
        point(4000, 0),
        point(4000, 3400),
        point(0, 3400),
      ],
    },
  ];
  plan.coordination = [plumbingRiser];
  return loadDraftPlan(plan);
}
