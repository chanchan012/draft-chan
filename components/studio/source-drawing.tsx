import type { DraftPlanState } from "@/lib/plans/model";
import { underlayTransform } from "@/lib/plans/underlays";

export function UnderlayDrawing({
  plan,
  storeyId,
}: {
  plan: DraftPlanState;
  storeyId: string;
}) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      {plan.underlays
        ?.filter((item) => item.storeyId === storeyId && item.visible)
        .map((item) => {
          const { cosine, sine, x, y } = underlayTransform(item.calibration);
          return (
            <image
              key={item.id}
              data-underlay={item.id}
              href={item.raster}
              width={item.width}
              height={item.height}
              opacity={item.opacity}
              transform={`matrix(${cosine} ${sine} ${-sine} ${cosine} ${x} ${y})`}
            />
          );
        })}
    </g>
  );
}
