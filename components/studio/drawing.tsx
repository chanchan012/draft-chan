import { layersByEntity } from "@/lib/plans/organization";
import type { CSSProperties } from "react";
import { drivingDimensions } from "@/lib/plans/constraints";
import { sketchPath } from "@/lib/plans/sketch";
import { useId, useMemo } from "react";
import {
  fixtureCatalog,
  utilityCatalog,
  type UtilityLayer,
} from "@/lib/plans/catalog";
import {
  wallMaterialFootprint,
  wallMaterialCenter,
} from "@/lib/plans/footprints";
import type { ClearanceIssue } from "@/lib/plans/clearance";
import { unitFactor } from "@/lib/plans/cad";
import {
  doorBounds,
  doorSwing,
  pointAlong,
  wallLength,
} from "@/lib/plans/openings";
import type {
  Door,
  DisplayUnit,
  DraftPlanState,
  Fixture,
  Point,
  Wall,
} from "@/lib/plans/model";

import { isSelected, type Selection } from "@/lib/plans/editor-selection";
import { wallMesh } from "@/lib/plans/wall-mesh";
export type { Selection } from "@/lib/plans/editor-selection";
export type WallPreview = { start: Point; end: Point };
const pair = ({ x, y }: Point) => `${x},${y}`;
const ring = (points: Point[]) => "M" + points.map(pair).join(" ") + "Z";

type LayerPresentation = {
  style?: CSSProperties;
  "data-drawing-layer"?: string;
};

function DoorShape({
  wall,
  door,
  active,
  presentation,
}: {
  wall: Wall;
  door: Door;
  active: boolean;
  presentation?: LayerPresentation;
}) {
  const { hinge, closed, leaf, clockwise } = doorSwing(wall, door);
  return (
    <g
      {...presentation}
      data-door={door.id}
      className={active ? "cad-door is-selected" : "cad-door"}
    >
      <path
        vectorEffect="non-scaling-stroke"
        d={`M${pair(hinge)}L${pair(leaf)}M${pair(closed)}A${door.widthMm},${door.widthMm} 0 0 ${Number(clockwise)} ${pair(leaf)}`}
      />
    </g>
  );
}

