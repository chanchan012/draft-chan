import {
  placementLimit,
  sketchSchema,
  type DraftPlanState,
  type PlanCommand,
  type Point,
  type SketchGeometry,
} from "./model";
import { normalizeDegrees } from "./sketch";
import { storeyById } from "./storeys";

export const dxfUnits = ["mm", "cm", "m", "in", "ft"] as const;
export type DxfUnit = (typeof dxfUnits)[number];
const units = new Map<number, DxfUnit>([
  [1, "in"],
  [2, "ft"],
  [4, "mm"],
  [5, "cm"],
  [6, "m"],
]);
const millimeters = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const colors = [
  "#314439",
  "#bf554c",
  "#926c22",
  "#417550",
  "#367483",
  "#4665ab",
  "#8d4b88",
  "#314439",
];
type Pair = { code: number; value: string };
type Record = { type: string; properties: Pair[] };
export type DxfShape = { layer: string; geometry: SketchGeometry };
type Style = { color: string; lineStyle: "solid" | "dashed" | "dotted" };

function sections(source: string) {
  if (!source.trim() || source.length > 2_000_000 || source.includes("\0"))
    throw new Error("Choose an ASCII DXF file up to 2 MB.");
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.length % 2 && !lines.at(-1)?.trim()) lines.pop();
  if (lines.length % 2)
    throw new Error("The DXF contains an incomplete group.");
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = lines[i].trim();
    if (!/^\d{1,4}$/.test(code))
      throw new Error("Invalid DXF group code near line " + (i + 1) + ".");
    pairs.push({ code: Number(code), value: lines[i + 1].trim() });
  }
  const result = new Map<string, Pair[]>();
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== "SECTION") continue;
    const title = pairs[i + 1];
    if (title?.code !== 2 || result.has(title.value))
      throw new Error("Invalid DXF section header.");
    const start = i + 2;
    i = start;
    while (
      i < pairs.length &&
      !(pairs[i].code === 0 && pairs[i].value === "ENDSEC")
    )
      i++;
    if (i === pairs.length) throw new Error("DXF section is missing ENDSEC.");
    result.set(title.value, pairs.slice(start, i));
  }
  return result;
}

function records(pairs: Pair[]) {
  const result: Record[] = [];
  for (const pair of pairs) {
    if (pair.code === 0) result.push({ type: pair.value, properties: [] });
    else result.at(-1)?.properties.push(pair);
  }
  return result;
}

const field = (data: Pair[], code: number) =>
  data.find((pair) => pair.code === code)?.value;
function number(data: Pair[], code: number, fallback = NaN) {
  const value = field(data, code);
  return value === undefined ? fallback : value ? Number(value) : NaN;
}
const layerName = (raw?: string) =>
  raw
    ?.replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, 80) || "0";

function layerStyles(table: Pair[]) {
  const result = new Map<string, Style>();
  for (const { type, properties: data } of records(table)) {
    if (type !== "LAYER") continue;
    const rgb = number(data, 420);
    const pattern = (field(data, 6) ?? "").toUpperCase();
    result.set(layerName(field(data, 2)).toUpperCase(), {
      color:
        Number.isInteger(rgb) && rgb >= 0 && rgb <= 0xffffff
          ? "#" + rgb.toString(16).padStart(6, "0")
          : (colors[Math.abs(number(data, 62, 7))] ?? colors[7]),
      lineStyle: pattern.includes("DOT")
        ? "dotted"
        : /DASH|HIDDEN|CENTER|PHANTOM/.test(pattern)
          ? "dashed"
          : "solid",
    });
  }
  return result;
}

function geometryOf(
  { type, properties: data }: Record,
  factor: number,
): SketchGeometry {
  if (
    number(data, 67, 0) !== 0 ||
    (field(data, 410) && field(data, 410)?.toUpperCase() !== "MODEL")
  )
    throw new Error("Paper space");
  if (
    number(data, 38, 0) !== 0 ||
    number(data, 39, 0) !== 0 ||
    number(data, 210, 0) !== 0 ||
    number(data, 220, 0) !== 0 ||
    number(data, 230, 1) !== 1 ||
    data.some(
      ({ code, value }) => (code === 30 || code === 31) && Number(value) !== 0,
    )
  )
    throw new Error("3D coordinates or extrusion");
  const point = (x: number, y: number): Point => ({
    x: Math.round(x * factor),
    y: Math.round(-y * factor) + 0,
  });
  const start = point(number(data, 10), number(data, 20));
  if (type === "LINE")
    return {
      kind: "construction",
      start,
      end: point(number(data, 11), number(data, 21)),
    };
  if (type === "LWPOLYLINE") {
    if (
      data.some(
        ({ code, value }) =>
          [40, 41, 42, 43].includes(code) && Number(value) !== 0,
      )
    )
      throw new Error("Bulges or widths");
    const points: Point[] = [];
    let x: number | undefined;
    for (const { code, value } of data) {
      if (code === 10) {
        if (x !== undefined) throw new Error("Incomplete vertices");
        x = value ? Number(value) : NaN;
      } else if (code === 20) {
        if (x === undefined) throw new Error("Incomplete vertices");
        points.push(point(x, value ? Number(value) : NaN));
        x = undefined;
      }
    }
    if (x !== undefined || number(data, 90, points.length) !== points.length)
      throw new Error("Incomplete vertices");
    const closed = Boolean(number(data, 70, 0) & 1);
    if (
      closed &&
      points.length > 1 &&
      points[0].x === points.at(-1)?.x &&
      points[0].y === points.at(-1)?.y
    )
      points.pop();
    return { kind: "polyline", points, closed };
  }
  const radiusMm = number(data, 40) * factor;
  if (type === "CIRCLE") return { kind: "circle", center: start, radiusMm };
  return {
    kind: "arc",
    center: start,
    radiusMm,
    startDeg: normalizeDegrees(-number(data, 51)),
    sweepDeg: normalizeDegrees(number(data, 51) - number(data, 50)),
  };
}

