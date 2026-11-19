"use client";

import { Focus, Minus, Plus } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  fitCamera,
  modelPoint,
  pinchCamera,
  snapWallPoint,
  snapPoint,
  unitFactor,
  wallHit,
  zoomCamera,
  type Camera,
  type Viewport,
} from "@/lib/plans/cad";
import { utilityCatalog, type UtilityLayer } from "@/lib/plans/catalog";
import { bounds } from "@/lib/plans/footprints";
import type { ClearanceIssue } from "@/lib/plans/clearance";
import { validateOpenings, wallLength } from "@/lib/plans/openings";
import {
  isSelected,
  selectAt,
  selectInBox,
  previewSelection,
} from "@/lib/plans/editor-selection";
import type { DisplayUnit, DraftPlanState, Point } from "@/lib/plans/model";
import {
  DrawingGrid,
  ClearanceDrawing,
  IsometricDrawing,
  PlanDrawing,
  type Selection,
} from "./drawing";

export type Tool = "select" | "wall" | "door" | "fixture" | "utility" | "pan";
type SurfaceProps = {
  plan: DraftPlanState;
  tool: Tool;
  iso: boolean;
  ortho: boolean;
  grid: number;
  unit: DisplayUnit;
  thicknessMm: number;
  selection: readonly Selection[];
  multi: boolean;
  layers: Record<UtilityLayer, boolean>;
  issue?: ClearanceIssue;
  zoomSlot: HTMLDivElement | null;
  onSelect(value: readonly Selection[], append?: boolean): void;
  onToggle(item: Selection): void;
  onMove(items: readonly Selection[], delta: Point): void;
  onPlace(tool: "fixture" | "utility", point: Point): void;
  onWall(start: Point, end: Point): boolean;
  onDoor(wallId: string, offsetMm: number): void;
};
type Gesture = {
  start: Point;
  camera: Camera;
  pan: boolean;
  additive: boolean;
  target: Selection | null;
  moving: readonly Selection[];
};
type Pinch = { origin: Point; distance: number; camera: Camera };
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const separation = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

