import { sketchPath } from "@/lib/plans/sketch";
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

export function ReferenceDrawing({
  plan,
  storeyId,
}: {
  plan: DraftPlanState;
  storeyId: string;
}) {
  return (plan.drawingReferences ?? [])
    .filter((item) => item.storeyId === storeyId && item.visible)
    .map((reference) => {
      const layers = new Map(
        reference.layers.map((layer) => [layer.name, layer]),
      );
      return (
        <g
          key={reference.id}
          data-drawing-reference={reference.id}
          data-source-version={reference.version}
          transform={`translate(${reference.offset.x} ${reference.offset.y})`}
          pointerEvents="none"
          aria-hidden="true"
          opacity="0.66"
        >
          {reference.shapes.map(({ layer: name, geometry }, index) => {
            const layer = layers.get(name);
            const ink = layer?.color.toLowerCase();
            return (
              <path
                key={index}
                d={sketchPath(geometry)}
                stroke={ink && ink !== "#ffffff" ? ink : "#387572"}
                fill="none"
                strokeDasharray={
                  layer?.lineStyle === "dotted"
                    ? "2 3"
                    : layer?.lineStyle === "dashed"
                      ? "6 4"
                      : undefined
                }
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      );
    });
}
