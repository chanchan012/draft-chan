import {
  anchorPoint,
  isDrawingMark,
  markAnchors,
  paperSize,
} from "./drawing-documents";
import {
  compareText,
  type DraftPlanState,
  type DocumentItem,
  type Point,
  type Room,
} from "./model";
import { inRoom, polygonAreaMm2 } from "./polygon";
import { querySpaces } from "./spaces";
import { planStoreys, storeyOf } from "./storeys";

export type RoomFinish = Extract<DocumentItem, { kind: "finish" }>;
export const scheduleKinds = ["doors", "windows", "finishes"] as const;

export function finishRoom(plan: DraftPlanState, finish: RoomFinish) {
  return plan.rooms.find(
    (room) => storeyOf(room) === finish.storeyId && inRoom(room, finish.point),
  );
}

export function roomLabelPoint(room: Room): Point {
  const rings = [room.polygon, ...(room.holes ?? [])];
  const levels = [
    ...new Set(rings.flatMap((ring) => ring.map(({ y }) => y))),
  ].sort((a, b) => a - b);
  let best: Point | undefined;
  let span = 0;
  for (let i = 1; i < levels.length; i++) {
    const y = Math.round((levels[i - 1] + levels[i]) / 2);
    if (y <= levels[i - 1] || y >= levels[i]) continue;
    const intersections: number[] = [];
    for (const ring of rings)
      for (let j = 0; j < ring.length; j++) {
        const a = ring[j];
        const b = ring[(j + 1) % ring.length];
        if (a.y > y === b.y > y) continue;
        intersections.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    intersections.sort((a, b) => a - b);
    for (let j = 1; j < intersections.length; j += 2) {
      const width = intersections[j] - intersections[j - 1];
      const point = {
        x: Math.round((intersections[j] + intersections[j - 1]) / 2),
        y,
      };
      if (width > span && inRoom(room, point)) {
        best = point;
        span = width;
      }
    }
  }
  if (!best)
    throw new Error(
      "This room needs an interior point within model precision.",
    );
  return best;
}

export function schedules(plan: DraftPlanState) {
  const items = plan.documentItems ?? [];
  const tags = new Map(
    items.flatMap((item) =>
      item.kind === "tag"
        ? [[item.target.kind + ":" + item.target.id, item.text] as const]
        : [],
    ),
  );
  const storeys = new Map(
    planStoreys(plan).map((item) => [item.id, item.name]),
  );
  const walls = new Map(plan.walls.map((item) => [item.id, item]));
  const levels = (wallId: string) =>
    storeys.get(storeyOf(walls.get(wallId) ?? {})) ?? "";
  const tagged = (kind: "door" | "window", id: string) =>
    tags.get(kind + ":" + id) ?? "";
  const sortRows = <T extends { tag: string; id: string }>(rows: T[]) =>
    rows.sort(
      (a, b) =>
        compareText(a.tag || a.id, b.tag || b.id) || compareText(a.id, b.id),
    );
  const doors = sortRows(
    plan.openings.map((door) => ({
      id: door.id,
      tag: tagged("door", door.id),
      storey: levels(door.wallId),
      widthMm: door.widthMm,
      hinge: door.hinge,
      swing: door.swing,
    })),
  );
  const windows = sortRows(
    (plan.windows ?? []).map((window) => ({
      id: window.id,
      tag: tagged("window", window.id),
      storey: levels(window.wallId),
      widthMm: window.widthMm,
      heightMm: window.heightMm,
      sillMm: window.sillMm,
    })),
  );
  const assignments = items.filter((item) => item.kind === "finish");
  const spaces = new Map(
    assignments.length
      ? querySpaces(plan).flatMap((level) =>
          level.spaces.map((space) => [space.id, space.netAreaM2] as const),
        )
      : [],
  );
  const finishes = assignments
    .map((finish) => {
      const room = finishRoom(plan, finish);
      return {
        id: finish.id,
        room: finish.room,
        storey: storeys.get(finish.storeyId) ?? "",
        floor: finish.floor,
        walls: finish.walls,
        ceiling: finish.ceiling,
        netAreaM2: room
          ? (spaces.get(room.id) ??
            polygonAreaMm2(room.polygon, room.holes) / 1_000_000)
          : null,
      };
    })
    .sort(
      (a, b) =>
        compareText(a.storey, b.storey) ||
        compareText(a.room, b.room) ||
        compareText(a.id, b.id),
    );
  return { doors, windows, finishes };
}

export function issueSheets(plan: DraftPlanState) {
  const items = plan.documentItems ?? [];
  const sheets = items
    .filter((item) => item.kind === "sheet")
    .sort((a, b) =>
      compareText(a.number.toUpperCase(), b.number.toUpperCase()),
    );
  if (!sheets.length)
    throw new Error("Create at least one sheet before publishing.");
  if (sheets.length > 32)
    throw new Error("An issue set can contain up to 32 sheets.");
  const viewports = items.filter((item) => item.kind === "viewport");
  for (const sheet of sheets) {
    const panels = viewports.filter((item) => item.sheetId === sheet.id);
    if (!panels.length)
      throw new Error(sheet.number + " needs at least one named viewport.");
    if (panels.length > 16)
      throw new Error(sheet.number + " can contain up to 16 viewports.");
    if (
      panels.some(
        (panel) => panel.y + panel.height > paperSize(sheet).height - 24,
      )
    )
      throw new Error(
        sheet.number + " needs 24 mm at the bottom for its title block.",
      );
  }
  if (
    items.some(
      (item) =>
        isDrawingMark(item) &&
        markAnchors(item).some(
          (anchor) => !anchorPoint(plan, item.storeyId, anchor),
        ),
    )
  )
    throw new Error(
      "Resolve or remove annotations with missing anchors before publishing.",
    );
  if (items.some((item) => item.kind === "finish" && !finishRoom(plan, item)))
    throw new Error(
      "Resolve room finish assignments without an enclosed room before publishing.",
    );
  return sheets;
}

export function scheduleTables(result: ReturnType<typeof schedules>) {
  return [
    {
      key: "doors" as const,
      title: "Door schedule",
      columns: ["Tag", "Storey", "Width (mm)", "Hinge", "Swing"],
      rows: result.doors.map((item) => [
        item.tag || "Untagged",
        item.storey,
        String(item.widthMm),
        item.hinge,
        item.swing,
      ]),
    },
    {
      key: "windows" as const,
      title: "Window schedule",
      columns: ["Tag", "Storey", "Width (mm)", "Height (mm)", "Sill (mm)"],
      rows: result.windows.map((item) => [
        item.tag || "Untagged",
        item.storey,
        String(item.widthMm),
        String(item.heightMm),
        String(item.sillMm),
      ]),
    },
    {
      key: "finishes" as const,
      title: "Room finish schedule",
      columns: ["Room", "Storey", "Floor", "Walls", "Ceiling", "Net area (m²)"],
      rows: result.finishes.map((item) => [
        item.room,
        item.storey,
        item.floor,
        item.walls,
        item.ceiling,
        item.netAreaM2 === null ? "Unresolved" : item.netAreaM2.toFixed(2),
      ]),
    },
  ];
}
