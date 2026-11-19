import { describe, expect, it } from "vitest";
import { calculateBom, bomCsv } from "../lib/plans/bom";
import { renderBlueprint } from "../lib/plans/blueprints";
import { initialGraph, loadDraftPlan } from "../lib/plans/plan-state";

function layout() {
  return loadDraftPlan({
    ...initialGraph(),
    walls: [
      {
        id: "outer",
        start: { x: -100, y: 200 },
        end: { x: 4900, y: 200 },
        kind: "exterior",
        thicknessMm: 200,
      },
      {
        id: "inner",
        start: { x: 4900, y: 200 },
        end: { x: 4900, y: 2200 },
        kind: "interior",
        thicknessMm: 120,
      },
    ],
    openings: [
      {
        id: "door",
        wallId: "outer",
        offsetMm: 2200,
        widthMm: 900,
        hinge: "start",
        swing: "right",
      },
      {
        id: "other-door",
        wallId: "inner",
        offsetMm: 800,
        widthMm: 900,
        hinge: "end",
        swing: "left",
      },
    ],
    fixtures: ["a", "b"].map((id) => ({
      id,
      template: "chair",
      widthMm: 530,
      depthMm: 550,
      heightMm: 830,
      position: { x: 2000, y: 1800 },
      rotation: 90,
    })),
    utilities: [
      { id: "power", template: "outlet", position: { x: 900, y: 300 } },
      { id: "water", template: "drain", position: { x: -300, y: -400 } },
    ],
  });
}

function dxfSection(dxf: string, section: string) {
  const lines = dxf
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());
  expect(lines.length % 2).toBe(0);
  const pairs = Array.from({ length: lines.length / 2 }, (_, index) => ({
    code: Number(lines[index * 2]),
    value: lines[index * 2 + 1],
  }));
  expect(pairs.every(({ code }) => Number.isInteger(code))).toBe(true);
  expect(pairs.at(-1)).toEqual({ code: 0, value: "EOF" });
  const start = pairs.findIndex(
    ({ code, value }, index) =>
      code === 2 && value === section && pairs[index - 1]?.value === "SECTION",
  );
  expect(start).toBeGreaterThan(0);
  const end = pairs.findIndex(
    ({ code, value }, index) =>
      index > start && code === 0 && value === "ENDSEC",
  );
  expect(end).toBeGreaterThan(start);
  return pairs.slice(start + 1, end);
}

describe("bill of materials and blueprint documents", () => {
  it("groups items by size and subtracts doors from linear wall quantities", () => {
    expect(calculateBom(layout())).toEqual([
      {
        category: "Door",
        item: "Door opening",
        dimensionsMm: "900",
        unit: "each",
        quantity: 2,
      },
      {
        category: "Electrical",
        item: "Outlet",
        dimensionsMm: "",
        unit: "each",
        quantity: 1,
      },
      {
        category: "Fixture",
        item: "Chair",
        dimensionsMm: "530 x 550 x 830",
        unit: "each",
        quantity: 2,
      },
      {
        category: "Plumbing",
        item: "Drain",
        dimensionsMm: "",
        unit: "each",
        quantity: 1,
      },
      {
        category: "Wall",
        item: "Exterior wall",
        dimensionsMm: "200",
        unit: "m",
        quantity: 4.1,
      },
      {
        category: "Wall",
        item: "Interior wall",
        dimensionsMm: "120",
        unit: "m",
        quantity: 1.1,
      },
    ]);
    expect(bomCsv(layout())).toContain(
      '"Wall","Exterior wall","200","m",4.1\r\n',
    );
    expect(bomCsv(initialGraph())).toBe(
      "Category,Item,Dimensions (mm),Unit,Quantity\r\n",
    );
  });

  it("writes DXF section and entity pairs with millimeter units, walls, and 90° swings", () => {
    const dxf = renderBlueprint("dxf", layout(), "Export");
    const header = dxfSection(dxf, "HEADER");
    expect(
      header[header.findIndex(({ value }) => value === "$INSUNITS") + 1],
    ).toEqual({ code: 70, value: "4" });
    const entities = dxfSection(dxf, "ENTITIES");
    expect(
      entities.filter(
        ({ code, value }) => code === 0 && value === "LWPOLYLINE",
      ),
    ).toHaveLength(7);
    expect(
      entities.filter(({ code, value }) => code === 0 && value === "ARC"),
    ).toHaveLength(2);
    expect(
      entities
        .filter(
          ({ code, value }) =>
            code === 8 &&
            ["WALLS", "DOORS", "FIXTURES", "ELECTRICAL", "PLUMBING"].includes(
              value,
            ),
        )
        .map(({ value }) => value),
    ).toEqual(
      expect.arrayContaining([
        "WALLS",
        "DOORS",
        "FIXTURES",
        "ELECTRICAL",
        "PLUMBING",
      ]),
    );
    expect(entities).toContainEqual({ code: 10, value: "1650" });
    expect(entities).toContainEqual({ code: 20, value: "-200" });
    expect(
      entities.filter(({ code }) => code === 50).map(({ value }) => value),
    ).toEqual(["270", "90"]);
    expect(
      entities.filter(({ code }) => code === 51).map(({ value }) => value),
    ).toEqual(["0", "180"]);
  });

  it("renders metric SVG groups, wall gaps and safe plan titles", () => {
    const svg = renderBlueprint(
      "svg",
      layout(),
      '</title><script>alert("&")</script>',
    );
    expect(svg).toContain('width="6395mm"');
    for (const group of [
      "walls",
      "doors",
      "fixtures",
      "electrical",
      "plumbing",
    ])
      expect(svg).toContain(`id="${group}"`);
    expect(svg).toContain(
      "M 1650 200 L 1650 1100 M 2550 200 A 900 900 0 0 1 1650 1100",
    );
    expect(svg).toContain(
      '&lt;/title&gt;&lt;script&gt;alert("&amp;")&lt;/script&gt;',
    );
    expect(svg).not.toContain("<script>");
    expect(renderBlueprint("svg", initialGraph(), "Blank")).toContain(
      'viewBox="-120 -120 1240 1240"',
    );
    expect(
      dxfSection(renderBlueprint("dxf", initialGraph(), "Blank"), "ENTITIES"),
    ).toEqual([]);
  });
});
