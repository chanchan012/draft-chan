import {
  Colors,
  DxfWriter,
  LWPolylineFlags,
  Units,
  point2d,
  point3d,
} from "@tarikjabiri/dxf";
import { utilityCatalog } from "./catalog";
import { bounds, fixtureFootprint, wallFootprint } from "./footprints";
import { doorSwing, wallRuns } from "./openings";
import type { DraftPlanState, Point } from "./model";
import type { BlueprintFormat } from "./exports";

function blueprintGeometry(plan: DraftPlanState) {
  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));
  return {
    walls: plan.walls.flatMap((wall) =>
      wallRuns(wall, plan.openings).map(({ start, end }) =>
        wallFootprint(start, end, wall.thicknessMm),
      ),
    ),
    doors: plan.openings.map((door) => ({
      ...doorSwing(wallsById.get(door.wallId)!, door),
      radius: door.widthMm,
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

function exportDxf({ walls, doors, fixtures, utilities }: Geometry) {
  const writer = new DxfWriter();
  writer.setUnits(Units.Millimeters);
  writer.addLayer("WALLS", Colors.White);
  writer.addLayer("DOORS", Colors.Yellow);
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
  { walls, doors, fixtures, utilities }: Geometry,
  title: string,
) {
  const points = [
    ...walls.flat(),
    ...fixtures.flat(),
    ...doors.flatMap(({ hinge, radius }) => square(hinge, radius)),
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
    layer("walls", "#253a49", "#253a49", walls.map(polygonTag).join("")),
    layer("doors", "none", "#38566c", doorShapes),
    layer("fixtures", "#e9eff3", "#38566c", fixtures.map(polygonTag).join("")),
    layer("electrical", "#edf6ff", "#2463a3", utilityShapes("electrical")),
    layer("plumbing", "#e5f5f0", "#187260", utilityShapes("plumbing")),
    "</svg>",
  ].join("\n");
}

export function renderBlueprint(
  format: BlueprintFormat,
  plan: DraftPlanState,
  title: string,
) {
  const geometry = blueprintGeometry(plan);
  return format === "dxf" ? exportDxf(geometry) : exportSvg(geometry, title);
}
