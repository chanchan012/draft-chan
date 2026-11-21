import { deriveBuildingView } from "./building-views";
import {
  elementsOnStorey,
  buildingElementFootprint,
  openingsForSlab,
} from "./building";
import {
  anchorPoint,
  isDrawingMark,
  markAnchors,
  paperSize,
} from "./drawing-documents";
import { bounds, fixtureFootprint, wallMaterialFootprint } from "./footprints";
import type {
  DraftPlanState,
  DrawingEntity,
  DrawingMark,
  NamedDrawingView,
  Point,
  Sheet,
} from "./model";
import { doorBounds, doorSwing, pointAlong, wallRuns } from "./openings";
import { pointAt } from "./sketch";
import { storeyPlan } from "./storeys";

type Stroke = { weight: number; dash?: number[] };
export type DrawingPrimitive =
  | (Stroke & {
      kind: "path";
      points: Point[];
      closed?: boolean;
      fill?: string;
      source?: string;
    })
  | {
      kind: "text";
      at: Point;
      text: string;
      size: number;
      align?: "middle" | "end";
    };

const line = (points: Point[], weight = 0.18): DrawingPrimitive => ({
  kind: "path",
  points,
  weight,
});
const note = (
  at: Point,
  text: string,
  size = 3,
  align?: "middle" | "end",
): DrawingPrimitive => ({ kind: "text", at, text, size, align });

