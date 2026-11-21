import {
  Colors,
  DxfWriter,
  LWPolylineFlags,
  Units,
  point2d,
  point3d,
} from "@tarikjabiri/dxf";
import { drivingDimensions } from "./constraints";
import { utilityCatalog } from "./catalog";
import {
  bounds,
  fixtureFootprint,
  wallMaterialFootprint,
  wallMaterialCenter,
} from "./footprints";
import {
  doorBounds,
  doorSwing,
  pointAlong,
  wallLength,
  wallRuns,
} from "./openings";
import {
  normalizeDegrees,
  shiftSketch,
  sketchPath,
  sketchPoints,
} from "./sketch";
import {
  elementsOnStorey,
  roofProfile,
  slabPolygons,
  stairFootprint,
  stairSteps,
  storeyVoids,
} from "./building";
import { planStoreys, storeyPlan } from "./storeys";
import type { DraftPlanState, Point } from "./model";
import type { BlueprintFormat } from "./exports";

type StructuralOutline = {
  layer: "SLABS" | "STAIRS" | "FLOOR_OPENINGS" | "ROOFS";
  rings: Point[][];
  lines: [Point, Point][];
};
function structuralOutlines(
  plan: DraftPlanState,
  storeyId: string,
): StructuralOutline[] {
  const outlines: StructuralOutline[] = [];
  for (const item of elementsOnStorey(plan, storeyId)) {
    if (item.kind === "slab")
      for (const rings of slabPolygons(plan, item))
        outlines.push({ layer: "SLABS", rings, lines: [] });
    else if (item.kind === "stair" && item.fromStoreyId === storeyId)
      outlines.push({
        layer: "STAIRS",
        rings: [stairFootprint(item)],
        lines: stairSteps(plan, item)
          .slice(1)
          .map(({ footprint }) => [footprint[0], footprint[3]]),
      });
    else if (item.kind === "roof") {
      const ridge = roofProfile(plan, item).ridgePoints;
      outlines.push({
        layer: "ROOFS",
        rings: [item.footprint],
        lines: ridge.length === 2 ? [[ridge[0], ridge[1]]] : [],
      });
    }
  }
  for (const hole of storeyVoids(plan, storeyId))
    outlines.push({
      layer: "FLOOR_OPENINGS",
      rings: [hole.footprint],
      lines: [],
    });
  return outlines;
}

function blueprintGeometry(plan: DraftPlanState, storeyId = "ground") {
  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const openings = [...plan.openings, ...(plan.windows ?? [])];
  return {
    structure: structuralOutlines(plan, storeyId),
    labels: [] as { name: string; position: Point }[],
    sketches: (plan.sketches ?? []).map(({ geometry }) => geometry),
    walls: plan.walls.flatMap((wall) =>
      wallRuns(wall, openings).map(({ start, end }) =>
        wallMaterialFootprint(wall, { start, end }),
      ),
    ),
    doors: plan.openings.map((door) => ({
      ...doorSwing(wallsById.get(door.wallId)!, door),
      radius: door.widthMm,
    })),
    windows: (plan.windows ?? []).map((window) => {
      const wall = wallsById.get(window.wallId)!;
      const [start, end] = doorBounds(window).map((offset) =>
        pointAlong(wall, offset),
      );
      return {
        ...wallMaterialCenter(wall, { start, end }),
        outline: wallMaterialFootprint(wall, { start, end }),
      };
    }),
    dimensions: [
      ...(plan.annotations ?? []),
      ...drivingDimensions(plan.walls, plan.constraints),
    ].map((item) => ({
      ...item,
      text:
        ("distanceMm" in item
          ? item.distanceMm
          : Math.round(wallLength(item))) + " mm",
      label: {
        x: (item.start.x + item.end.x) / 2,
        y: (item.start.y + item.end.y) / 2 - 65,
      },
    })),
    fixtures: plan.fixtures.map(fixtureFootprint),
    utilities: plan.utilities.map(({ position, template }) => ({
      position,
      ...utilityCatalog[template],
    })),
  };
}
type Geometry = ReturnType<typeof blueprintGeometry>;

const utilityRadius = 55;
const rounded = (value: number) => Number(value.toFixed(6));

