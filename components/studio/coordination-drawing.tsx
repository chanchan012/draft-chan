import { routePoints } from "@/lib/plans/coordination";
import { egressPoints } from "@/lib/plans/review-rules";
import { planStoreys } from "@/lib/plans/storeys";
import type { CoordinationFinding, DraftPlanState } from "@/lib/plans/model";
import type { UtilityLayer } from "@/lib/plans/catalog";

export function CoordinationDrawing({
  plan,
  storeyId,
  scale,
  layers,
  finding,
  zones,
}: {
  plan: DraftPlanState;
  storeyId: string;
  scale: number;
  layers: Record<UtilityLayer, boolean>;
  finding?: CoordinationFinding;
  zones: boolean;
}) {
  const items = plan.coordination ?? [];
  const elevation = planStoreys(plan).find(
    (storey) => storey.id === storeyId,
  )?.elevationMm;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {items.map((item) => {
        if (item.kind === "egress" && zones && item.storeyId === storeyId)
          return (
            <polyline
              key={item.id}
              data-egress-path={item.id}
              className="cad-egress-path"
              points={egressPoints(plan, item)
                .map(({ x, y }) => x + "," + y)
                .join(" ")}
              vectorEffect="non-scaling-stroke"
            />
          );
        if (item.kind === "zone" && zones && item.storeyId === storeyId)
          return (
            <polygon
              key={item.id}
              data-equipment-zone={item.id}
              className="cad-equipment-zone"
              points={item.polygon.map(({ x, y }) => x + "," + y).join(" ")}
              vectorEffect="non-scaling-stroke"
            />
          );
        if (item.kind !== "route" || !layers[item.system]) return null;
        const points = routePoints(plan, item);
        const ownedByStorey =
          item.storeyId === storeyId || points.some(({ z }) => z === elevation);
        if (!ownedByStorey) return null;
        const color = item.system === "plumbing" ? "#18778a" : "#a65a18";
        return (
          <g
            key={item.id}
            data-service-route={item.id}
            stroke={color}
            fill="none"
          >
            <polyline
              points={points.map(({ x, y }) => x + "," + y).join(" ")}
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {points.map(({ x, y }, i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={3 / scale}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                fill="white"
              />
            ))}
          </g>
        );
      })}
      {finding?.storeyId === storeyId && (
        <g
          data-coordination-finding={finding.rule}
          className="cad-coordination-finding"
        >
          {finding.outline && (
            <polygon
              points={finding.outline.map(({ x, y }) => x + "," + y).join(" ")}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <circle
            cx={finding.point.x}
            cy={finding.point.y}
            r={9 / scale}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={finding.point.x}
            cy={finding.point.y}
            r={3 / scale}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </g>
  );
}

export function coordinationExtent(plan: DraftPlanState, storeyId: string) {
  return (plan.coordination ?? []).flatMap((item) => {
    if (item.kind === "zone" && item.storeyId === storeyId) return item.polygon;
    if (item.kind === "route" && item.storeyId === storeyId)
      return routePoints(plan, item);
    if (item.kind === "egress" && item.storeyId === storeyId)
      return egressPoints(plan, item);
    return [];
  });
}
