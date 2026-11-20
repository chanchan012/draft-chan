import { fixtureCatalog, utilityCatalog } from "./catalog";
import { compareText, type DraftPlanState } from "./model";
import { wallLength } from "./openings";

type BomRow = {
  category: "Wall" | "Door" | "Window" | "Fixture" | "Electrical" | "Plumbing";
  item: string;
  dimensionsMm: string;
  unit: "m" | "each";
  quantity: number;
};

export function calculateBom(plan: DraftPlanState): BomRow[] {
  const rows = new Map<string, BomRow>();
  const openingWidths = new Map<string, number>();
  for (const door of plan.openings) {
    openingWidths.set(
      door.wallId,
      (openingWidths.get(door.wallId) ?? 0) + door.widthMm,
    );
  }

  function add(
    category: BomRow["category"],
    item: string,
    dimensionsMm: string,
    unit: BomRow["unit"],
    quantity = 1,
  ) {
    const key = JSON.stringify([category, item, dimensionsMm]);
    const row = rows.get(key);
    if (row) row.quantity += quantity;
    else rows.set(key, { category, item, dimensionsMm, unit, quantity });
  }

  for (const wall of plan.walls) {
    const netLength = wallLength(wall) - (openingWidths.get(wall.id) ?? 0);
    if (netLength > 0)
      add(
        "Wall",
        wall.kind === "exterior" ? "Exterior wall" : "Interior wall",
        String(wall.thicknessMm),
        "m",
        netLength / 1000,
      );
  }
  for (const door of plan.openings)
    add("Door", "Door opening", String(door.widthMm), "each");
  for (const window of plan.windows ?? [])
    add(
      "Window",
      "Window opening",
      `${window.widthMm} x ${window.heightMm}`,
      "each",
    );
  for (const fixture of plan.fixtures) {
    const { widthMm, depthMm, heightMm, template } = fixture;
    add(
      "Fixture",
      fixtureCatalog[template].label,
      `${widthMm} x ${depthMm} x ${heightMm}`,
      "each",
    );
  }
  for (const utility of plan.utilities) {
    const { layer, label } = utilityCatalog[utility.template];
    add(layer === "electrical" ? "Electrical" : "Plumbing", label, "", "each");
  }

  return [...rows.values()]
    .sort(
      (a, b) =>
        compareText(a.category, b.category) ||
        compareText(a.item, b.item) ||
        compareText(a.dimensionsMm, b.dimensionsMm),
    )
    .map((row) => ({
      ...row,
      quantity:
        row.unit === "m" ? Number(row.quantity.toFixed(6)) : row.quantity,
    }));
}

export function bomCsv(plan: DraftPlanState) {
  // The text columns come from the fixed catalog and numeric dimensions.
  const rows = calculateBom(plan).map((row) =>
    [row.category, row.item, row.dimensionsMm, row.unit, row.quantity]
      .map((cell) =>
        typeof cell === "number"
          ? cell
          : '"' + cell.replaceAll('"', '""') + '"',
      )
      .join(","),
  );
  return (
    ["Category,Item,Dimensions (mm),Unit,Quantity", ...rows].join("\r\n") +
    "\r\n"
  );
}