const supported = new Set(["LINE", "LWPOLYLINE", "CIRCLE", "ARC"]);
export function stageDxf(text: string, override?: DxfUnit) {
  const source = sections(text);
  const entities = source.get("ENTITIES");
  if (!entities) throw new Error("The drawing has no DXF ENTITIES section.");
  const header = source.get("HEADER") ?? [];
  const index = header.findIndex(
    ({ code, value }) => code === 9 && value === "$INSUNITS",
  );
  const unitCode =
    index < 0 || header[index + 1]?.code !== 70
      ? 0
      : Number(header[index + 1].value) || 0;
  const declaredUnit = units.get(unitCode);
  const unit = override ?? declaredUnit;
  const styles = layerStyles(source.get("TABLES") ?? []);
  const layers = new Map<
    string,
    { name: string; supported: number; skipped: number } & Style
  >();
  const unsupported = new Map<string, number>();
  const shapes: DxfShape[] = [];
  for (const entity of records(entities)) {
    const name = layerName(field(entity.properties, 8));
    const key = name.toUpperCase();
    const layer = layers.get(key) ?? {
      name,
      supported: 0,
      skipped: 0,
      ...(styles.get(key) ?? { color: colors[7], lineStyle: "solid" as const }),
    };
    layers.set(key, layer);
    try {
      if (!supported.has(entity.type)) throw new Error("Unsupported entity");
      const geometry = geometryOf(entity, unit ? millimeters[unit] : 1);
      if (unit) {
        if (!sketchSchema.safeParse({ id: "staged", geometry }).success)
          throw new Error(
            "Outside model limits or degenerate at 1 mm precision",
          );
        if (shapes.length >= placementLimit)
          throw new Error("Staging limit of 512 entities");
        shapes.push({ layer: layer.name, geometry });
      }
      layer.supported++;
    } catch (error) {
      layer.skipped++;
      const reason =
        entity.type +
        " · " +
        (error instanceof Error ? error.message : "Invalid entity");
      unsupported.set(reason, (unsupported.get(reason) ?? 0) + 1);
    }
  }
  return {
    declaredUnit,
    unitCode,
    unit,
    shapes,
    layers: [...layers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unsupported: [...unsupported].map(([reason, count]) => ({ reason, count })),
  };
}
export type StagedDxf = ReturnType<typeof stageDxf>;

export function dxfImportCommands(
  plan: DraftPlanState,
  staged: StagedDxf,
  storeyId: string,
  selected: string[],
) {
  storeyById(plan, storeyId);
  if (!staged.unit) throw new Error("Choose the source length unit first.");
  const chosen = new Set(selected);
  const shapes = staged.shapes.filter(({ layer }) => chosen.has(layer));
  if (!shapes.length)
    throw new Error("Choose at least one layer with supported geometry.");
  if (shapes.length + (plan.sketches?.length ?? 0) > placementLimit)
    throw new Error("This import would exceed the plan's sketch limit.");
  const commands: PlanCommand[] = [];
  const targetLayers = [...(plan.drawingLayers ?? [])];
  for (const source of staged.layers) {
    const members = shapes
      .filter(({ layer }) => layer === source.name)
      .map(({ geometry }) => {
        const id = crypto.randomUUID();
        commands.push({
          type: "sketch.add",
          sketch: { id, storeyId, geometry },
        });
        return { kind: "sketch" as const, id };
      });
    if (!members.length) continue;
    const existing = targetLayers.find(
      ({ name }) => name.toUpperCase() === source.name.toUpperCase(),
    );
    if (existing?.locked)
      throw new Error(
        "Unlock the " + existing.name + " layer before importing to it.",
      );
    const layer = existing
      ? { ...existing, members: [...existing.members, ...members] }
      : {
          id: crypto.randomUUID(),
          name: source.name,
          color: source.color,
          lineStyle: source.lineStyle,
          visible: true,
          locked: false,
          members,
        };
    commands.push({ type: "layer.write", layer });
    if (!existing) targetLayers.push(layer);
  }
  return { commands, imported: shapes.length };
}
