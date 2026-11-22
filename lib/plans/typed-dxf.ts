import {
  Colors,
  DxfWriter,
  LWPolylineFlags,
  Units,
  point2d,
  point3d,
} from "@tarikjabiri/dxf";
import type { DraftPlanState, Point, SketchGeometry } from "./model";
import { normalizeDegrees } from "./sketch";
import { storeyById, storeyOf } from "./storeys";

export function writeDxfSketch(
  writer: DxfWriter,
  geometry: SketchGeometry,
  layerName: string,
) {
  const options = { layerName };
  const vertex = (point: Point) => point3d(point.x, -point.y, 0);
  switch (geometry.kind) {
    case "construction":
      writer.addLine(vertex(geometry.start), vertex(geometry.end), options);
      break;
    case "polyline":
      writer.addLWPolyline(
        geometry.points.map(({ x, y }) => ({ point: point2d(x, -y) })),
        {
          ...options,
          flags: geometry.closed ? LWPolylineFlags.Closed : 0,
        },
      );
      break;
    case "circle":
      writer.addCircle(vertex(geometry.center), geometry.radiusMm, options);
      break;
    case "arc":
      writer.addArc(
        vertex(geometry.center),
        geometry.radiusMm,
        normalizeDegrees(-geometry.startDeg - geometry.sweepDeg),
        normalizeDegrees(-geometry.startDeg),
        options,
      );
      break;
  }
}

export function renderTypedDxf(plan: DraftPlanState, storeyId?: string) {
  const storey = storeyById(plan, storeyId);
  const writer = new DxfWriter();
  writer.setUnits(Units.Millimeters);
  writer.addLType("DASHED", "Dashed", [6, -3]);
  writer.addLType("DOTTED", "Dotted", [0, -3]);
  const names = new Set(["0", "DEFPOINTS"]);
  const layerNames = new Map<string, string>();
  const members = new Map<string, string>();
  for (const layer of plan.drawingLayers ?? []) {
    const clean =
      layer.name.replace(/[\x00-\x1f\x7f<>/\\":;?*|=]/g, "_").trim() || "LAYER";
    let name = clean;
    if (name === "0") {
      const existing = writer.layer("0");
      if (existing) {
        existing.trueColor = Number.parseInt(layer.color.slice(1), 16);
        existing.lineType =
          layer.lineStyle === "solid"
            ? "Continuous"
            : layer.lineStyle.toUpperCase();
      }
    } else {
      let suffix = 2;
      while (names.has(name.toUpperCase())) name = clean + "-" + suffix++;
      names.add(name.toUpperCase());
      writer.addLayer(
        name,
        Colors.White,
        layer.lineStyle === "solid"
          ? "Continuous"
          : layer.lineStyle.toUpperCase(),
      ).trueColor = Number.parseInt(layer.color.slice(1), 16);
    }
    layerNames.set(layer.id, name);
    for (const item of layer.members)
      if (item.kind === "sketch") members.set(item.id, layer.id);
  }
  for (const sketch of plan.sketches ?? []) {
    if (storeyOf(sketch) !== storey.id) continue;
    writeDxfSketch(
      writer,
      sketch.geometry,
      layerNames.get(members.get(sketch.id) ?? "") ?? "0",
    );
  }
  return writer.stringify();
}
