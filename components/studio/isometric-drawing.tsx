import polygonClipping from "polygon-clipping";
import {
  elementsOnStorey,
  lerpPoint,
  roofProfile,
  slabPolygons,
  stairSteps,
  storeyVoids,
} from "@/lib/plans/building";
import { clipPolygon, drawingPolygons } from "@/lib/plans/clipping";
import { storeyById } from "@/lib/plans/storeys";
import { memo, useId, useMemo } from "react";
import { projectIso } from "@/lib/plans/cad";
import { fixtureCatalog } from "@/lib/plans/catalog";
import { fixtureFootprint } from "@/lib/plans/footprints";
import { buildIsometric, slabDepth } from "@/lib/plans/isometric";
import type { DraftPlanState, Fixture, Point } from "@/lib/plans/model";
import { inRoom, signedAreaMm2 } from "@/lib/plans/polygon";

const pair = ({ x, y }: Point) => `${x},${y}`;
const ring = (points: readonly Point[]) => `M${points.map(pair).join(" ")}Z`;
const outline = (rings: readonly Point[][], z = 0) =>
  rings
    .map((boundary) => ring(boundary.map((point) => projectIso(point, z))))
    .join(" ");

function Prism({
  rings,
  height,
  base = 0,
  material,
}: {
  rings: Point[][];
  height: number;
  base?: number;
  material: string;
}) {
  const sides = rings.map((boundary, index) =>
    signedAreaMm2(boundary) > 0 === (index === 0)
      ? boundary
      : boundary.slice().reverse(),
  );
  const top = base + height;
  return (
    <g className={`cad-prism ${material}`}>
      {sides.flatMap((boundary, ri) =>
        boundary.map((a, i) => {
          const b = boundary[(i + 1) % boundary.length];
          const p = projectIso(a, base);
          const q = projectIso(b, base);
          if (q.x <= p.x) return null;
          return (
            <path
              key={`${ri}:${i}`}
              className={q.y >= p.y ? "cad-face" : "cad-cap"}
              vectorEffect="non-scaling-stroke"
              d={ring([p, q, projectIso(b, top), projectIso(a, top)])}
            />
          );
        }),
      )}
      <path
        className="cad-top"
        vectorEffect="non-scaling-stroke"
        fillRule="evenodd"
        d={outline(rings, top)}
      />
    </g>
  );
}

function Furnishing({ fixture }: { fixture: Fixture }) {
  const corners = fixtureFootprint(fixture);
  const [origin, across, , down] = corners;
  const h = fixture.heightMm;
  const { template } = fixture;
  const at = (x: number, y: number) => ({
    x: origin.x + (across.x - origin.x) * x + (down.x - origin.x) * y,
    y: origin.y + (across.y - origin.y) * x + (down.y - origin.y) * y,
  });
  const box = (
    x: number,
    y: number,
    w: number,
    d: number,
    bottom: number,
    top: number,
    material = "iso-wood",
  ) => (
    <Prism
      rings={[[at(x, y), at(x + w, y), at(x + w, y + d), at(x, y + d)]]}
      base={h * bottom}
      height={h * (top - bottom)}
      material={material}
    />
  );
  const oval = (x: number, y: number, w: number, d: number, z: number) =>
    ring(
      Array.from({ length: 20 }, (_, index) => {
        const angle = (index * Math.PI) / 10;
        return projectIso(
          at(x + (w * Math.cos(angle)) / 2, y + (d * Math.sin(angle)) / 2),
          h * z,
        );
      }),
    );
  let shape;
  switch (template) {
    case "queenBed":
      shape = (
        <>
          {box(0, 0, 1, 1, 0, 0.31)}
          {box(0.03, 0.025, 0.94, 0.95, 0.31, 0.87, "iso-linen")}
          {box(0.045, 0.35, 0.91, 0.6, 0.87, 0.91, "iso-sage")}
          {box(0.09, 0.09, 0.36, 0.19, 0.87, 0.98, "iso-linen")}
          {box(0.55, 0.09, 0.36, 0.19, 0.87, 0.98, "iso-linen")}
          {box(0, 0, 1, 0.035, 0.24, 1, "iso-wood")}
        </>
      );
      break;
    case "sofa":
    case "chair":
      shape = (
        <>
          {box(0, 0, 1, 1, 0.1, 0.48, "iso-clay")}
          {box(0.09, 0.23, 0.82, 0.72, 0.48, 0.6, "iso-clay-light")}
          {box(0, 0, 1, 0.23, 0.48, 1, "iso-clay")}
          {template === "sofa" && (
            <>
              {box(0, 0.23, 0.09, 0.77, 0.48, 0.76, "iso-clay")}
              {box(0.91, 0.23, 0.09, 0.77, 0.48, 0.76, "iso-clay")}
              <path
                className="cad-iso-seam"
                vectorEffect="non-scaling-stroke"
                d={`M${pair(projectIso(at(0.5, 0.25), h * 0.6))}L${pair(projectIso(at(0.5, 0.93), h * 0.6))}`}
              />
            </>
          )}
        </>
      );
      break;
    case "coffeeTable":
    case "diningTable":
    case "desk":
      shape = (
        <>
          {[
            [0.8, 0.09],
            [0.09, 0.09],
            [0.8, 0.8],
            [0.09, 0.8],
          ].map(([x, y], i) => (
            <g key={i}>{box(x, y, 0.11, 0.11, 0, 0.89)}</g>
          ))}
          {box(0, 0, 1, 1, 0.87, 1)}
        </>
      );
      break;
    case "kitchenSink":
    case "vanity":
    case "toilet":
    case "shower":
      shape = (
        <>
          {box(0, 0, 1, 1, 0, template === "toilet" ? 0.66 : 1, "iso-stone")}
          {template === "toilet" &&
            box(0.04, 0, 0.92, 0.27, 0.66, 1, "iso-stone")}
          <path
            className="cad-iso-basin"
            vectorEffect="non-scaling-stroke"
            d={
              template === "shower"
                ? oval(0.5, 0.5, 0.13, 0.13, 1)
                : template === "toilet"
                  ? oval(0.5, 0.63, 0.66, 0.55, 0.66)
                  : oval(0.5, 0.52, 0.71, 0.58, 1)
            }
          />
        </>
      );
      break;
    default:
      shape = <Prism rings={[corners]} height={h} material="iso-cabinet" />;
  }
  return (
    <g data-iso-fixture={fixture.id} data-template={template}>
      <title>{fixtureCatalog[template].label}</title>
      {shape}
    </g>
  );
}