function square({ x, y }: Point, radius: number) {
  return [
    { x: x - radius, y: y - radius },
    { x: x + radius, y: y - radius },
    { x: x + radius, y: y + radius },
    { x: x - radius, y: y + radius },
  ];
}

function exportDxf({
  walls,
  doors,
  windows,
  dimensions,
  fixtures,
  utilities,
  sketches,
  labels,
  structure,
}: Geometry) {
  const writer = new DxfWriter();
  writer.setUnits(Units.Millimeters);
  writer.addLayer("WALLS", Colors.White);
  writer.addLayer("DOORS", Colors.Yellow);
  if (windows.length) writer.addLayer("WINDOWS", Colors.Cyan);
  if (dimensions.length) writer.addLayer("DIMENSIONS", Colors.Green);
  writer.addLayer("FIXTURES", Colors.Cyan);
  writer.addLayer("ELECTRICAL", Colors.Blue);
  writer.addLayer("PLUMBING", Colors.Green);
  // Draft draws with Y increasing down. CAD model space uses Y increasing up.
  const vertex = (p: Point) => point3d(rounded(p.x), rounded(-p.y), 0);
  function polygon(points: Point[], layerName: string) {
    writer.addLWPolyline(
      points.map((p) => ({ point: point2d(rounded(p.x), rounded(-p.y)) })),
      { layerName, flags: LWPolylineFlags.Closed },
    );
  }

  if (sketches.some(({ kind }) => kind === "construction"))
    writer.addLayer("CONSTRUCTION", Colors.Cyan);
  if (sketches.some(({ kind }) => kind !== "construction"))
    writer.addLayer("SKETCH", Colors.White);
  for (const geometry of sketches) {
    const layerName =
      geometry.kind === "construction" ? "CONSTRUCTION" : "SKETCH";
    const options = { layerName };
    switch (geometry.kind) {
      case "construction":
        writer.addLine(vertex(geometry.start), vertex(geometry.end), options);
        break;
      case "polyline":
        writer.addLWPolyline(
          geometry.points.map((p) => ({ point: point2d(p.x, -p.y) })),
          { ...options, flags: geometry.closed ? LWPolylineFlags.Closed : 0 },
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
  for (const points of walls) polygon(points, "WALLS");
  for (const { hinge, closed, leaf, clockwise, radius } of doors) {
    const angle = (p: Point) =>
      rounded(
        ((Math.atan2(hinge.y - p.y, p.x - hinge.x) * 180) / Math.PI + 360) %
          360,
      );
    // DXF arcs always run counterclockwise in model space.
    const start = angle(clockwise ? leaf : closed);
    const end = angle(clockwise ? closed : leaf);
    const options = { layerName: "DOORS" };
    writer.addLine(vertex(hinge), vertex(leaf), options);
    writer.addArc(vertex(hinge), radius, start, end, options);
  }
  for (const points of fixtures) polygon(points, "FIXTURES");
  for (const { start, end, outline } of windows) {
    polygon(outline, "WINDOWS");
    writer.addLine(vertex(start), vertex(end), { layerName: "WINDOWS" });
  }
  for (const { start, end, text, label } of dimensions) {
    writer.addLine(vertex(start), vertex(end), { layerName: "DIMENSIONS" });
    writer.addText(vertex(label), 60, text, { layerName: "DIMENSIONS" });
  }
  for (const { position, glyph, layer } of utilities) {
    const layerName = layer.toUpperCase();
    if (layer === "electrical")
      polygon(square(position, utilityRadius), layerName);
    else writer.addCircle(vertex(position), utilityRadius, { layerName });
    writer.addText(
      vertex({ x: position.x - 15, y: position.y + 18 }),
      45,
      glyph,
      { layerName },
    );
  }
  for (const name of new Set(structure.map((item) => item.layer)))
    writer.addLayer(name, Colors.Cyan);
  for (const item of structure) {
    for (const ring of item.rings) polygon(ring, item.layer);
    for (const [a, b] of item.lines)
      writer.addLine(vertex(a), vertex(b), { layerName: item.layer });
  }
  if (labels.length) {
    writer.addLayer("STOREYS", Colors.White);
    for (const label of labels)
      writer.addText(
        vertex(label.position),
        125,
        label.name.replace(/[\u0000-\u001f\u007f]/g, " "),
        { layerName: "STOREYS" },
      );
  }
  return writer.stringify();
}

function escapeXml(title: string) {
  return title
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
const coordinate = (point: Point) => `${rounded(point.x)} ${rounded(point.y)}`;
const polygonTag = (points: Point[]) =>
  `<polygon points="${points.map(coordinate).join(" ")}"/>`;

function exportSvg(
  {
    walls,
    doors,
    windows,
    dimensions,
    fixtures,
    utilities,
    sketches,
    labels,
    structure,
  }: Geometry,
  title: string,
) {
  const points = [
    ...walls.flat(),
    ...structure.flatMap((item) => [
      ...item.rings.flat(),
      ...item.lines.flat(),
    ]),
    ...labels.flatMap(({ name, position }) => [
      position,
      { x: position.x + name.length * 82, y: position.y - 140 },
    ]),
    ...sketches.flatMap(sketchPoints),
    ...fixtures.flat(),
    ...doors.flatMap(({ hinge, radius }) => square(hinge, radius)),
    ...windows.flatMap(({ outline }) => outline),
    ...dimensions.flatMap(({ start, end, label, text }) => [
      start,
      end,
      { x: label.x - text.length * 20, y: label.y - 60 },
      { x: label.x + text.length * 20, y: label.y },
    ]),
    ...utilities.flatMap(({ position }) => square(position, utilityRadius)),
  ];
  const { left, top, right, bottom } = bounds(
    points.length
      ? points
      : [
          { x: 0, y: 0 },
          { x: 1000, y: 1000 },
        ],
  );
  const pad = 120;
  const width = rounded(right - left + 2 * pad);
  const height = rounded(bottom - top + 2 * pad);
  const viewBox = [rounded(left - pad), rounded(top - pad), width, height].join(
    " ",
  );
  const layer = (id: string, fill: string, stroke: string, body: string) =>
    `<g id="${id}" fill="${fill}" stroke="${stroke}" stroke-width="8">${body}</g>`;
  const doorShapes = doors
    .map(
      ({ hinge, closed, leaf, clockwise, radius }) =>
        `<path d="M ${coordinate(hinge)} L ${coordinate(leaf)} M ${coordinate(closed)} A ${radius} ${radius} 0 0 ${Number(clockwise)} ${coordinate(leaf)}"/>`,
    )
    .join("");
  const windowShapes = windows
    .map(
      ({ start, end, outline }) =>
        polygonTag(outline) +
        `<path d="M ${coordinate(start)} L ${coordinate(end)}"/>`,
    )
    .join("");
  const dimensionShapes = dimensions
    .map(
      ({ start, end, label, text }) =>
        `<path d="M ${coordinate(start)} L ${coordinate(end)}"/><text x="${rounded(label.x)}" y="${rounded(label.y)}" text-anchor="middle" font-size="60" stroke="none" fill="#466358">${text}</text>`,
    )
    .join("");
  const utilityShapes = (kind: "electrical" | "plumbing") =>
    utilities
      .filter(({ layer }) => layer === kind)
      .map(({ position, glyph }) => {
        const x = rounded(position.x),
          y = rounded(position.y);
        const outline =
          kind === "electrical"
            ? polygonTag(square(position, utilityRadius))
            : `<circle cx="${x}" cy="${y}" r="${utilityRadius}"/>`;
        return (
          outline +
          `<text x="${x}" y="${y + 17}" text-anchor="middle" font-family="monospace" font-size="48" stroke="none" fill="#203346">${glyph}</text>`
        );
      })
      .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${viewBox}">`,
    `<title>${escapeXml(title)}</title>`,
    ...labels.map(
      (label) =>
        `<text x="${rounded(label.position.x)}" y="${rounded(label.position.y)}" font-size="125" fill="#253a49">${escapeXml(label.name)}</text>`,
    ),
    ...structure.map((item) => {
      const d =
        item.rings
          .map((ring) => "M " + ring.map(coordinate).join(" L ") + " Z")
          .join(" ") +
        item.lines
          .map(([a, b]) => " M " + coordinate(a) + " L " + coordinate(b))
          .join("");
      return `<path data-layer="${item.layer}" d="${d}" fill="${item.layer === "SLABS" ? "#edf0eb" : "none"}" fill-rule="evenodd" stroke="#627b77" stroke-width="8"/>`;
    }),
    layer("walls", "#253a49", "#253a49", walls.map(polygonTag).join("")),
    layer("doors", "none", "#38566c", doorShapes),
    ...(windows.length
      ? [layer("windows", "#cadee6", "#497082", windowShapes)]
      : []),
    ...(dimensions.length
      ? [layer("dimensions", "none", "#466358", dimensionShapes)]
      : []),
    ...(sketches.length
      ? [
          layer(
            "sketch",
            "none",
            "#3c6672",
            sketches
              .map(
                (geometry) =>
                  `<path d="${sketchPath(geometry)}"${geometry.kind === "construction" ? ' stroke-dasharray="32 20"' : ""}/>`,
              )
              .join(""),
          ),
        ]
      : []),
    layer("fixtures", "#e9eff3", "#38566c", fixtures.map(polygonTag).join("")),
    layer("electrical", "#edf6ff", "#2463a3", utilityShapes("electrical")),
    layer("plumbing", "#e5f5f0", "#187260", utilityShapes("plumbing")),
    "</svg>",
  ].join("\n");
}

function multiStoreyGeometry(plan: DraftPlanState): Geometry {
  const storeys = [...planStoreys(plan)].sort(
    (a, b) => a.elevationMm - b.elevationMm,
  );
  if (storeys.length === 1) return blueprintGeometry(plan);
  const result = blueprintGeometry(storeyPlan(plan, ""), "");
  let right = 0;
  for (const level of storeys) {
    const drawing = storeyPlan(plan, level.id);
    const source = blueprintGeometry(drawing, level.id);
    const points = [
      ...source.walls.flat(),
      ...source.structure.flatMap((item) => [
        ...item.rings.flat(),
        ...item.lines.flat(),
      ]),
      ...source.fixtures.flat(),
      ...source.sketches.flatMap(sketchPoints),
      ...source.doors.flatMap((item) => [item.hinge, item.closed, item.leaf]),
      ...source.windows.flatMap((item) => item.outline),
      ...source.dimensions.flatMap((item) => [item.start, item.end]),
      ...source.utilities.map((item) => item.position),
    ];
    const box = points.length
      ? bounds(points)
      : { left: 0, right: 1000, top: 0 };
    const delta = { x: right - box.left, y: 0 };
    const shift = (point: Point) => ({ x: point.x + delta.x, y: point.y });
    result.labels.push({
      name: level.name,
      position: { x: right, y: box.top - 250 },
    });
    result.structure.push(
      ...source.structure.map((item) => ({
        ...item,
        rings: item.rings.map((ring) => ring.map(shift)),
        lines: item.lines.map(
          ([a, b]) => [shift(a), shift(b)] as [Point, Point],
        ),
      })),
    );
    result.walls.push(...source.walls.map((ring) => ring.map(shift)));
    result.fixtures.push(...source.fixtures.map((ring) => ring.map(shift)));
    result.sketches.push(
      ...source.sketches.map((item) => shiftSketch(item, delta)),
    );
    result.doors.push(
      ...source.doors.map((item) => ({
        ...item,
        hinge: shift(item.hinge),
        closed: shift(item.closed),
        leaf: shift(item.leaf),
      })),
    );
    result.windows.push(
      ...source.windows.map((item) => ({
        ...item,
        start: shift(item.start),
        end: shift(item.end),
        outline: item.outline.map(shift),
      })),
    );
    result.dimensions.push(
      ...source.dimensions.map((item) => ({
        ...item,
        start: shift(item.start),
        end: shift(item.end),
        label: shift(item.label),
      })),
    );
    result.utilities.push(
      ...source.utilities.map((item) => ({
        ...item,
        position: shift(item.position),
      })),
    );
    right +=
      Math.max(box.right - box.left, level.name.length * 82, 1000) + 1600;
  }
  return result;
}

export function renderBlueprint(
  format: Exclude<BlueprintFormat, "pdf">,
  plan: DraftPlanState,
  title: string,
) {
  const geometry = multiStoreyGeometry(plan);
  return format === "dxf" ? exportDxf(geometry) : exportSvg(geometry, title);
}
