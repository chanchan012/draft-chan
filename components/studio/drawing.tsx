import { useId } from "react";
import { projectIso, wallHeight } from "@/lib/plans/cad";
import { doorSwing, wallRuns } from "@/lib/plans/openings";
import type { Door, DraftPlanState, Point, Wall } from "@/lib/plans/model";

export type Selection = { kind: "wall" | "door"; id: string };
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

export function PlanDrawing({
  plan,
  selection,
}: {
  plan: DraftPlanState;
  selection: Selection | null;
}) {
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
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
            (selection?.kind === "wall" && selection.id === wall.id
              ? " is-selected"
              : "")
          }
        >
          {wallRuns(wall, plan.openings).map(({ start, end }, i) => (
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
      {plan.openings.map((door) => (
        <DoorShape
          key={door.id}
          door={door}
          wall={walls.get(door.wallId)!}
          active={selection?.kind === "door" && selection.id === door.id}
        />
      ))}
    </>
  );
}

function Prism({
  start,
  end,
  thickness,
}: {
  start: Point;
  end: Point;
  thickness: number;
}) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const nx = ((start.y - end.y) * thickness) / (2 * length);
  const ny = ((end.x - start.x) * thickness) / (2 * length);
  const footprint = [
    { x: start.x - nx, y: start.y - ny },
    { x: end.x - nx, y: end.y - ny },
    { x: end.x + nx, y: end.y + ny },
    { x: start.x + nx, y: start.y + ny },
  ];
  const bottom = footprint.map((p) => projectIso(p));
  const top = footprint.map((p) => projectIso(p, wallHeight));
  return (
    <g className="cad-prism">
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
  const runs = plan.walls.flatMap((wall) =>
    wallRuns(wall, plan.openings).map((run, i) => ({
      ...run,
      thickness: wall.thicknessMm,
      id: wall.id + ":" + i,
    })),
  );
  runs.sort(
    (a, b) =>
      a.start.x +
      a.start.y +
      a.end.x +
      a.end.y -
      b.start.x -
      b.start.y -
      b.end.x -
      b.end.y,
  );
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
      {runs.map(({ id, ...run }) => (
        <Prism key={id} {...run} />
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
