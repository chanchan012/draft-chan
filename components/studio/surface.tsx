"use client";

import { Focus, Minus, Plus } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  fitCamera,
  modelPoint,
  snapWallPoint,
  unitFactor,
  wallHit,
  zoomCamera,
  type Camera,
  type Viewport,
} from "@/lib/plans/cad";
import { doorBounds } from "@/lib/plans/openings";
import type { DisplayUnit, DraftPlanState, Point } from "@/lib/plans/model";
import {
  DrawingGrid,
  IsometricDrawing,
  PlanDrawing,
  type Selection,
} from "./drawing";

export type Tool = "select" | "wall" | "door" | "pan";
type SurfaceProps = {
  plan: DraftPlanState;
  tool: Tool;
  iso: boolean;
  ortho: boolean;
  grid: number;
  unit: DisplayUnit;
  thicknessMm: number;
  selection: Selection | null;
  onSelect(value: Selection | null): void;
  onWall(start: Point, end: Point): boolean;
  onDoor(wallId: string, offsetMm: number): void;
};
type Gesture = { start: Point; camera: Camera; pan: boolean };

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
  onSelect,
  onWall,
  onDoor,
}: SurfaceProps) {
  const surface = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const initial = useRef(plan.walls);
  const [size, setSize] = useState<Viewport>({ width: 640, height: 480 });
  const [planCamera, setPlanCamera] = useState<Camera | null>(null);
  const [isoCamera, setIsoCamera] = useState<Camera | null>(null);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const setCamera = iso ? setIsoCamera : setPlanCamera;
  const camera =
    (iso ? isoCamera : planCamera) ??
    fitCamera(iso ? plan.walls : initial.current, size, iso);
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
  }, [tool, iso]);
  useEffect(() => {
    setIsoCamera(null);
  }, [plan]);

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

  function activate(point: Point) {
    if (iso || tool === "pan") return;
    if (tool === "wall") {
      const end = snap(point);
      if (!anchor) setAnchor(end);
      else if (!same(anchor, end) && onWall(anchor, end)) setAnchor(null);
      setCursor(end);
      return;
    }
    const hit = wallHit(point, plan.walls, 11 / camera.scale);
    if (tool === "door") {
      if (hit) onDoor(hit.wall.id, Math.round(hit.offset));
      return;
    }
    const door =
      hit &&
      plan.openings.find((item) => {
        const [start, end] = doorBounds(item);
        return (
          item.wallId === hit.wall.id &&
          hit.offset >= start &&
          hit.offset <= end
        );
      });
    onSelect(
      door
        ? { kind: "door", id: door.id }
        : hit
          ? { kind: "wall", id: hit.wall.id }
          : null,
    );
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      start: screen(event),
      camera,
      pan: iso || tool === "pan" || event.button === 1,
    };
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary) return;
    const current = gesture.current;
    const point = screen(event);
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

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!event.isPrimary || !current) return;
    gesture.current = null;
    if (current.pan) return;
    const screenPoint = screen(event);
    const point = modelPoint(screenPoint, size, current.camera);
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
    activate(point);
  }

  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "Escape") {
      setAnchor(null);
      setCursor(null);
      onSelect(null);
      return;
    }
    if (iso || tool === "pan") return;
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
    setCursor(snap({ x: point.x + delta.x, y: point.y + delta.y }));
  }

  const current = gesture.current;
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
  const selectedView = iso ? "Isometric" : "2D plan";

  return (
    <div
      className={"studio-surface" + (iso ? " studio-isometric" : "")}
      ref={surface}
    >
      <span className="studio-view-name">{selectedView}</span>
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
        onPointerCancel={() => {
          gesture.current = null;
          setCursor(null);
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
            <PlanDrawing plan={plan} selection={selection} />
          )}
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
      {!plan.walls.length && !start && (
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
      <div className="studio-zoom" aria-label="Zoom controls">
        <button aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}>
          <Minus size={16} />
        </button>
        <button
          aria-label="Fit drawing"
          onClick={() => setCamera(fitCamera(plan.walls, size, iso))}
        >
          <Focus size={16} />
        </button>
        <button aria-label="Zoom in" onClick={() => zoom(1.25)}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
