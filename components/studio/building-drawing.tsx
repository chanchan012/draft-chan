"use client";

import { useMemo } from "react";
import { deriveBuildingView } from "@/lib/plans/building-views";
import {
  elementsOnStorey,
  roofProfile,
  slabPolygons,
  stairFootprint,
  stairSteps,
  storeyVoids,
} from "@/lib/plans/building";
import { bounds } from "@/lib/plans/footprints";
import type { BuildingView, DraftPlanState, Point } from "@/lib/plans/model";

const path = (points: Point[]) =>
  points.length
    ? "M " + points.map(({ x, y }) => x + " " + y).join(" L ") + " Z"
    : "";

export function BuildingPlanDrawing({
  plan,
  storeyId,
}: {
  plan: DraftPlanState;
  storeyId: string;
}) {
  const items = useMemo(
    () => elementsOnStorey(plan, storeyId),
    [plan, storeyId],
  );
  const holes = useMemo(() => storeyVoids(plan, storeyId), [plan, storeyId]);
  if (!items.length && !plan.buildingViews?.length) return null;
  return (
    <g className="cad-building-plan" aria-hidden="true" pointerEvents="none">
      {items.map((item) => {
        if (item.kind === "slab")
          return (
            <path
              key={item.id}
              data-slab={item.id}
              className="cad-slab-plan"
              d={slabPolygons(plan, item).flat().map(path).join(" ")}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
            />
          );
        if (item.kind === "roof") {
          const profile = roofProfile(plan, item);
          return (
            <g key={item.id} data-roof={item.id}>
              <path
                className="cad-roof-plan"
                d={path(item.footprint)}
                vectorEffect="non-scaling-stroke"
              />
              {profile.ridgePoints.length === 2 && (
                <line
                  className="cad-roof-plan"
                  x1={profile.ridgePoints[0].x}
                  y1={profile.ridgePoints[0].y}
                  x2={profile.ridgePoints[1].x}
                  y2={profile.ridgePoints[1].y}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        }
        if (item.kind === "stair" && item.fromStoreyId === storeyId)
          return (
            <g key={item.id} data-stair={item.id}>
              <path
                className="cad-stair-plan"
                d={path(stairFootprint(item))}
                vectorEffect="non-scaling-stroke"
              />
              {stairSteps(plan, item)
                .slice(1)
                .map(({ footprint }, index) => (
                  <line
                    className="cad-stair-plan"
                    key={index}
                    x1={footprint[0].x}
                    y1={footprint[0].y}
                    x2={footprint[3].x}
                    y2={footprint[3].y}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            </g>
          );
        return null;
      })}
      {holes.map((hole, index) => (
        <path
          key={hole.id + ":" + index}
          data-floor-opening={hole.id}
          className="cad-opening-plan"
          d={path(hole.footprint)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {plan.buildingViews?.map(
        (view) =>
          view.kind === "section" && (
            <line
              key={view.id}
              data-section-cut={view.id}
              className="cad-section-cut"
              x1={view.start.x}
              y1={view.start.y}
              x2={view.end.x}
              y2={view.end.y}
              vectorEffect="non-scaling-stroke"
            />
          ),
      )}
    </g>
  );
}

export function BuildingViewDrawing({
  building,
  view,
}: {
  building: DraftPlanState;
  view: BuildingView;
}) {
  const geometry = useMemo(
    () => deriveBuildingView(building, view),
    [building, view],
  );
  const points = geometry.surfaces.flatMap((surface) =>
    surface.polygon.map((point) => ({ x: point.x, y: -point.y })),
  );
  const { left, right, top, bottom } = points.length
    ? bounds(points)
    : { left: 0, right: geometry.cutLengthMm ?? 2400, top: -2400, bottom: 0 };
  const width = Math.max(right - left, 1200);
  const height = Math.max(bottom - top, 1200);
  const pad = Math.max(width, height) * 0.12;
  const font = Math.max(75, Math.min(260, width / 43));
  const bottomWithDatums = Math.max(
    bottom,
    ...geometry.storeys.map((level) => -level.elevationMm),
  );
  const topWithDatums = Math.min(
    top,
    ...geometry.storeys.map((level) => -level.elevationMm),
  );
  const labelRail = Math.max(
    pad,
    ...geometry.storeys.map((level) => (level.name.length + 12) * font * 0.6),
  );
  return (
    <div className="studio-building-view">
      <div className="studio-building-view-label">
        <strong>{view.name}</strong>
        <span>
          {view.kind === "section" ? "Section" : view.direction + " elevation"}
        </span>
      </div>
      <svg
        className="studio-building-view-canvas"
        role="img"
        aria-label={view.name}
        data-building-view={view.id}
        viewBox={[
          left - pad,
          topWithDatums - pad,
          width + pad * 2 + labelRail,
          Math.max(height, bottomWithDatums - topWithDatums) + 2 * pad,
        ].join(" ")}
      >
        <g>
          {geometry.surfaces.map((surface, i) => (
            <path
              key={surface.id + ":" + i}
              data-surface-kind={surface.kind}
              data-building-source={surface.id}
              className={"cad-building-surface cad-building-" + surface.kind}
              vectorEffect="non-scaling-stroke"
              d={path(
                surface.polygon.map((point) => ({ x: point.x, y: -point.y })),
              )}
            />
          ))}
        </g>
        {geometry.storeys.map((level) => (
          <g
            key={level.id}
            className="cad-building-datum"
            data-level-datum={level.id}
          >
            <line
              x1={left - pad * 0.32}
              y1={-level.elevationMm}
              x2={right + pad * 0.55}
              y2={-level.elevationMm}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={right + pad * 0.63}
              y={-level.elevationMm - font * 0.2}
              fontSize={font}
            >
              <tspan>{level.name}</tspan>
              <tspan x={right + pad * 0.63} dy={font * 1.2}>
                {level.elevationMm} mm
              </tspan>
            </text>
          </g>
        ))}
      </svg>
      {!geometry.surfaces.length && (
        <p className="studio-building-view-empty">
          {view.kind === "section"
            ? "No building elements cross this cut."
            : "Add walls or building elements to see an elevation."}
        </p>
      )}
    </div>
  );
}
