import { reviewPackId } from "../lib/plans/model";
import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";

export function reviewFixture() {
  const plan = initialGraph({ width: 6000, depth: 5000 });
  plan.openings = [
    {
      id: "entry",
      wallId: "starter-wall-1",
      offsetMm: 3000,
      widthMm: 900,
      hinge: "start",
      swing: "right",
    },
  ];
  plan.fixtures = [
    {
      id: "approach-obstruction",
      template: "sofa",
      position: { x: 3650, y: 900 },
      widthMm: 400,
      depthMm: 400,
      heightMm: 700,
      rotation: 0,
    },
  ];
  plan.coordination = [
    {
      kind: "profile",
      id: "profile",
      storeyId: "ground",
      pack: reviewPackId,
      jurisdiction: "US model codes",
      sprinkler: "none",
    },
    {
      kind: "egress",
      id: "exit-route",
      name: "Exit route",
      storeyId: "ground",
      exitDoorId: "entry",
      waypoints: [{ x: 3000, y: 2500 }],
    },
    {
      kind: "approach",
      id: "entry-approach",
      name: "Entry door approach",
      storeyId: "ground",
      doorId: "entry",
      side: "front-pull",
    },
    {
      kind: "turning",
      id: "entry-turning",
      name: "Entry turning circle",
      storeyId: "ground",
      center: { x: 3650, y: 900 },
    },
  ];
  return loadDraftPlan(plan);
}
