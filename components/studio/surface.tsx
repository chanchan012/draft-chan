"use client";

import { referencePoints } from "@/lib/plans/drawing-references";
import { ReferenceDrawing, UnderlayDrawing } from "./source-drawing";
import { underlayPoint } from "@/lib/plans/underlays";
import {
  CoordinationDrawing,
  coordinationExtent,
} from "./coordination-drawing";
import type { CoordinationFinding } from "@/lib/plans/model";
import { PlanMarks } from "./sheet-drawing";
import { Crosshair, Focus, Minus, Plus } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { BuildingPlanDrawing } from "./building-drawing";
import {
  buildingElementFootprint,
  elementsOnStorey,
  roofProfile,
} from "@/lib/plans/building";
import { storeyById } from "@/lib/plans/storeys";
import { visibleDrawing } from "@/lib/plans/organization";
import { createPortal } from "react-dom";
import {
  fitCamera,
  modelPoint,
  pinchCamera,
  projectIso,
  snapPoint,
  unitFactor,
  wallHit,
  zoomCamera,
  type Camera,
  type Viewport,
} from "@/lib/plans/cad";
import {
  lengthUnits,
  measurePoints,
  millimeters,
  modelPrecision,
  resolveSnap,
  type LengthUnit,
  type SnapResult,
} from "@/lib/plans/precision";
import {
  arcFromPoints,
  pointAt,
  polarTarget,
  sketchPath,
} from "@/lib/plans/sketch";
import { modelPointInput, type SketchGeometry } from "@/lib/plans/model";
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
import type { LivePeer } from "@/lib/plans/live";
import {
  DrawingGrid,
  ClearanceDrawing,
  PlanDrawing,
  type Selection,
} from "./drawing";
import { IsometricDrawing } from "./isometric-drawing";

export type Tool =
  | "select"
  | "wall"
  | "door"
  | "fixture"
  | "utility"
  | "measure"
  | "sketch"
  | "pan";