export function Surface({
  plan,
  tool,
  iso,
  ortho,
  grid,
  unit,
  thicknessMm,
  selection,
  multi,
  layers,
  issue,
  zoomSlot,
  onSelect,
  onToggle,
  onMove,
  onPlace,
  onWall,
  onDoor,
}: SurfaceProps) {
  const surface = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);
  const suppressTouchTap = useRef(false);
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const initial = useRef(plan);
  const [size, setSize] = useState<Viewport>({ width: 640, height: 480 });
  const [planCamera, setPlanCamera] = useState<Camera | null>(null);
  const [isoCamera, setIsoCamera] = useState<Camera | null>(null);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const setCamera = iso ? setIsoCamera : setPlanCamera;
  const geometry = iso ? plan : initial.current;
  const camera =
    (iso ? isoCamera : planCamera) ??
    fitCamera(
      geometry.walls,
      size,
      iso,
      geometry.fixtures,
      geometry.utilities.filter(
        (marker) => layers[utilityCatalog[marker.template].layer],
      ),
    );
  const center = { x: size.width / 2, y: size.height / 2 };
  const origin = {
    x: center.x - camera.x * camera.scale,
    y: center.y - camera.y * camera.scale,
  };

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    setAnchor(null);
    setCursor(null);
    setDrag(null);
    gesture.current = null;
  }, [tool, iso]);
  useEffect(() => {
    setIsoCamera(null);
  }, [plan]);

  useEffect(() => {
    if (!issue || iso) return;
    const points = issue.segment ?? issue.polygons?.flat();
    if (!points?.length) return;
    const { left, right, top, bottom } = bounds(points);
    setPlanCamera((current) => ({
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      scale: current?.scale ?? camera.scale,
    }));
    // Centering is an explicit audit selection. Subsequent pan and zoom remain available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.id, iso]);

  function screen(event: { clientX: number; clientY: number }) {
    const bounds = svg.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function zoom(factor: number, point = center) {
    setCamera(zoomCamera(camera, size, point, factor));
  }
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    function wheel(event: globalThis.WheelEvent) {
      event.preventDefault();
      const bounds = element!.getBoundingClientRect();
      const at = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      setCamera(
        zoomCamera(
          camera,
          size,
          at,
          Math.exp(-Math.min(90, Math.max(-90, event.deltaY)) * 0.009),
        ),
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [camera, size, setCamera]);

  function snap(point: Point, start = anchor) {
    return snapWallPoint(
      point,
      plan.walls,
      grid,
      9 / camera.scale,
      start ?? undefined,
      ortho,
    );
  }

  function activate(point: Point, additive = multi) {
    if (iso || tool === "pan") return;
    if (tool === "wall") {
      const end = snap(point);
      if (!anchor) setAnchor(end);
      else if (!same(anchor, end) && onWall(anchor, end)) setAnchor(null);
      setCursor(end);
      return;
    }
    if (tool === "fixture" || tool === "utility") {
      onPlace(tool, snapPoint(point, grid));
      return;
    }
    if (tool === "door") {
      const hit = wallHit(point, plan.walls, 11 / camera.scale);
      if (hit) onDoor(hit.wall.id, Math.round(hit.offset));
      return;
    }
    const target = selectAt(plan, point, camera.scale, layers);
    if (additive) {
      if (target) onToggle(target);
    } else onSelect(target ? [target] : []);
  }

  function deltaFor(from: Point, to: Point, scale: number) {
    return snapPoint(
      { x: (to.x - from.x) / scale, y: (to.y - from.y) / scale },
      grid,
    );
  }

  function touchDown(event: PointerEvent<SVGSVGElement>, point: Point) {
    touches.current.set(event.pointerId, point);
    const [a, b] = touches.current.values();
    if (a && b) {
      if (!pinch.current)
        pinch.current = {
          origin: midpoint(a, b),
          distance: separation(a, b),
          camera,
        };
      suppressTouchTap.current = true;
      gesture.current = null;
      setAnchor(null);
      setCursor(null);
      setDrag(null);
    }
    return suppressTouchTap.current;
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    const touch = event.pointerType === "touch";
    if (
      !touch &&
      (!event.isPrimary || (event.button !== 0 && event.button !== 1))
    )
      return;
    const point = screen(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touch && touchDown(event, point)) return;
    event.currentTarget.focus({ preventScroll: true });
    const target =
      !iso && tool === "select"
        ? selectAt(plan, modelPoint(point, size, camera), camera.scale, layers)
        : null;
    const additive = multi || event.shiftKey;
    const selected = target ? isSelected(selection, target) : false;
    gesture.current = {
      start: point,
      camera,
      pan: iso || tool === "pan" || event.button === 1,
      additive,
      target,
      moving:
        target && (!additive || selected)
          ? selected
            ? selection
            : [target]
          : [],
    };
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const point = screen(event);
    if (event.pointerType === "touch" && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, point);
      if (suppressTouchTap.current) {
        const [a, b] = touches.current.values();
        const base = pinch.current;
        if (a && b && base) {
          setCamera(
            pinchCamera(
              base.camera,
              size,
              base.origin,
              midpoint(a, b),
              base.distance,
              separation(a, b),
            ),
          );
        }
        return;
      }
    }
    if (!event.isPrimary) return;
    const current = gesture.current;
    if (current?.pan) {
      setCamera({
        x:
          current.camera.x - (point.x - current.start.x) / current.camera.scale,
        y:
          current.camera.y - (point.y - current.start.y) / current.camera.scale,
        scale: current.camera.scale,
      });
      return;
    }
    if (current && tool === "select") {
      if (separation(current.start, point) > 5)
        setDrag({ start: current.start, end: point });
      else setDrag(null);
      return;
    }
    if (!iso && tool === "wall") {
      const start =
        current &&
        !anchor &&
        Math.hypot(point.x - current.start.x, point.y - current.start.y) > 6
          ? snap(modelPoint(current.start, size, current.camera), null)
          : anchor;
      setCursor(snap(modelPoint(point, size, camera), start));
    }
  }

  function releaseTouch(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch") return false;
    const suppressed = suppressTouchTap.current;
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (touches.current.size === 0) suppressTouchTap.current = false;
    return suppressed;
  }

  function pointerCancel(event: PointerEvent<SVGSVGElement>) {
    releaseTouch(event);
    gesture.current = null;
    setCursor(null);
    setDrag(null);
  }

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    if (releaseTouch(event) || !event.isPrimary) return;
    const current = gesture.current;
    gesture.current = null;
    setDrag(null);
    if (!current || current.pan) return;
    const screenPoint = screen(event);
    const point = modelPoint(screenPoint, size, current.camera);
    if (tool === "select" && separation(current.start, screenPoint) > 5) {
      if (current.moving.length) {
        onSelect(current.moving);
        onMove(
          current.moving,
          deltaFor(current.start, screenPoint, current.camera.scale),
        );
      } else {
        const from = modelPoint(current.start, size, current.camera);
        onSelect(selectInBox(plan, from, point, layers), current.additive);
      }
      return;
    }
    if (
      tool === "wall" &&
      !anchor &&
      Math.hypot(
        screenPoint.x - current.start.x,
        screenPoint.y - current.start.y,
      ) > 6
    ) {
      const start = snap(modelPoint(current.start, size, current.camera), null);
      const end = snap(point, start);
      if (!same(start, end)) onWall(start, end);
      return;
    }
    activate(point, current.additive);
  }

  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "Escape") {
      gesture.current = null;
      setDrag(null);
      setAnchor(null);
      setCursor(null);
      onSelect([]);
      return;
    }
    if (iso || tool === "pan") return;
    if (
      tool === "select" &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      onSelect(
        selectInBox(
          plan,
          { x: -Infinity, y: -Infinity },
          { x: Infinity, y: Infinity },
          layers,
        ),
      );
      return;
    }
    const point = cursor ?? snap({ x: camera.x, y: camera.y });
    if (event.key === "Enter") {
      event.preventDefault();
      activate(point);
      return;
    }
    const movement: Record<string, Point> = {
      ArrowLeft: { x: -grid, y: 0 },
      ArrowRight: { x: grid, y: 0 },
      ArrowUp: { x: 0, y: -grid },
      ArrowDown: { x: 0, y: grid },
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    if (tool === "select" && selection.length) {
      onMove(selection, { x: Math.round(delta.x), y: Math.round(delta.y) });
    } else setCursor(snap({ x: point.x + delta.x, y: point.y + delta.y }));
  }

  const current = gesture.current;
  let rendered = plan;
  if (drag && current?.moving.length) {
    const candidate = previewSelection(
      plan,
      current.moving,
      deltaFor(drag.start, drag.end, current.camera.scale),
    );
    const validWalls = candidate.walls.every((wall) => wallLength(wall) > 0);
    if (validWalls) {
      try {
        validateOpenings(candidate.walls, candidate.openings);
        rendered = candidate;
      } catch {
        // The committed command surfaces the placement error.
      }
    }
  }
  const marquee = drag && !current?.moving.length;
  const dragStart =
    !anchor && tool === "wall" && current && !current.pan
      ? snap(modelPoint(current.start, size, current.camera), null)
      : null;
  const start = anchor ?? dragStart;
  const preview =
    start && cursor && !same(start, cursor) && tool === "wall" && !iso;
  const step = grid * camera.scale;
  const gridPx = step * 2 ** Math.max(0, Math.ceil(Math.log2(8 / step)));
  const scaleMm = unit === "mm" ? 1000 : 36 * unitFactor(unit);
  const scaleWidth = Math.min(scaleMm * camera.scale, 72);
  const scaleText = Math.round(scaleWidth / camera.scale / unitFactor(unit));

  return (
    <div
      className={"studio-surface" + (iso ? " studio-isometric" : "")}
      ref={surface}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className={`studio-canvas tool-${iso ? "pan" : tool}`}
        role="region"
        aria-label="Drawing surface"
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerCancel}
        onDragStart={(event) => event.preventDefault()}
        onLostPointerCapture={(event) => {
          if (touches.current.has(event.pointerId) || gesture.current)
            pointerCancel(event);
        }}
        onPointerLeave={() => {
          if (!gesture.current) setCursor(null);
        }}
        onKeyDown={keyboard}
      >
        <DrawingGrid step={gridPx} x={origin.x} y={origin.y} isometric={iso} />
        <g
          transform={`translate(${origin.x} ${origin.y}) scale(${camera.scale})`}
        >
          {iso ? (
            <IsometricDrawing plan={plan} />
          ) : (
            <PlanDrawing
              plan={rendered}
              selection={
                drag && current?.moving.length ? current.moving : selection
              }
              layers={layers}
              scale={camera.scale}
            />
          )}
          {!iso && <ClearanceDrawing issue={issue} scale={camera.scale} />}
          {preview && (
            <line
              className="cad-preview"
              x1={start.x}
              y1={start.y}
              x2={cursor.x}
              y2={cursor.y}
              strokeWidth={thicknessMm}
            />
          )}
          {!iso && cursor && (
            <circle
              className="cad-cursor"
              cx={cursor.x}
              cy={cursor.y}
              r={4 / camera.scale}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
        {marquee && (
          <rect
            className="cad-marquee"
            x={Math.min(drag.start.x, drag.end.x)}
            y={Math.min(drag.start.y, drag.end.y)}
            width={Math.abs(drag.start.x - drag.end.x)}
            height={Math.abs(drag.start.y - drag.end.y)}
          />
        )}
        {preview && (
          <text
            className="cad-measure"
            x={Math.max(
              42,
              Math.min(
                size.width - 42,
                origin.x + ((start.x + cursor.x) * camera.scale) / 2,
              ),
            )}
            y={Math.max(
              36,
              origin.y + ((start.y + cursor.y) * camera.scale) / 2 - 13,
            )}
          >
            {Math.round(
              Math.hypot(cursor.x - start.x, cursor.y - start.y) /
                unitFactor(unit),
            )}{" "}
            {unit}
          </text>
        )}
      </svg>
      {!plan.walls.length &&
        !plan.fixtures.length &&
        !plan.utilities.length &&
        !start && (
          <div className="studio-empty">
            <strong>A blank drawing</strong>
            <span>
              {iso
                ? "Draw a wall in 2D to see it here."
                : "Choose Wall to start drawing."}
            </span>
          </div>
        )}
      <div className="studio-scale" aria-hidden="true">
        {scaleText} {unit}
        {scaleWidth >= 12 && <i style={{ width: scaleWidth }} />}
      </div>
      {zoomSlot &&
        createPortal(
          <div className="studio-zoom" role="group" aria-label="Zoom controls">
            <button
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => zoom(1 / 1.25)}
            >
              <Minus size={16} />
            </button>
            <button
              aria-label="Fit drawing"
              title="Fit drawing"
              onClick={() =>
                setCamera(
                  fitCamera(
                    plan.walls,
                    size,
                    iso,
                    plan.fixtures,
                    plan.utilities.filter(
                      (item) => layers[utilityCatalog[item.template].layer],
                    ),
                  ),
                )
              }
            >
              <Focus size={16} />
            </button>
            <button
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => zoom(1.25)}
            >
              <Plus size={16} />
            </button>
          </div>,
          zoomSlot,
        )}
    </div>
  );
}