function FixtureShape({
  fixture,
  active,
  presentation,
}: {
  fixture: Fixture;
  active: boolean;
  presentation?: LayerPresentation;
}) {
  const { position, widthMm, depthMm, rotation, template } = fixture;
  const x = -widthMm / 2,
    y = -depthMm / 2;
  const isSeat = template === "sofa" || template === "chair";
  const hasBasin = template === "vanity" || template === "kitchenSink";
  return (
    <g
      {...presentation}
      data-fixture={fixture.id}
      className={active ? "cad-fixture is-selected" : "cad-fixture"}
      transform={`translate(${position.x} ${position.y}) rotate(${rotation})`}
    >
      <title>{fixtureCatalog[template].label}</title>
      <rect
        x={x}
        y={y}
        width={widthMm}
        height={depthMm}
        rx={Math.min(65, widthMm / 8, depthMm / 8)}
        vectorEffect="non-scaling-stroke"
      />
      {(isSeat || template === "queenBed") && (
        <path
          d={`M${x + widthMm * 0.1} ${y + depthMm * 0.29}H${x + widthMm * 0.9}V${y + depthMm * 0.87}H${x + widthMm * 0.1}Z`}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {(hasBasin || template === "toilet") && (
        <ellipse
          cx="0"
          cy="0"
          rx={widthMm * 0.32}
          ry={depthMm * 0.32}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {(template === "shower" ||
        template === "wardrobe" ||
        template === "baseCabinet") && (
        <path d={`M${x} ${y}L${-x} ${-y}`} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  );
}

export function ClearanceDrawing({
  issue,
  scale,
}: {
  issue?: ClearanceIssue;
  scale: number;
}) {
  if (!issue) return null;
  return (
    <g className="cad-audit-shape" data-clearance={issue.kind}>
      {issue.polygons?.map((polygon, i) => (
        <path key={i} d={ring(polygon)} vectorEffect="non-scaling-stroke" />
      ))}
      {issue.segment && (
        <ClearanceDimension segment={issue.segment} scale={scale} />
      )}
    </g>
  );
}

function ClearanceDimension({
  segment: [a, b],
  scale,
}: {
  segment: [Point, Point];
  scale: number;
}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cap = 6 / (Math.hypot(dx, dy) * scale);
  const tick = (p: Point) =>
    `M${pair({ x: p.x - dy * cap, y: p.y + dx * cap })}L${pair({ x: p.x + dy * cap, y: p.y - dx * cap })}`;
  return (
    <path
      className="cad-audit-dimension"
      d={`M${pair(a)}L${pair(b)}${tick(a)}${tick(b)}`}
      vectorEffect="non-scaling-stroke"
    />
  );
}

export function PlanDrawing({
  plan,
  selection,
  layers,
  scale,
  unit,
}: {
  plan: DraftPlanState;
  selection: readonly Selection[];
  layers: Record<UtilityLayer, boolean>;
  scale: number;
  unit: DisplayUnit;
}) {
  const indexedLayers = useMemo(
    () => layersByEntity(plan),
    [plan.drawingLayers],
  );
  const paint = (kind: string, id: string): LayerPresentation => {
    const layer = indexedLayers.get(kind + ":" + id);
    if (!layer) return {};
    const dash =
      layer.lineStyle === "dashed"
        ? [7, 4]
        : layer.lineStyle === "dotted"
          ? [2, 4]
          : [];
    return {
      "data-drawing-layer": layer.name,
      style: {
        "--drawing-ink": layer.color,
        "--drawing-dash": dash.join(" ") || "none",
        "--drawing-wall-dash":
          dash.map((value) => value / scale).join(" ") || "none",
      } as CSSProperties,
    };
  };
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const mesh = useMemo(
    () => wallMesh(plan.walls, [...plan.openings, ...(plan.windows ?? [])]),
    [plan.walls, plan.openings, plan.windows],
  );
  return (
    <>
      {plan.rooms.map((room) => (
        <path
          key={room.id}
          className="cad-room"
          d={[room.polygon, ...(room.holes ?? [])].map(ring).join(" ")}
          fillRule="evenodd"
        />
      ))}
      {mesh.joints.map(({ id, walls, footprint }) => (
        <path
          key={id}
          {...paint("wall", walls[0].id)}
          data-wall-join={id}
          className={
            "cad-wall cad-wall-join" +
            (walls.some((wall) => wall.kind === "exterior")
              ? " is-exterior"
              : "") +
            (walls.every((wall) =>
              isSelected(selection, { kind: "wall", id: wall.id }),
            )
              ? " is-selected"
              : "")
          }
          d={ring(footprint)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {plan.walls.map((wall) => (
        <g
          key={wall.id}
          {...paint("wall", wall.id)}
          data-wall={wall.id}
          className={
            "cad-wall" +
            (wall.kind === "exterior" ? " is-exterior" : "") +
            (isSelected(selection, { kind: "wall", id: wall.id })
              ? " is-selected"
              : "")
          }
        >
          {mesh.runs.get(wall.id)!.map((run, i) => {
            const { start, end } = wallMaterialCenter(wall, run);
            return (
              <line
                key={i}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                strokeWidth={wall.thicknessMm}
              />
            );
          })}
        </g>
      ))}
      {plan.fixtures.map((fixture) => (
        <FixtureShape
          key={fixture.id}
          fixture={fixture}
          presentation={paint("fixture", fixture.id)}
          active={isSelected(selection, { kind: "fixture", id: fixture.id })}
        />
      ))}
      {plan.openings.map((door) => (
        <DoorShape
          key={door.id}
          door={door}
          presentation={paint("door", door.id)}
          wall={walls.get(door.wallId)!}
          active={isSelected(selection, { kind: "door", id: door.id })}
        />
      ))}
      {plan.windows?.map((window) => {
        const wall = walls.get(window.wallId)!;
        const [start, end] = doorBounds(window).map((offset) =>
          pointAlong(wall, offset),
        );
        const center = wallMaterialCenter(wall, { start, end });
        return (
          <path
            key={window.id}
            {...paint("window", window.id)}
            data-window={window.id}
            vectorEffect="non-scaling-stroke"
            className={
              "cad-window" +
              (isSelected(selection, { kind: "window", id: window.id })
                ? " is-selected"
                : "")
            }
            d={
              ring(wallMaterialFootprint(wall, { start, end })) +
              " M" +
              pair(center.start) +
              "L" +
              pair(center.end)
            }
          />
        );
      })}
      {plan.sketches?.map(({ id, geometry }) => (
        <path
          key={id}
          {...paint("sketch", id)}
          data-sketch={id}
          data-kind={geometry.kind}
          className="cad-sketch"
          data-selected={isSelected(selection, { kind: "sketch", id })}
          d={sketchPath(geometry)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {drivingDimensions(plan.walls, plan.constraints).map((c) => {
        const { start, end } = c;
        return (
          <g
            key={c.id}
            className="cad-dimension cad-driving"
            data-driving={c.id}
          >
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={start.x} cy={start.y} r={3 / scale} />
            <circle cx={end.x} cy={end.y} r={3 / scale} />
            <text
              transform={`translate(${(start.x + end.x) / 2} ${(start.y + end.y) / 2}) scale(${1 / scale})`}
              textAnchor="middle"
              y="-11"
            >
              {Number((c.distanceMm / unitFactor(unit)).toFixed(2))} {unit}
            </text>
          </g>
        );
      })}
      {plan.annotations?.map(({ id, start, end }) => (
        <g
          key={id}
          {...paint("dimension", id)}
          data-dimension={id}
          className={
            "cad-dimension" +
            (isSelected(selection, { kind: "dimension", id })
              ? " is-selected"
              : "")
          }
        >
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            vectorEffect="non-scaling-stroke"
          />
          {[start, end].map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r={3 / scale} />
          ))}
          <text
            transform={`translate(${(start.x + end.x) / 2} ${(start.y + end.y) / 2}) scale(${1 / scale})`}
            textAnchor="middle"
            y="-7"
          >
            {new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(
              wallLength({ start, end }) / unitFactor(unit),
            )}{" "}
            {unit}
          </text>
        </g>
      ))}
      {plan.utilities.map((marker) => {
        const template = utilityCatalog[marker.template];
        if (!layers[template.layer]) return null;
        const active = isSelected(selection, {
          kind: "utility",
          id: marker.id,
        });
        return (
          <g
            key={marker.id}
            {...paint("utility", marker.id)}
            data-utility={marker.id}
            data-layer={template.layer}
            className={"cad-utility" + (active ? " is-selected" : "")}
            transform={`translate(${marker.position.x} ${marker.position.y}) scale(${1 / scale})`}
          >
            <title>{template.label}</title>
            {template.layer === "electrical" ? (
              <rect x="-9" y="-9" width="18" height="18" rx="2" />
            ) : (
              <circle r="9" />
            )}
            <text y=".5">{template.glyph}</text>
          </g>
        );
      })}
    </>
  );
}

export function DrawingGrid({
  step,
  x,
  y,
  isometric,
}: {
  step: number;
  x: number;
  y: number;
  isometric: boolean;
}) {
  const id = useId();
  if (isometric) return null;
  const major = step * 5;
  return (
    <>
      <defs>
        <pattern
          id={id + "-minor"}
          width={step}
          height={step}
          patternUnits="userSpaceOnUse"
        >
          <path d={`M${step} 0H0V${step}`} className="cad-grid-line" />
        </pattern>
        <pattern
          id={id}
          x={x % major}
          y={y % major}
          width={major}
          height={major}
          patternUnits="userSpaceOnUse"
        >
          <rect width={major} height={major} fill={`url(#${id}-minor)`} />
          <path d={`M${major} 0H0V${major}`} className="cad-grid-major" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <path className="cad-axis" d={`M0 ${y}H100000M${x} 0V100000`} />
    </>
  );
}
