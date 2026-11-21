import { useId, useMemo } from "react";
import { paperTitleBlock } from "@/lib/plans/sheet-title";
import type { DraftPlanState, Sheet } from "@/lib/plans/model";
import {
  documentMarks,
  paperDrawing,
  type DrawingPrimitive,
} from "@/lib/plans/sheet-drawing";

function Primitives({
  items,
  factor = 1,
}: {
  items: DrawingPrimitive[];
  factor?: number;
}) {
  return items.map((item, i) =>
    item.kind === "path" ? (
      <path
        key={i}
        data-source={item.source}
        d={
          item.points
            .map(({ x, y }, j) => `${j ? "L" : "M"} ${x} ${y}`)
            .join(" ") + (item.closed ? " Z" : "")
        }
        fill={item.fill ?? "none"}
        stroke="currentColor"
        strokeWidth={item.weight * factor}
        strokeDasharray={item.dash?.map((n) => n * factor).join(" ")}
        strokeLinejoin="round"
      />
    ) : (
      <text
        key={i}
        x={item.at.x}
        y={item.at.y}
        textAnchor={item.align}
        fontSize={item.size * factor}
        fill="currentColor"
      >
        {item.text}
      </text>
    ),
  );
}

export function PlanMarks({
  plan,
  storeyId,
  cameraScale,
}: {
  plan: DraftPlanState;
  storeyId: string;
  cameraScale: number;
}) {
  const factor = 3 / cameraScale;
  const { primitives } = useMemo(
    () => documentMarks(plan, storeyId, factor),
    [plan, storeyId, factor],
  );
  return (
    <g className="cad-document-marks" pointerEvents="none">
      <Primitives items={primitives} factor={factor} />
    </g>
  );
}

export function SheetDrawing({
  plan,
  sheet,
  project,
  revisionLabel,
}: {
  plan: DraftPlanState;
  sheet: Sheet;
  project: string;
  revisionLabel: string;
}) {
  const prefix = useId();
  const { width, height, panels } = useMemo(
    () => paperDrawing(plan, sheet),
    [plan, sheet],
  );
  const titleBlock = paperTitleBlock(sheet, project, revisionLabel);
  return (
    <div className="studio-paper-stage">
      <svg
        role="img"
        aria-label={sheet.number + " " + sheet.name}
        viewBox={`0 0 ${width} ${height}`}
        className="studio-paper"
      >
        <title>
          {sheet.number} {sheet.name}
        </title>
        <rect x="0" y="0" width={width} height={height} fill="white" />
        {panels.map(({ viewport, name, primitives }, i) => {
          const clip = prefix + "-" + i;
          const { x, y, width, height } = viewport;
          return (
            <g key={viewport.id} data-sheet-viewport={viewport.id}>
              <clipPath id={clip}>
                <rect {...{ x, y, width, height }} />
              </clipPath>
              <rect
                {...{ x, y, width, height }}
                fill="none"
                stroke="#bcc6c0"
                strokeWidth="0.22"
              />
              <g clipPath={`url(#${clip})`}>
                <Primitives items={primitives} />
              </g>
              <text
                x={x + 2}
                y={y + height - 2}
                fontSize="3"
                fill="currentColor"
                paintOrder="stroke"
                stroke="white"
                strokeWidth="0.75"
              >
                {name} · 1:{viewport.scale}
              </text>
            </g>
          );
        })}
        <clipPath id={prefix + "-title"}>
          <rect x={6} y={height - 24} width={width - 49} height={18} />
        </clipPath>
        <g clipPath={`url(#${prefix}-title)`}>
          <Primitives
            items={titleBlock.filter(
              (item) => item.kind === "text" && item.align !== "end",
            )}
          />
        </g>
        <Primitives
          items={titleBlock.filter(
            (item) => item.kind !== "text" || item.align === "end",
          )}
        />
      </svg>
    </div>
  );
}
