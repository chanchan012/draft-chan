import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";
import type { StudioDocument } from "../lib/plans/studio-document";

const p = (x: number, y: number) => ({ x, y });
export function ifcFixture(): StudioDocument {
  const graph = initialGraph();
  graph.storeys = [
    { id: "ground", name: "Ground floor", elevationMm: 0, wallHeightMm: 2700 },
    { id: "upper", name: "Upper floor", elevationMm: 3000, wallHeightMm: 2500 },
  ];
  graph.wallTypes = [
    {
      id: "masonry",
      name: "Masonry cavity",
      layers: [
        { material: "Brick", thicknessMm: 100 },
        { material: "Cavity", thicknessMm: 50 },
        { material: "Blockwork", thicknessMm: 100 },
      ],
    },
  ];
  graph.walls = [
    {
      id: "main-wall",
      kind: "exterior",
      start: p(0, 0),
      end: p(5000, 0),
      thicknessMm: 250,
      wallTypeId: "masonry",
    },
    {
      id: "upper-wall",
      kind: "interior",
      start: p(0, 0),
      end: p(5000, 0),
      thicknessMm: 120,
      storeyId: "upper",
    },
  ];
  graph.openings = [
    {
      id: "D-01",
      wallId: "main-wall",
      widthMm: 900,
      offsetMm: 1500,
      hinge: "start",
      swing: "left",
    },
  ];
  graph.windows = [
    {
      id: "W-01",
      wallId: "upper-wall",
      widthMm: 1100,
      offsetMm: 2600,
      sillMm: 850,
      heightMm: 1000,
    },
  ];
  graph.buildingElements = [
    {
      kind: "slab",
      id: "slab",
      name: "Upper slab",
      storeyId: "upper",
      thicknessMm: 190,
      offsetMm: 0,
      footprint: [p(0, 0), p(5000, 0), p(5000, 3000), p(0, 3000)],
    },
    {
      kind: "opening",
      id: "slab-hole",
      name: "Stair void",
      slabId: "slab",
      footprint: [p(2000, 1000), p(3000, 1000), p(3000, 2000), p(2000, 2000)],
    },
  ];
  return {
    id: "65bd90ac-3bf8-4e96-be1a-412906ddf79b",
    name: "O'Riley plan",
    unit: "mm",
    revision: 4,
    graph: loadDraftPlan(graph),
  };
}
