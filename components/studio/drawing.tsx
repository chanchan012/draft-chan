import { useId } from "react";
import {
  fixtureCatalog,
  utilityCatalog,
  type UtilityLayer,
} from "@/lib/plans/catalog";
import { fixtureFootprint, wallFootprint } from "@/lib/plans/footprints";
import type { ClearanceIssue } from "@/lib/plans/clearance";
import { projectIso, unitFactor, wallHeight } from "@/lib/plans/cad";
import {
  doorBounds,
  doorSwing,
  pointAlong,
  wallLength,
  wallRuns,
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
export type { Selection } from "@/lib/plans/editor-selection";
export type WallPreview = { start: Point; end: Point };
const pair = ({ x, y }: Point) => `${x},${y}`;
const ring = (points: Point[]) => "M" + points.map(pair).join(" ") + "Z";

function DoorShape({
  wall,
  door,
  active,
}: {
  wall: Wall;
  door: Door;
  active: boolean;
}) {
  const { hinge, closed, leaf, clockwise } = doorSwing(wall, door);
  return (
    <g
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
}: {
  fixture: Fixture;
  active: boolean;
}) {
  const { position, widthMm, depthMm, rotation, template } = fixture;
  const x = -widthMm / 2,
    y = -depthMm / 2;
  const isSeat = template === "sofa" || template === "chair";
  const hasBasin = template === "vanity" || template === "kitchenSink";
  return (
    <g
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
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const openings = [...plan.openings, ...(plan.windows ?? [])];
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
      {plan.walls.map((wall) => (
        <g
          key={wall.id}
          data-wall={wall.id}
          className={
            "cad-wall" +
            (wall.kind === "exterior" ? " is-exterior" : "") +
            (isSelected(selection, { kind: "wall", id: wall.id })
              ? " is-selected"
              : "")
          }
        >
          {wallRuns(wall, openings).map(({ start, end }, i) => (
            <line
              key={i}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              strokeWidth={wall.thicknessMm}
            />
          ))}
        </g>
      ))}
      {plan.fixtures.map((fixture) => (
        <FixtureShape
          key={fixture.id}
          fixture={fixture}
          active={isSelected(selection, { kind: "fixture", id: fixture.id })}
        />
      ))}
      {plan.openings.map((door) => (
        <DoorShape
          key={door.id}
          door={door}
          wall={walls.get(door.wallId)!}
          active={isSelected(selection, { kind: "door", id: door.id })}
        />
      ))}
      {plan.windows?.map((window) => {
        const wall = walls.get(window.wallId)!;
        const [start, end] = doorBounds(window).map((offset) =>
          pointAlong(wall, offset),
        );
        return (
          <path
            key={window.id}
            data-window={window.id}
            vectorEffect="non-scaling-stroke"
            className={
              "cad-window" +
              (isSelected(selection, { kind: "window", id: window.id })
                ? " is-selected"
                : "")
            }
            d={
              ring(wallFootprint(start, end, wall.thicknessMm)) +
              " M" +
              pair(start) +
              "L" +
              pair(end)
            }
          />
        );
      })}
      {plan.annotations?.map(({ id, start, end }) => (
        <g
          key={id}
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

function Prism({
  footprint,
  height,
  fixture,
  elevation = 0,
  window,
}: {
  footprint: Point[];
  height: number;
  fixture?: string;
  elevation?: number;
  window?: string;
}) {
  const bottom = footprint.map((p) => projectIso(p, elevation));
  const top = footprint.map((p) => projectIso(p, elevation + height));
  return (
    <g
      className={
        "cad-prism" +
        (fixture ? " cad-iso-fixture" : window ? " cad-iso-window" : "")
      }
      data-iso-fixture={fixture}
      data-iso-window={window}
    >
      {bottom.map((p, i) => {
        const j = (i + 1) % 4;
        if (bottom[j].x <= p.x) return null;
        return (
          <path
            key={i}
            className={i % 2 ? "cad-cap" : "cad-face"}
            vectorEffect="non-scaling-stroke"
            d={ring([p, bottom[j], top[j], top[i]])}
          />
        );
      })}
      <path
        className="cad-top"
        vectorEffect="non-scaling-stroke"
        d={ring(top)}
      />
    </g>
  );
}

export function IsometricDrawing({ plan }: { plan: DraftPlanState }) {
  const openings = [...plan.openings, ...(plan.windows ?? [])];
  const runs: {
    footprint: Point[];
    height: number;
    id: string;
    depth: number;
    fixture?: string;
    elevation?: number;
    window?: string;
  }[] = plan.walls.flatMap((wall) =>
    wallRuns(wall, openings).map(({ start, end }, i) => ({
      footprint: wallFootprint(start, end, wall.thicknessMm),
      height: wallHeight,
      id: wall.id + ":" + i,
      depth: (start.x + start.y + end.x + end.y) / 2,
    })),
  );
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  for (const window of plan.windows ?? []) {
    const wall = walls.get(window.wallId)!;
    const [start, end] = doorBounds(window).map((offset) =>
      pointAlong(wall, offset),
    );
    const depth = (start.x + start.y + end.x + end.y) / 2;
    const footprint = wallFootprint(start, end, wall.thicknessMm);
    const lintel = window.sillMm + window.heightMm;
    if (window.sillMm)
      runs.push({
        id: "sill:" + window.id,
        footprint,
        depth,
        height: window.sillMm,
      });
    if (lintel < wallHeight)
      runs.push({
        id: "lintel:" + window.id,
        footprint,
        depth,
        elevation: lintel,
        height: wallHeight - lintel,
      });
    runs.push({
      id: "glass:" + window.id,
      window: window.id,
      depth,
      footprint: wallFootprint(start, end, Math.min(14, wall.thicknessMm)),
      elevation: window.sillMm,
      height: window.heightMm,
    });
  }
  for (const fixture of plan.fixtures) {
    runs.push({
      footprint: fixtureFootprint(fixture),
      height: fixture.heightMm,
      id: "fixture:" + fixture.id,
      depth: fixture.position.x + fixture.position.y,
      fixture: fixture.id,
    });
  }
  runs.sort((a, b) => a.depth - b.depth);
  return (
    <g data-view="isometric">
      {plan.rooms.map((room) => (
        <path
          key={room.id}
          className="cad-iso-floor"
          vectorEffect="non-scaling-stroke"
          fillRule="evenodd"
          d={[room.polygon, ...(room.holes ?? [])]
            .map((boundary) => ring(boundary.map((p) => projectIso(p))))
            .join(" ")}
        />
      ))}
      {runs.map(({ id, footprint, height, fixture, elevation, window }) => (
        <Prism
          key={id}
          footprint={footprint}
          height={height}
          fixture={fixture}
          elevation={elevation}
          window={window}
        />
      ))}
    </g>
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