function hatchLines(mark: Extract<DrawingMark, { kind: "hatch" }>) {
  const lines: DrawingPrimitive[] = [];
  for (const sign of mark.pattern === "cross" ? [1, -1] : [1]) {
    const values = mark.polygon.map(({ x, y }) => x + sign * y);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const spacing = Math.max(mark.spacingMm * Math.SQRT2, (high - low) / 240);
    for (
      let level = Math.ceil(low / spacing) * spacing;
      level < high;
      level += spacing
    ) {
      const hits: Point[] = [];
      for (let i = 0; i < values.length; i++) {
        const j = (i + 1) % values.length;
        if (values[i] <= level === values[j] <= level) continue;
        const a = mark.polygon[i];
        const b = mark.polygon[j];
        const t = (level - values[i]) / (values[j] - values[i]);
        hits.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      hits.sort((a, b) => a.x - b.x);
      for (let i = 1; i < hits.length; i += 2)
        lines.push(line([hits[i - 1], hits[i]], 0.1));
    }
  }
  return lines;
}

export function documentMarks(
  plan: DraftPlanState,
  storeyId: string,
  scale: number,
) {
  const output: DrawingPrimitive[] = [];
  const unresolved: string[] = [];
  for (const mark of plan.documentItems ?? []) {
    if (!isDrawingMark(mark) || mark.storeyId !== storeyId) continue;
    if (mark.kind === "hatch") {
      output.push(...hatchLines(mark));
      continue;
    }
    const anchors = markAnchors(mark).map((anchor) =>
      anchorPoint(plan, storeyId, anchor),
    );
    if (anchors.some((p) => !p)) {
      unresolved.push(mark.id);
      continue;
    }
    const points = anchors as Point[];
    if (mark.kind !== "chain") {
      output.push(
        line([points[0], mark.labelAt]),
        note(mark.labelAt, mark.text, mark.kind === "tag" ? 3.2 : 3),
      );
      if (mark.kind === "tag") {
        const { x, y } = points[0];
        output.push(
          line([
            { x: x - scale, y },
            { x: x + scale, y },
          ]),
        );
      }
      continue;
    }
    const horizontal = mark.axis === "horizontal";
    const along = (p: Point) => (horizontal ? p.x : p.y);
    const across = (p: Point) => (horizontal ? p.y : p.x);
    const toPoint = (u: number, v: number) =>
      horizontal ? { x: u, y: v } : { x: v, y: u };
    const plane =
      (mark.offsetMm >= 0 ? Math.max : Math.min)(...points.map(across)) +
      mark.offsetMm;
    points.sort((a, b) => along(a) - along(b));
    const ticks = [...new Map(points.map((p) => [along(p), p])).values()];
    for (const p of ticks) {
      const u = along(p);
      const direction = Math.sign(plane - across(p)) || 1;
      output.push(line([p, toPoint(u, plane + direction * scale)]));
      output.push(
        line([
          toPoint(u - scale, plane + scale),
          toPoint(u + scale, plane - scale),
        ]),
      );
    }
    for (let i = 1; i < ticks.length; i++) {
      const a = along(ticks[i - 1]);
      const b = along(ticks[i]);
      output.push(
        line([toPoint(a, plane), toPoint(b, plane)]),
        note(
          toPoint((a + b) / 2, plane - scale * 1.4),
          String(Math.round(b - a)),
          2.75,
          "middle",
        ),
      );
    }
  }
  return { primitives: output, unresolved };
}

function modelDrawing(plan: DraftPlanState, storeyId: string, scale: number) {
  const drawing = storeyPlan(plan, storeyId);
  const output: DrawingPrimitive[] = [];
  const layers = new Map(
    plan.drawingLayers?.flatMap((layer) =>
      layer.members.map(({ kind, id }) => [kind + ":" + id, layer] as const),
    ) ?? [],
  );
  function outline(
    points: Point[],
    closed: boolean,
    kind: DrawingEntity["kind"],
    id: string,
    weight: number,
    fill?: string,
  ) {
    const style = layers.get(kind + ":" + id);
    output.push({
      kind: "path",
      points,
      closed,
      source: id,
      fill,
      weight: style?.lineWeightMm ?? weight,
      ...(style?.lineStyle === "dashed"
        ? { dash: [2, 1] }
        : style?.lineStyle === "dotted"
          ? { dash: [0.35, 1] }
          : {}),
    });
  }
  const openings = [...drawing.openings, ...(drawing.windows ?? [])];
  const wallsById = new Map(drawing.walls.map((wall) => [wall.id, wall]));
  for (const item of elementsOnStorey(plan, storeyId)) {
    const footprint = buildingElementFootprint(item);
    if (footprint)
      output.push({
        kind: "path",
        points: footprint,
        closed: true,
        weight: 0.18,
        dash: [2, 1],
      });
    if (item.kind === "slab") {
      for (const opening of openingsForSlab(plan, item.id))
        output.push({
          kind: "path",
          points: opening.footprint,
          closed: true,
          weight: 0.18,
          dash: [1, 1],
        });
    }
  }
  for (const wall of drawing.walls)
    for (const run of wallRuns(wall, openings))
      outline(
        wallMaterialFootprint(wall, run),
        true,
        "wall",
        wall.id,
        0.35,
        "#e4e6e3",
      );
  for (const door of drawing.openings) {
    const { hinge, closed, leaf, clockwise } = doorSwing(
      wallsById.get(door.wallId)!,
      door,
    );
    outline([hinge, leaf], false, "door", door.id, 0.2);
    const start =
      (Math.atan2(closed.y - hinge.y, closed.x - hinge.x) * 180) / Math.PI;
    outline(
      Array.from({ length: 17 }, (_, i) =>
        pointAt(hinge, door.widthMm, start + ((clockwise ? 90 : -90) * i) / 16),
      ),
      false,
      "door",
      door.id,
      0.15,
    );
  }
  for (const window of drawing.windows ?? []) {
    const wall = wallsById.get(window.wallId)!;
    const [start, end] = doorBounds(window).map((offset) =>
      pointAlong(wall, offset),
    );
    outline(
      wallMaterialFootprint(wall, { start, end }),
      true,
      "window",
      window.id,
      0.18,
    );
    outline([start, end], false, "window", window.id, 0.15);
  }
  for (const fixture of drawing.fixtures)
    outline(fixtureFootprint(fixture), true, "fixture", fixture.id, 0.18);
  for (const utility of drawing.utilities) {
    const { x, y } = utility.position;
    const r = scale * 1.2;
    outline(
      [
        { x: x - r, y },
        { x: x + r, y },
      ],
      false,
      "utility",
      utility.id,
      0.18,
    );
    outline(
      [
        { x, y: y - r },
        { x, y: y + r },
      ],
      false,
      "utility",
      utility.id,
      0.18,
    );
  }
  for (const sketch of drawing.sketches ?? []) {
    const g = sketch.geometry;
    if (g.kind === "construction" || g.kind === "polyline") {
      outline(
        g.kind === "construction" ? [g.start, g.end] : g.points,
        g.kind === "polyline" && g.closed,
        "sketch",
        sketch.id,
        0.18,
      );
    } else {
      const start = g.kind === "circle" ? 0 : g.startDeg;
      const sweep = g.kind === "circle" ? 360 : g.sweepDeg;
      const segments = Math.ceil(sweep / 5);
      outline(
        Array.from({ length: segments + 1 }, (_, i) =>
          pointAt(g.center, g.radiusMm, start + (sweep * i) / segments),
        ),
        g.kind === "circle",
        "sketch",
        sketch.id,
        0.18,
      );
    }
  }
  for (const dimension of drawing.annotations ?? []) {
    outline(
      [dimension.start, dimension.end],
      false,
      "dimension",
      dimension.id,
      0.18,
    );
    output.push(
      note(
        {
          x: (dimension.start.x + dimension.end.x) / 2,
          y: (dimension.start.y + dimension.end.y) / 2 - scale,
        },
        String(
          Math.round(
            Math.hypot(
              dimension.end.x - dimension.start.x,
              dimension.end.y - dimension.start.y,
            ),
          ),
        ),
        2.75,
        "middle",
      ),
    );
  }
  const marks = documentMarks(plan, storeyId, scale);
  return {
    primitives: [...output, ...marks.primitives],
    unresolved: marks.unresolved,
  };
}

function sourceDrawing(
  plan: DraftPlanState,
  view: NamedDrawingView,
  scale: number,
) {
  if (view.source.kind === "plan")
    return modelDrawing(plan, view.source.storeyId, scale);
  const source = view.source;
  const vertical = plan.buildingViews?.find(({ id }) => id === source.viewId);
  if (!vertical) return { primitives: [], unresolved: [] };
  const projected = deriveBuildingView(plan, vertical);
  const primitives: DrawingPrimitive[] = projected.surfaces.map(
    ({ id, polygon, kind }) => ({
      kind: "path",
      closed: true,
      weight: kind === "wall" ? 0.3 : 0.18,
      points: polygon.map(({ x, y }) => ({ x, y: -y })),
      source: id,
      fill: kind === "glazing" ? "#f0f4f4" : "#e9eae7",
    }),
  );
  const extent = bounds(
    primitives.flatMap((p) => (p.kind === "path" ? p.points : [])),
  );
  if (primitives.length)
    for (const storey of projected.storeys) {
      const y = -storey.elevationMm;
      primitives.push(
        {
          kind: "path",
          points: [
            { x: extent.left, y },
            { x: extent.right, y },
          ],
          weight: 0.1,
          dash: [2, 1],
        },
        note({ x: extent.left, y: y - scale * 2 }, storey.name, 2.75),
      );
    }
  return { primitives, unresolved: [] };
}

export function viewCenter(
  plan: DraftPlanState,
  source: NamedDrawingView["source"],
) {
  const view: NamedDrawingView = {
    kind: "view",
    id: "",
    name: "",
    source,
    center: { x: 0, y: 0 },
  };
  const box = bounds(
    sourceDrawing(plan, view, 50).primitives.flatMap((p) =>
      p.kind === "path" ? p.points : [p.at],
    ),
  );
  return Number.isFinite(box.left)
    ? {
        x: Math.round((box.left + box.right) / 2),
        y: Math.round((box.top + box.bottom) / 2),
      }
    : view.center;
}

export function paperDrawing(plan: DraftPlanState, sheet: Sheet) {
  const items = plan.documentItems ?? [];
  const panels = items.flatMap((item) => {
    if (item.kind !== "viewport" || item.sheetId !== sheet.id) return [];
    const view = items.find(
      (v): v is NamedDrawingView => v.kind === "view" && v.id === item.viewId,
    );
    if (!view) return [];
    const viewDrawing = sourceDrawing(plan, view, item.scale);
    const project = ({ x, y }: Point) => ({
      x: item.x + item.width / 2 + (x - view.center.x) / item.scale,
      y: item.y + item.height / 2 + (y - view.center.y) / item.scale,
    });
    return [
      {
        viewport: item,
        name: view.name,
        unresolved: viewDrawing.unresolved,
        primitives: viewDrawing.primitives.map((p) =>
          p.kind === "path"
            ? { ...p, points: p.points.map(project) }
            : { ...p, at: project(p.at) },
        ),
      },
    ];
  });
  return { sheet, ...paperSize(sheet), panels };
}
