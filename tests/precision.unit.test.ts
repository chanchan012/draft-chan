import { expect, it } from "vitest";
import {
  measurePoints,
  measureWallEdges,
  resolveSnap,
} from "../lib/plans/precision";
import type { Wall } from "../lib/plans/model";

const wall = (id: string, a: number[], b: number[]): Wall => ({
  id,
  start: { x: a[0], y: a[1] },
  end: { x: b[0], y: b[1] },
  thicknessMm: 120,
  kind: "interior",
});

it("resolves segment intersections and perpendiculars with stable references", () => {
  const walls = [
    wall("a", [0, 0], [4000, 4000]),
    wall("b", [0, 4000], [4000, 0]),
  ];
  expect(
    resolveSnap(
      walls.reverse(),
      { x: 2005, y: 2004 },
      {
        radiusMm: 20,
        modes: ["intersection"],
      },
    ),
  ).toMatchObject({
    point: { x: 2000, y: 2000 },
    references: [
      { wallId: "a", edge: "center" },
      { wallId: "b", edge: "center" },
    ],
  });
  expect(
    resolveSnap(
      walls,
      { x: 1499, y: 1499 },
      {
        radiusMm: 20,
        anchor: { x: 1000, y: 2000 },
        modes: ["perpendicular"],
      },
    )?.point,
  ).toEqual({ x: 1500, y: 1500 });
});

it("measures a rotated room by its finished faces and converts without storage rounding", () => {
  const walls = [
    wall("a", [0, 0], [3000, 4000]),
    wall("b", [800, -600], [3800, 3400]),
  ];
  const measurement = measureWallEdges(
    walls,
    { wallId: "a", edge: "negative" },
    { wallId: "b", edge: "positive" },
    "m",
  )!;
  expect(measurement.distanceMm).toBeCloseTo(880);
  expect(measurement.value).toBeCloseTo(0.88);
  expect(
    measurePoints({ x: 0, y: 0 }, { x: 3657.6, y: 0 }, "ft").value,
  ).toBeCloseTo(12);
});
