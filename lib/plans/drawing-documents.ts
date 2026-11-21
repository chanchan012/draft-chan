import { validateRing } from "./building";
import { pointAlong } from "./openings";
import { planStoreys, storeyOf } from "./storeys";
import type {
  DocumentAnchor,
  DraftPlanState,
  DrawingMark,
  Point,
  Sheet,
} from "./model";

const sizes = { A4: [297, 210], A3: [420, 297], A2: [594, 420] } as const;
export function paperSize(sheet: Sheet) {
  const [long, short] = sizes[sheet.size];
  return sheet.orientation === "landscape"
    ? { width: long, height: short }
    : { width: short, height: long };
}

export function anchorPoint(
  plan: DraftPlanState,
  storeyId: string,
  anchor: DocumentAnchor,
): Point | undefined {
  switch (anchor.kind) {
    case "point":
      return anchor.point;
    case "wall": {
      const wall = plan.walls.find(({ id }) => id === anchor.id);
      return wall && storeyOf(wall) === storeyId ? wall[anchor.end] : undefined;
    }
    case "fixture": {
      const fixture = plan.fixtures.find(({ id }) => id === anchor.id);
      return fixture && storeyOf(fixture) === storeyId
        ? fixture.position
        : undefined;
    }
    default: {
      const openings = anchor.kind === "door" ? plan.openings : plan.windows;
      const opening = openings?.find(({ id }) => id === anchor.id);
      const wall =
        opening && plan.walls.find(({ id }) => id === opening.wallId);
      return wall && storeyOf(wall) === storeyId
        ? pointAlong(wall, opening.offsetMm)
        : undefined;
    }
  }
}

export function markAnchors(mark: DrawingMark): DocumentAnchor[] {
  switch (mark.kind) {
    case "chain":
      return mark.anchors;
    case "leader":
      return [mark.anchor];
    case "tag":
      return [mark.target];
    case "hatch":
      return [];
  }
}

export function validateDocuments(
  plan: DraftPlanState,
  previous?: DraftPlanState,
) {
  const items = plan.documentItems ?? [];
  const ids = new Map(items.map((item) => [item.id, item]));
  const previousItems =
    previous && new Map(previous.documentItems?.map((item) => [item.id, item]));
  const storeys = new Set(planStoreys(plan).map(({ id }) => id));
  const sheetNumbers = new Set<string>();
  const tagCodes = new Set<string>();
  const tagTargets = new Set<string>();
  if (ids.size !== items.length)
    throw new Error("Drawing document IDs must be unique.");
  for (const item of items) {
    const prior = previousItems?.get(item.id);
    if (prior && prior.kind !== item.kind)
      throw new Error("A drawing document item keeps its type.");
    switch (item.kind) {
      case "sheet": {
        const number = item.number.toUpperCase();
        if (sheetNumbers.has(number))
          throw new Error("Sheet numbers must be unique.");
        sheetNumbers.add(number);
        break;
      }
      case "view": {
        const source = item.source;
        if (
          source.kind === "plan"
            ? !storeys.has(source.storeyId)
            : !plan.buildingViews?.some(({ id }) => id === source.viewId)
        )
          throw new Error(
            "The named view needs an existing storey or building view.",
          );
        break;
      }
      case "viewport": {
        const sheet = ids.get(item.sheetId);
        if (sheet?.kind !== "sheet" || ids.get(item.viewId)?.kind !== "view")
          throw new Error("A viewport needs an existing sheet and named view.");
        const { width, height } = paperSize(sheet);
        if (
          item.x + item.width > width + 1e-8 ||
          item.y + item.height > height + 1e-8
        )
          throw new Error("The viewport must fit on the sheet.");
        break;
      }
      default: {
        if (!storeys.has(item.storeyId))
          throw new Error("The annotation needs an existing storey.");
        if (item.kind === "hatch" && prior !== item)
          validateRing(item.polygon, "Hatch");
        if (previous && JSON.stringify(prior) !== JSON.stringify(item)) {
          if (
            markAnchors(item).some(
              (anchor) => !anchorPoint(plan, item.storeyId, anchor),
            )
          )
            throw new Error(
              "The annotation needs valid anchors on its storey.",
            );
        }
        if (item.kind === "tag") {
          const target = item.target.kind + ":" + item.target.id;
          const code = item.text.toUpperCase();
          if (tagTargets.has(target) || tagCodes.has(code))
            throw new Error(
              "Tag codes and their targets must be unique within the drawing.",
            );
          tagTargets.add(target);
          tagCodes.add(code);
        }
      }
    }
  }
}