type Pane = ReturnType<typeof buildIsometric>["windows"][number];
function WindowPane({ start, end, base, height, id }: Pane) {
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const top = base + height;
  return (
    <g data-iso-window={id} className="cad-iso-window">
      <path
        className="cad-iso-glass"
        vectorEffect="non-scaling-stroke"
        d={ring([
          projectIso(start, base),
          projectIso(end, base),
          projectIso(end, top),
          projectIso(start, top),
        ])}
      />
      {height > 240 && (
        <path
          className="cad-iso-mullion"
          vectorEffect="non-scaling-stroke"
          d={`M${pair(projectIso(center, base))}L${pair(projectIso(center, top))}`}
        />
      )}
    </g>
  );
}

const stage = (role: string) =>
  role === "rear" ? 0 : role === "front" ? 2 : 1;
function depth(points: readonly Point[]) {
  let near = -Infinity;
  let far = Infinity;
  for (const { x, y } of points) {
    near = Math.max(near, x + y);
    far = Math.min(far, x + y);
  }
  return (near + far) / 2;
}

export const IsometricDrawing = memo(function IsometricDrawing({
  plan,
  heightMm,
  storeyId = "ground",
}: {
  plan: DraftPlanState;
  heightMm?: number;
  storeyId?: string;
}) {
  const { walls, rooms, openings, windows, fixtures } = plan;
  const model = useMemo(
    () => buildIsometric({ walls, rooms, openings, windows }, heightMm),
    [walls, rooms, openings, windows, heightMm],
  );
  const structure = useMemo(() => {
    const level = storeyById(plan, storeyId);
    const items = elementsOnStorey(plan, storeyId);
    const slabs = items.flatMap((item) =>
      item.kind === "slab"
        ? slabPolygons(plan, item).map((rings) => ({
            rings,
            base: item.offsetMm - item.thicknessMm,
            height: item.thicknessMm,
          }))
        : [],
    );
    const cutouts = storeyVoids(plan, storeyId).map((hole) =>
      clipPolygon([hole.footprint]),
    );
    const floor = model.rooms.map((rings) =>
      cutouts.length
        ? drawingPolygons(
            polygonClipping.difference(clipPolygon(rings), ...cutouts),
          )
        : [rings],
    );
    const stairs = items.flatMap((item) =>
      item.kind === "stair" && item.fromStoreyId === storeyId
        ? stairSteps(plan, item).map((step, index) => ({
            key: item.id + ":" + index,
            rings: [step.footprint],
            base: step.baseMm - level.elevationMm,
            height: step.topMm - step.baseMm,
          }))
        : [],
    );
    const roofs = items.flatMap((item) => {
      if (item.kind !== "roof") return [];
      const profile = roofProfile(plan, item);
      const project = (point: Point) =>
        projectIso(point, profile.height(point) - level.elevationMm);
      const points = item.footprint.flatMap((point, i) => {
        const next = item.footprint[(i + 1) % item.footprint.length];
        const a = profile.coordinate(point);
        const b = profile.coordinate(next);
        const t = (profile.ridge - a) / (b - a);
        return item.profile === "gable" && t > 0 && t < 1
          ? [project(point), project(lerpPoint(point, next, t))]
          : [project(point)];
      });
      return [{ id: item.id, points, ridge: profile.ridgePoints.map(project) }];
    });
    return {
      slabs,
      floor,
      stairs,
      roofs,
      hasSlab: items.some((item) => item.kind === "slab"),
    };
  }, [plan, model.rooms, storeyId]);
  const grain = useId();
  const scene = [
    ...model.walls.map(({ rings, role, base, height }, i) => ({
      key: `wall:${i}`,
      stage: stage(role),
      depth: depth(rings[0]),
      order: base,
      item: (
        <g data-iso-wall={role}>
          <Prism
            rings={rings}
            height={height}
            base={base}
            material={`iso-wall iso-wall-${role}`}
          />
        </g>
      ),
    })),
    ...model.windows.map((window) => ({
      key: `window:${window.id}`,
      stage: stage(window.role),
      depth: depth([window.start, window.end]),
      order: window.base,
      item: <WindowPane {...window} />,
    })),
    ...structure.stairs.map(({ key, rings, height, base }) => ({
      key,
      stage: 1,
      depth: depth(rings[0]),
      order: base,
      item: (
        <g data-iso-stair>
          <Prism
            rings={rings}
            height={height}
            base={base}
            material="iso-slab"
          />
        </g>
      ),
    })),
    ...fixtures.map((fixture) => ({
      key: `fixture:${fixture.id}`,
      stage: 1,
      depth: fixture.position.x + fixture.position.y,
      order: 0,
      item: <Furnishing fixture={fixture} />,
    })),
  ].sort((a, b) => a.stage - b.stage || a.depth - b.depth || a.order - b.order);
  return (
    <g data-view="isometric">
      <defs>
        <pattern
          id={grain}
          width="1200"
          height="400"
          patternUnits="userSpaceOnUse"
          patternTransform="matrix(0.866 0.5 -0.866 0.5 0 0)"
        >
          <path
            className="cad-iso-floor-grain"
            d="M0 0H1200M0 200H1200M580 0V200M1150 200V400"
          />
        </pattern>
      </defs>
      {(structure.hasSlab
        ? structure.slabs
        : model.slab.map((rings) => ({
            rings,
            base: -slabDepth,
            height: slabDepth,
          }))
      ).map(({ rings, base, height }, index) => (
        <g key={index} data-iso-slab>
          <path
            className="cad-iso-shadow"
            fillRule="evenodd"
            d={outline(rings, base)}
          />
          <Prism
            rings={rings}
            base={base}
            height={height}
            material="iso-slab"
          />
        </g>
      ))}
      {structure.floor.map((parts, index) => {
        const bath = fixtures.some(
          (fixture) =>
            fixtureCatalog[fixture.template].group === "Bath" &&
            inRoom(rooms[index], fixture.position),
        );
        const path = parts.map((part) => outline(part)).join(" ");
        return (
          <g
            key={rooms[index].id}
            className={bath ? "cad-iso-room iso-wet-room" : "cad-iso-room"}
          >
            <path className="cad-iso-floor" fillRule="evenodd" d={path} />
            {!bath && (
              <path fill={`url(#${grain})`} fillRule="evenodd" d={path} />
            )}
          </g>
        );
      })}
      {scene.map(({ key, item }) => (
        <g key={key}>{item}</g>
      ))}
      {structure.roofs.map((roof) => (
        <g key={roof.id} data-iso-roof={roof.id} className="cad-roof-plan">
          <path d={ring(roof.points)} vectorEffect="non-scaling-stroke" />
          {roof.ridge.length === 2 && (
            <line
              x1={roof.ridge[0].x}
              y1={roof.ridge[0].y}
              x2={roof.ridge[1].x}
              y2={roof.ridge[1].y}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      ))}
    </g>
  );
});