type SurfaceProps = {
  plan: DraftPlanState;
  coordinationPlan?: DraftPlanState;
  coordinationFinding?: CoordinationFinding;
  equipmentZones?: boolean;
  tool: Tool;
  iso: boolean;
  ortho: boolean;
  grid: number;
  unit: DisplayUnit;
  thicknessMm: number;
  wallHeightMm?: number;
  storeyId?: string;
  selection: readonly Selection[];
  multi: boolean;
  layers: Record<UtilityLayer, boolean>;
  issue?: ClearanceIssue;
  zoomSlot: HTMLDivElement | null;
  peers: readonly LivePeer[];
  onPresence(point: Point | null): void;
  onSelect(value: readonly Selection[], append?: boolean): void;
  onToggle(item: Selection): void;
  onMove(items: readonly Selection[], delta: Point): void;
  onPlace(tool: "fixture" | "utility", point: Point): void;
  onSketch(geometry: SketchGeometry): boolean;
  onWall(start: Point, end: Point): boolean;
  onDimension(start: Point, end: Point): boolean;
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
const humanColors = ["#2d655d", "#395888", "#86465f", "#68509b"];

export function Surface({
  plan: authored,
  coordinationPlan = authored,
  coordinationFinding,
  equipmentZones = false,
  tool,
  iso,
  ortho,
  grid,
  unit,
  thicknessMm,
  wallHeightMm,
  storeyId = "ground",
  selection,
  multi,
  layers,
  issue,
  zoomSlot,
  peers,
  onPresence,
  onSelect,
  onToggle,
  onMove,
  onPlace,
  onWall,
  onSketch,
  onDimension,
  onDoor,
}: SurfaceProps) {
  const plan = useMemo(() => visibleDrawing(authored), [authored]);
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
  const [snapMatch, setSnapMatch] = useState<SnapResult>();
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [snapMode, setSnapMode] = useState("center");
  const [inputUnit, setInputUnit] = useState<LengthUnit>();
  const [sketchKind, setSketchKind] =
    useState<SketchGeometry["kind"]>("construction");
  const [vertices, setVertices] = useState<Point[]>([]);
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [localOrigin, setLocalOrigin] = useState<Point>();
  const [entryMode, setEntryMode] = useState<"coordinates" | "polar">(
    "coordinates",
  );
  const [polarStep, setPolarStep] = useState(0);
  const [precisionError, setPrecisionError] = useState("");
  const setCamera = iso ? setIsoCamera : setPlanCamera;
  const geometry = iso ? plan : initial.current;
  const structurePoints = useMemo(() => {
    const base = storeyById(plan, storeyId).elevationMm;
    const points = elementsOnStorey(plan, storeyId).flatMap((item) => {
      const footprint = buildingElementFootprint(item);
      if (!iso) return footprint;
      const roof = item.kind === "roof" ? roofProfile(plan, item) : undefined;
      const z =
        item.kind === "stair" && item.fromStoreyId === storeyId
          ? storeyById(plan, item.toStoreyId).elevationMm - base
          : item.kind === "slab"
            ? item.offsetMm - item.thicknessMm
            : 0;
      return [...footprint, ...(roof?.ridgePoints ?? [])].flatMap((point) => [
        projectIso(point),
        projectIso(point, roof ? roof.height(point) - base : z),
      ]);
    });
    if (iso) return points;
    return [
      ...points,
      ...coordinationExtent(coordinationPlan, storeyId),
      ...referencePoints(plan, storeyId),
      ...(plan.underlays ?? [])
        .filter((item) => item.visible && item.storeyId === storeyId)
        .flatMap((item) =>
          [
            { x: 0, y: 0 },
            { x: item.width, y: 0 },
            { x: 0, y: item.height },
            { x: item.width, y: item.height },
          ].map((point) => underlayPoint(item.calibration, point)),
        ),
    ];
  }, [coordinationPlan, iso, plan, storeyId]);
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
      geometry.annotations,
      geometry.sketches,
      wallHeightMm,
      structurePoints,
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
    setVertices([]);
    setPrecisionError("");
    setSnapMatch(undefined);
    setCursor(null);
    setDrag(null);
    gesture.current = null;
  }, [tool, iso, sketchKind]);
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

  function resolved(point: Point, start: Point | null) {
    return snapMode === "grid"
      ? undefined
      : resolveSnap(plan.walls, point, {
          radiusMm: 9 / camera.scale,
          anchor: start ?? undefined,
          ortho: ortho && tool === "wall",
          modes:
            snapMode === "faces"
              ? ["face"]
              : ["endpoint", "midpoint", "intersection", "perpendicular"],
        });
  }

  const drawingLine = tool === "wall" || tool === "measure";
  const drawing = drawingLine || tool === "sketch";
  const drawingAnchor =
    tool === "sketch"
      ? ((sketchKind === "polyline" ? vertices.at(-1) : vertices[0]) ?? null)
      : anchor;
  const viewGridOrigin =
    !iso && localOrigin
      ? {
          x: origin.x + camera.scale * localOrigin.x,
          y: origin.y + camera.scale * localOrigin.y,
        }
      : origin;

  function gridTarget(point: Point, start: Point | null) {
    if (start && polarStep && !(ortho && tool === "wall")) {
      const target = polarTarget(start, point, polarStep, grid);
      if (modelPointInput.safeParse(modelPrecision(target)).success)
        return target;
    }
    if (!localOrigin)
      return snapPoint(
        point,
        grid,
        start ?? undefined,
        ortho && tool === "wall",
      );
    const shifted = {
      x: localOrigin.x + Math.round((point.x - localOrigin.x) / grid) * grid,
      y: localOrigin.y + Math.round((point.y - localOrigin.y) / grid) * grid,
    };
    if (start && ortho && tool === "wall") {
      if (Math.abs(point.x - start.x) >= Math.abs(point.y - start.y))
        shifted.y = start.y;
      else shifted.x = start.x;
    }
    return {
      x: Math.max(-1e6, Math.min(1e6, shifted.x)),
      y: Math.max(-1e6, Math.min(1e6, shifted.y)),
    };
  }

  function snap(point: Point, start = drawingAnchor) {
    return resolved(point, start)?.point ?? gridTarget(point, start);
  }

  const commitLine = (start: Point, end: Point) =>
    (tool === "measure" ? onDimension : onWall)(
      modelPrecision(start),
      modelPrecision(end),
    );

  function commitSketch(geometry: SketchGeometry) {
    if (onSketch(geometry)) {
      setVertices([]);
      setCursor(null);
    }
  }

  function finishPolyline() {
    if (vertices.length >= (polygonClosed ? 3 : 2))
      commitSketch({
        kind: "polyline",
        points: vertices,
        closed: polygonClosed,
      });
  }

  function fromSketchPoints(point: Point): SketchGeometry | undefined {
    const [first, second] = vertices;
    if (!first) return;
    switch (sketchKind) {
      case "construction":
        return { kind: "construction", start: first, end: point };
      case "circle":
        return {
          kind: "circle",
          center: first,
          radiusMm: separation(first, point),
        };
      case "arc":
        return second
          ? arcFromPoints(first, second, point)
          : { kind: "construction", start: first, end: point };
      case "polyline":
        return {
          kind: "polyline",
          points: [...vertices, point],
          closed: false,
        };
    }
  }

  function placePoint(end: Point) {
    setPrecisionError("");
    setCursor(end);
    const rounded = modelPrecision(end);
    if (tool === "sketch") {
      const [first, second] = vertices;
      if (
        !vertices.length ||
        sketchKind === "polyline" ||
        (sketchKind === "arc" && !second)
      ) {
        if (vertices.length >= 128) {
          setPrecisionError("Finish the polyline at 128 vertices.");
          return;
        }
        if (!vertices.length || !same(vertices[vertices.length - 1], rounded))
          setVertices([
            ...vertices,
            sketchKind === "arc" && first ? end : rounded,
          ]);
        return;
      }
      if (same(first, rounded)) return;
      const geometry = fromSketchPoints(
        sketchKind === "construction" ? rounded : end,
      );
      if (geometry) commitSketch(geometry);
      return;
    }
    if (!anchor) setAnchor(end);
    else if (!same(modelPrecision(anchor), rounded) && commitLine(anchor, end))
      setAnchor(null);
  }

  function submitPoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trigger = (event.nativeEvent as SubmitEvent).submitter;
    const setOrigin = trigger?.getAttribute("value") === "set-origin";
    const data = new FormData(event.currentTarget);
    const factor = millimeters[inputUnit ?? unit];
    let point: Point;
    if (entryMode === "polar" && drawingAnchor && !setOrigin) {
      const distance = Number(data.get("distance")) * factor;
      const angle = Number(data.get("angle"));
      if (!(distance > 0) || !Number.isFinite(angle)) {
        setPrecisionError("Enter a positive distance and an angle.");
        return;
      }
      point = pointAt(drawingAnchor, distance, angle % 360);
    } else {
      const base = setOrigin ? undefined : localOrigin;
      point = {
        x: Number(data.get("x")) * factor + (base?.x ?? 0),
        y: Number(data.get("y")) * factor + (base?.y ?? 0),
      };
    }
    if (!modelPointInput.safeParse(modelPrecision(point)).success) {
      setPrecisionError("Enter coordinates within the drawing bounds.");
      return;
    }
    setPrecisionError("");
    setSnapMatch(undefined);
    if (setOrigin) setLocalOrigin(modelPrecision(point));
    else placePoint(point);
  }

  function activate(point: Point, additive = multi) {
    if (iso || tool === "pan") return;
    if (drawing) {
      const match = resolved(point, drawingAnchor);
      setSnapMatch(match);
      placePoint(match?.point ?? gridTarget(point, drawingAnchor));
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
      setVertices([]);
      setPrecisionError("");
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
    if (!iso && event.isPrimary) onPresence(modelPoint(point, size, camera));
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
    if (!iso && event.isPrimary && !suppressTouchTap.current)
      onPresence(modelPoint(point, size, camera));
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
    if (!iso && drawing) {
      const start =
        drawingLine &&
        current &&
        !anchor &&
        Math.hypot(point.x - current.start.x, point.y - current.start.y) > 6
          ? snap(modelPoint(current.start, size, current.camera), null)
          : drawingAnchor;
      const probe = modelPoint(point, size, camera);
      const match = resolved(probe, start);
      setSnapMatch(match);
      setCursor(match?.point ?? gridTarget(probe, start));
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
    onPresence(null);
    gesture.current = null;
    setCursor(null);
    setDrag(null);
  }

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") onPresence(null);
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
      drawingLine &&
      !anchor &&
      Math.hypot(
        screenPoint.x - current.start.x,
        screenPoint.y - current.start.y,
      ) > 6
    ) {
      const start = snap(modelPoint(current.start, size, current.camera), null);
      const end = snap(point, start);
      if (!same(start, end)) commitLine(start, end);
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
      if (
        tool === "sketch" &&
        sketchKind === "polyline" &&
        vertices.length >= 2 &&
        (!cursor || same(modelPrecision(cursor), vertices.at(-1)!))
      )
        finishPolyline();
      else if (drawing && cursor) placePoint(cursor);
      else activate(point);
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
    } else {
      const probe = { x: point.x + delta.x, y: point.y + delta.y };
      setSnapMatch(resolved(probe, drawingAnchor));
      setCursor(snap(probe));
    }
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
        validateOpenings(candidate.walls, [
          ...candidate.openings,
          ...(candidate.windows ?? []),
        ]);
        rendered = candidate;
      } catch {
        // The committed command surfaces the placement error.
      }
    }
  }
  const marquee = drag && !current?.moving.length;
  const dragStart =
    !anchor && drawingLine && current && !current.pan
      ? snap(modelPoint(current.start, size, current.camera), null)
      : null;
  const start = anchor ?? dragStart;
  const preview =
    start && cursor && !same(start, cursor) && drawingLine && !iso;
  const sketchPreview =
    tool === "sketch" && vertices.length && cursor
      ? fromSketchPoints(cursor)
      : undefined;
  const step = grid * camera.scale;
  const gridPx = step * 2 ** Math.max(0, Math.ceil(Math.log2(8 / step)));
  const scaleMm = unit === "mm" ? 1000 : 36 * unitFactor(unit);
  const scaleWidth = Math.min(scaleMm * camera.scale, 72);
  const scaleText = Math.round(scaleWidth / camera.scale / unitFactor(unit));

  useEffect(() => {
    if (iso) onPresence(null);
  }, [iso, onPresence]);

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
          onPresence(null);
          if (!gesture.current) setCursor(null);
        }}
        onKeyDown={keyboard}
      >
        <DrawingGrid
          step={gridPx}
          x={viewGridOrigin.x}
          y={viewGridOrigin.y}
          isometric={iso}
        />
        <g
          transform={`translate(${origin.x} ${origin.y}) scale(${camera.scale})`}
        >
          {!iso && <UnderlayDrawing plan={plan} storeyId={storeyId} />}
          {!iso && <ReferenceDrawing plan={plan} storeyId={storeyId} />}
          {iso ? (
            <IsometricDrawing
              plan={plan}
              heightMm={wallHeightMm}
              storeyId={storeyId}
            />
          ) : (
            <PlanDrawing
              plan={rendered}
              selection={
                drag && current?.moving.length ? current.moving : selection
              }
              layers={layers}
              scale={camera.scale}
              unit={unit}
            />
          )}
          {!iso && <BuildingPlanDrawing plan={plan} storeyId={storeyId} />}
          {!iso && (
            <CoordinationDrawing
              plan={coordinationPlan}
              storeyId={storeyId}
              scale={camera.scale}
              layers={layers}
              finding={coordinationFinding}
              zones={equipmentZones}
            />
          )}
          {!iso && (
            <PlanMarks
              plan={plan}
              storeyId={storeyId}
              cameraScale={camera.scale}
            />
          )}
          {!iso && <ClearanceDrawing issue={issue} scale={camera.scale} />}
          {!iso && localOrigin && (
            <path
              className="cad-local-origin"
              vectorEffect="non-scaling-stroke"
              d={`M ${localOrigin.x - 9 / camera.scale} ${localOrigin.y} h ${18 / camera.scale} M ${localOrigin.x} ${localOrigin.y - 9 / camera.scale} v ${18 / camera.scale}`}
            />
          )}
          {!iso && sketchPreview && (
            <path
              className="cad-sketch cad-sketch-preview"
              d={sketchPath(sketchPreview)}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {preview && (
            <line
              className="cad-preview"
              x1={start.x}
              y1={start.y}
              x2={cursor.x}
              y2={cursor.y}
              strokeWidth={tool === "measure" ? 2 / camera.scale : thicknessMm}
            />
          )}
          {!iso && cursor && (
            <circle
              className="cad-cursor"
              data-snap={snapMatch?.kind}
              cx={cursor.x}
              cy={cursor.y}
              r={4 / camera.scale}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
        <g aria-hidden="true">
          {!iso &&
            peers.map(({ id, kind, cursor }) => {
              if (!cursor) return null;
              const x = origin.x + cursor.x * camera.scale;
              const y = origin.y + cursor.y * camera.scale;
              if (x < 0 || x > size.width || y < 0 || y > size.height)
                return null;
              const ai = kind === "ai";
              const color = ai
                ? "#873e23"
                : humanColors[
                    id.charCodeAt(id.length - 1) % humanColors.length
                  ];
              const label = ai ? "AI" : "Human";
              const width = ai ? 20 : 42;
              return (
                <g
                  key={id}
                  className="cad-peer"
                  data-peer-kind={kind}
                  fill={color}
                  transform={`translate(${x} ${y})`}
                >
                  <path
                    d="M 0 0 L 3 13 L 6 8 L 12 7 Z"
                    stroke="white"
                    strokeWidth="1"
                  />
                  <rect x="9" y="11" width={width} height="17" rx="4" />
                  <text x={9 + width / 2} y="22.5" textAnchor="middle">
                    {label}
                  </text>
                </g>
              );
            })}
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
            {Number(measurePoints(start, cursor, unit).value.toFixed(2))} {unit}
          </text>
        )}
      </svg>
      {!plan.walls.length &&
        !plan.fixtures.length &&
        !plan.utilities.length &&
        !plan.annotations?.length &&
        !plan.sketches?.length &&
        !structurePoints.length &&
        tool !== "sketch" &&
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
      {!iso && drawing && (
        <div className="studio-floating studio-precision">
          <button
            type="button"
            aria-label="Precision input"
            aria-expanded={precisionOpen}
            onClick={() => setPrecisionOpen(!precisionOpen)}
            title="Precision input"
          >
            <Crosshair size={17} />
          </button>
          {precisionOpen && (
            <form onSubmit={submitPoint} className="studio-precision-form">
              <label>
                Snap
                <select
                  value={snapMode}
                  onChange={(event) => setSnapMode(event.target.value)}
                >
                  <option value="center">Object snaps</option>
                  <option value="faces">Wall faces</option>
                  <option value="grid">Grid only</option>
                </select>
              </label>
              <label>
                Input unit
                <select
                  value={inputUnit ?? unit}
                  onChange={(event) =>
                    setInputUnit(event.target.value as LengthUnit)
                  }
                >
                  {lengthUnits.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              {drawingAnchor && (
                <label>
                  Point entry
                  <select
                    value={entryMode}
                    onChange={(event) =>
                      setEntryMode(
                        event.target.value === "polar"
                          ? "polar"
                          : "coordinates",
                      )
                    }
                  >
                    <option value="coordinates">Coordinates</option>
                    <option value="polar">Distance and angle</option>
                  </select>
                </label>
              )}
              {entryMode === "polar" && drawingAnchor ? (
                <div className="studio-precision-pair">
                  <label>
                    Distance{" "}
                    <input name="distance" type="number" step="any" required />
                  </label>
                  <label>
                    Angle (°){" "}
                    <input name="angle" type="number" step="any" required />
                  </label>
                </div>
              ) : (
                <div className="studio-precision-pair">
                  <label>
                    X <input name="x" type="number" step="any" required />
                  </label>
                  <label>
                    Y <input name="y" type="number" step="any" required />
                  </label>
                </div>
              )}
              <button type="submit">
                {drawingAnchor ? "Place next point" : "Set first point"}
              </button>
              <details>
                <summary>Tracking and origin</summary>
                <label>
                  Polar tracking
                  <select
                    value={polarStep}
                    onChange={(event) =>
                      setPolarStep(Number(event.target.value))
                    }
                  >
                    <option value="0">Off</option>
                    {[15, 30, 45, 90].map((angle) => (
                      <option key={angle} value={angle}>
                        {angle}°
                      </option>
                    ))}
                  </select>
                </label>
                {(!drawingAnchor || entryMode === "coordinates") && (
                  <button type="submit" value="set-origin">
                    Set local origin from X/Y
                  </button>
                )}
                {localOrigin && (
                  <button
                    type="button"
                    onClick={() => setLocalOrigin(undefined)}
                  >
                    Reset local origin
                  </button>
                )}
              </details>
              {precisionError && <span role="alert">{precisionError}</span>}
            </form>
          )}
        </div>
      )}
      {!iso && tool === "sketch" && (
        <div className="studio-floating studio-sketch-tools">
          <select
            aria-label="Sketch shape"
            value={sketchKind}
            onChange={(event) =>
              setSketchKind(event.target.value as SketchGeometry["kind"])
            }
          >
            <option value="construction">Construction line</option>
            <option value="polyline">Polyline</option>
            <option value="circle">Circle</option>
            <option value="arc">Arc</option>
          </select>
          {sketchKind === "polyline" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={polygonClosed}
                  onChange={(event) => setPolygonClosed(event.target.checked)}
                />{" "}
                Closed
              </label>
              <button
                type="button"
                disabled={vertices.length < (polygonClosed ? 3 : 2)}
                onClick={finishPolyline}
              >
                Finish
              </button>
            </>
          )}
          {sketchKind === "arc" && (
            <span>
              {vertices.length === 0
                ? "Set center"
                : vertices.length === 1
                  ? "Set radius"
                  : "Set end angle"}
            </span>
          )}
        </div>
      )}
      {!iso && drawing && snapMatch && cursor && (
        <span className="studio-snap-label" data-kind={snapMatch.kind}>
          {snapMatch.kind}
        </span>
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
                    plan.annotations,
                    plan.sketches,
                    wallHeightMm,
                    structurePoints,
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
