import { z } from "zod";
import {
  modelPointInput,
  type DraftPlanState,
  type PlanCommand,
  type Point,
  type SketchGeometry,
  type Wall,
} from "./model";
import { modelPrecision } from "./precision";
import { directionDegrees, normalizeDegrees, pointAt } from "./sketch";
import { storeyOf } from "./storeys";
import { dot, subtract } from "./footprints";
import { doorBounds, pointAlong, wallLength } from "./openings";

const id = z.string().trim().min(1).max(128);
const angle = z.number().finite().min(-360).max(360);
const distance = z.number().finite().min(-1_000_000).max(1_000_000);
const positive = z.number().finite().min(1).max(1_000_000);
export const editableKinds = [
  "wall",
  "door",
  "window",
  "fixture",
  "utility",
  "dimension",
  "sketch",
] as const;
const entityRef = z.strictObject({ kind: z.enum(editableKinds), id });
const lineRef = entityRef.extend({ kind: z.enum(["wall", "sketch"]) });
type Ref = z.infer<typeof entityRef>;
type LineRef = z.infer<typeof lineRef>;
const refs = z.array(entityRef).min(1).max(128);
export const cadEditOptions = {
  transform: z.strictObject({
    entities: refs,
    transform: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.enum(["move", "copy"]),
        delta: modelPointInput,
      }),
      z.strictObject({
        mode: z.literal("rotate"),
        pivot: modelPointInput,
        angleDeg: angle,
      }),
      z.strictObject({
        mode: z.literal("mirror"),
        axisStart: modelPointInput,
        axisEnd: modelPointInput,
        copy: z.boolean().default(false),
      }),
    ]),
  }),
  offset: z.strictObject({
    entity: lineRef,
    distanceMm: distance,
    copy: z.boolean().default(true),
  }),
  trim_extend: z.strictObject({
    entity: lineRef,
    boundary: lineRef,
    endpoint: z.enum(["start", "end"]),
    mode: z.enum(["trim", "extend"]),
  }),
  corner: z.strictObject({
    first: lineRef,
    second: lineRef,
    mode: z.enum(["fillet", "chamfer"]),
    sizeMm: positive,
  }),
  array: z.strictObject({
    entities: refs,
    count: z.int().min(2).max(32),
    pattern: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("linear"), step: modelPointInput }),
      z.strictObject({
        mode: z.literal("polar"),
        center: modelPointInput,
        stepDeg: angle,
      }),
    ]),
  }),
};
export const cadEditSchema = z.discriminatedUnion("operation", [
  cadEditOptions.transform.extend({ operation: z.literal("transform") }),
  cadEditOptions.offset.extend({ operation: z.literal("offset") }),
  cadEditOptions.trim_extend.extend({ operation: z.literal("trim_extend") }),
  cadEditOptions.corner.extend({ operation: z.literal("corner") }),
  cadEditOptions.array.extend({ operation: z.literal("array") }),
]);
export type CadEdit = z.output<typeof cadEditSchema>;
type IdFactory = () => string;
type Segment = { start: Point; end: Point };
type Mapping = {
  point(p: Point): Point;
  heading(angle: number): number;
  reflected?: boolean;
};
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (p: Point, s: number): Point => ({ x: p.x * s, y: p.y * s });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const norm = (p: Point) => Math.hypot(p.x, p.y);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const otherEnd = (end: "start" | "end") => (end === "start" ? "end" : "start");

function direction(segment: Segment) {
  return scale(subtract(segment.end, segment.start), 1 / wallLength(segment));
}

function meeting(a: Segment, b: Segment) {
  const v = subtract(a.end, a.start);
  const w = subtract(b.end, b.start);
  const d = cross(v, w);
  if (Math.abs(d) <= 1e-9 * norm(v) * norm(w)) return;
  const diff = subtract(b.start, a.start);
  const t = cross(diff, w) / d;
  return { point: add(a.start, scale(v, t)), t, u: cross(diff, v) / d };
}

function translation(delta: Point): Mapping {
  if (!norm(delta)) throw new Error("Enter a nonzero displacement.");
  return { point: (p) => add(p, delta), heading: (a) => a };
}

function rotation(pivot: Point, degrees: number): Mapping {
  if (normalizeDegrees(degrees) === 0)
    throw new Error("Enter a rotation that changes the angle.");
  return {
    point: (p) =>
      pointAt(
        pivot,
        norm(subtract(p, pivot)),
        directionDegrees(pivot, p) + degrees,
      ),
    heading: (a) => normalizeDegrees(a + degrees),
  };
}

function reflection(axisStart: Point, axisEnd: Point): Mapping {
  if (same(axisStart, axisEnd))
    throw new Error("Use distinct mirror axis points.");
  const axis = direction({ start: axisStart, end: axisEnd });
  const angle = directionDegrees(axisStart, axisEnd);
  return {
    point: (p) => {
      const offset = subtract(p, axisStart);
      return add(
        axisStart,
        subtract(scale(axis, 2 * dot(offset, axis)), offset),
      );
    },
    heading: (a) => normalizeDegrees(2 * angle - a),
    reflected: true,
  };
}

function mapSketch(geometry: SketchGeometry, map: Mapping): SketchGeometry {
  const point = (p: Point) => modelPrecision(map.point(p));
  switch (geometry.kind) {
    case "construction":
      return {
        ...geometry,
        start: point(geometry.start),
        end: point(geometry.end),
      };
    case "polyline":
      return { ...geometry, points: geometry.points.map(point) };
    case "circle":
      return { ...geometry, center: point(geometry.center) };
    case "arc":
      return {
        ...geometry,
        center: point(geometry.center),
        startDeg: map.heading(
          geometry.startDeg + (map.reflected ? geometry.sweepDeg : 0),
        ),
      };
  }
}

function lookup<T extends { id: string }>(
  list: readonly T[] | undefined,
  ref: Ref,
) {
  const entity = list?.find(({ id }) => id === ref.id);
  if (!entity) throw new Error("Missing " + ref.kind + " " + ref.id + ".");
  return entity;
}

function transformEntities(
  plan: DraftPlanState,
  refs: Ref[],
  map: Mapping,
  copy: boolean,
  nextId: IdFactory,
): PlanCommand[] {
  const selected = new Map(refs.map((ref) => [ref.kind + ":" + ref.id, ref]));
  // Hosted openings always follow their walls. Process hosts before children.
  for (const [kind, openings] of [
    ["door", plan.openings],
    ["window", plan.windows ?? []],
  ] as const)
    for (const { id, wallId } of openings)
      if (selected.has("wall:" + wallId))
        selected.set(kind + ":" + id, { kind, id });
  const walls = new Map<
    string,
    { newId: string; original: Wall; changed: Wall }
  >();
  const result: PlanCommand[] = [];
  const blockLinks = new Map(
    plan.blockInstances?.map((link) => [link.kind + ":" + link.id, link]),
  );
  const point = (p: Point) => modelPrecision(map.point(p));
  for (const ref of selected.values()) {
    if (ref.kind !== "wall") continue;
    const original = lookup(plan.walls, ref);
    const id = copy ? nextId() : ref.id;
    const { thicknessMm, kind } = original;
    const referenceLine =
      map.reflected &&
      original.referenceLine &&
      original.referenceLine !== "center"
        ? original.referenceLine === "positive"
          ? "negative"
          : "positive"
        : original.referenceLine;
    const changes = {
      start: point(original.start),
      end: point(original.end),
      referenceLine,
    };
    const changed = {
      id,
      thicknessMm,
      kind,
      storeyId: original.storeyId,
      wallTypeId: original.wallTypeId,
      ...changes,
    };
    walls.set(ref.id, { newId: id, original, changed });
    result.push(
      copy
        ? { type: "wall.add", wall: changed }
        : { type: "wall.update", id, changes },
    );
  }
  for (const ref of selected.values()) {
    if (ref.kind === "wall") continue;
    const id = copy ? nextId() : ref.id;
    switch (ref.kind) {
      case "door":
      case "window": {
        const item =
          ref.kind === "door"
            ? lookup(plan.openings, ref)
            : lookup(plan.windows, ref);
        const host = walls.get(item.wallId);
        if (!host)
          throw new Error(
            "Include the host wall when transforming a door or window. Opening offsets can be edited in the Inspector.",
          );
        const offsetMm = Math.round(
          (wallLength(host.changed) * item.offsetMm) /
            wallLength(host.original),
        );
        if ("hinge" in item) {
          const hinge = item.hinge;
          const swing = map.reflected
            ? item.swing === "left"
              ? "right"
              : "left"
            : item.swing;
          result.push(
            copy
              ? {
                  type: "door.add",
                  door: {
                    id,
                    wallId: host.newId,
                    widthMm: item.widthMm,
                    hinge,
                    swing,
                    offsetMm,
                  },
                }
              : { type: "door.update", id, changes: { swing, offsetMm } },
          );
        } else if ("sillMm" in item) {
          result.push(
            copy
              ? {
                  type: "window.add",
                  opening: {
                    id,
                    wallId: host.newId,
                    widthMm: item.widthMm,
                    sillMm: item.sillMm,
                    heightMm: item.heightMm,
                    offsetMm,
                  },
                }
              : { type: "window.update", id, changes: { offsetMm } },
          );
        }
        break;
      }
      case "dimension": {
        const item = lookup(plan.annotations, ref);
        const changes = { start: point(item.start), end: point(item.end) };
        result.push(
          copy
            ? {
                type: "dimension.add",
                annotation: { id, ...changes, storeyId: item.storeyId },
              }
            : { type: "dimension.update", id, changes },
        );
        break;
      }
      case "sketch": {
        const item = lookup(plan.sketches, ref);
        const geometry = mapSketch(item.geometry, map);
        result.push(
          copy
            ? {
                type: "sketch.add",
                sketch: { id, geometry, storeyId: item.storeyId },
              }
            : { type: "sketch.update", id, geometry },
        );
        break;
      }
      case "fixture": {
        const {
          position,
          rotation,
          template,
          widthMm,
          depthMm,
          heightMm,
          storeyId,
        } = lookup(plan.fixtures, ref);
        const heading = map.heading(rotation);
        const index = Math.round(heading / 90);
        if (Math.abs(heading - index * 90) > 1e-7)
          throw new Error(
            "Furniture supports quarter-turn headings. Use an orthogonal rotation or mirror axis.",
          );
        const changes = {
          position: point(position),
          rotation: ([0, 90, 180, 270] as const)[index % 4],
        };
        result.push(
          copy
            ? {
                type: "fixture.add",
                fixture: {
                  id,
                  template,
                  storeyId,
                  widthMm,
                  depthMm,
                  heightMm,
                  ...changes,
                },
              }
            : { type: "fixture.update", id, changes },
        );
        break;
      }
      case "utility": {
        const { position, template, storeyId } = lookup(plan.utilities, ref);
        const changes = { position: point(position) };
        result.push(
          copy
            ? {
                type: "utility.add",
                utility: { id, template, storeyId, ...changes },
              }
            : { type: "utility.update", id, changes },
        );
      }
    }
    const link = copy ? blockLinks.get(ref.kind + ":" + ref.id) : undefined;
    if (link) {
      const instance = { ...link, id };
      if (instance.kind === "door" && map.reflected) {
        const door = lookup(plan.openings, ref);
        instance.overrides = {
          ...instance.overrides,
          swing: door.swing === "left" ? "right" : "left",
        };
      }
      result.push({ type: "block.link", instance });
    }
  }
  return result;
}

function lineFor(plan: DraftPlanState, ref: LineRef): Segment {
  if (ref.kind === "wall") return lookup(plan.walls, ref);
  const { geometry } = lookup(plan.sketches, ref);
  if (geometry.kind === "construction") return geometry;
  if (geometry.kind === "polyline" && geometry.points.length === 2)
    return { start: geometry.points[0], end: geometry.points[1] };
  throw new Error("Select a wall or a two-point sketch for this edit.");
}

function updateLine(
  plan: DraftPlanState,
  ref: LineRef,
  segment: Segment,
): PlanCommand[] {
  const changes = {
    start: modelPrecision(segment.start),
    end: modelPrecision(segment.end),
  };
  if (same(changes.start, changes.end))
    throw new Error("The edit would collapse a segment.");
  if (ref.kind === "sketch") {
    const geometry = lookup(plan.sketches, ref).geometry;
    return [
      {
        type: "sketch.update",
        id: ref.id,
        geometry:
          geometry.kind === "polyline"
            ? { ...geometry, points: [changes.start, changes.end] }
            : { kind: "construction", ...changes },
      },
    ];
  }
  const original = lookup(plan.walls, ref);
  const unit = direction(changes);
  const offset = (opening: {
    id: string;
    offsetMm: number;
    widthMm: number;
  }) => {
    const offsetMm = Math.round(
      dot(
        subtract(pointAlong(original, opening.offsetMm), changes.start),
        unit,
      ),
    );
    const [first, last] = doorBounds({ offsetMm, widthMm: opening.widthMm });
    if (first < 0 || last > wallLength(changes))
      throw new Error(
        "The edit would cut through or remove opening " +
          opening.id +
          " on wall " +
          original.id +
          ".",
      );
    return offsetMm;
  };
  const edits: PlanCommand[] = [{ type: "wall.update", id: ref.id, changes }];
  for (const door of plan.openings.filter((item) => item.wallId === ref.id))
    edits.push({
      type: "door.update",
      id: door.id,
      changes: { offsetMm: offset(door) },
    });
  for (const opening of (plan.windows ?? []).filter(
    (item) => item.wallId === ref.id,
  ))
    edits.push({
      type: "window.update",
      id: opening.id,
      changes: { offsetMm: offset(opening) },
    });
  return edits;
}

function offsetSegment(segment: Segment, amount: number): Segment {
  const { x, y } = direction(segment);
  const delta = { x: -y * amount, y: x * amount };
  return { start: add(segment.start, delta), end: add(segment.end, delta) };
}

function offsetSketch(
  geometry: SketchGeometry,
  amount: number,
): SketchGeometry {
  if (geometry.kind === "arc" || geometry.kind === "circle") {
    const radiusMm = geometry.radiusMm + amount;
    if (radiusMm < 1) throw new Error("Offset must leave a positive radius.");
    return { ...geometry, radiusMm };
  }
  if (geometry.kind === "construction") {
    const { start, end } = offsetSegment(geometry, amount);
    return {
      kind: "construction",
      start: modelPrecision(start),
      end: modelPrecision(end),
    };
  }
  const { points, closed } = geometry;
  const path = closed ? [...points, points[0]] : points;
  const offsets = path
    .slice(1)
    .map((end, i) => offsetSegment({ start: path[i], end }, amount));
  const newPoints = points.map((_, i) => {
    if (!closed && i === 0) return modelPrecision(offsets[0].start);
    if (!closed && i === points.length - 1)
      return modelPrecision(offsets.at(-1)!.end);
    const a = offsets[(i - 1 + offsets.length) % offsets.length];
    const b = offsets[i];
    const hit = meeting(a, b);
    if (!hit && dot(direction(a), direction(b)) < 0)
      throw new Error("A reversing polyline cannot be offset.");
    const join = hit?.point ?? b.start;
    if (norm(subtract(join, b.start)) > Math.abs(amount) * 12)
      throw new Error("This offset would create an excessively long miter.");
    return modelPrecision(join);
  });
  const segments = closed ? [...newPoints, newPoints[0]] : newPoints;
  for (let i = 0; i < offsets.length; i++) {
    const a = { start: segments[i], end: segments[i + 1] };
    if (dot(subtract(a.end, a.start), direction(offsets[i])) <= 0)
      throw new Error("This offset would reverse a polyline segment.");
    for (let j = 0; j < i - 1; j++) {
      if (closed && i === offsets.length - 1 && j === 0) continue;
      const hit = meeting(a, { start: segments[j], end: segments[j + 1] });
      if (hit && hit.t >= 0 && hit.t <= 1 && hit.u >= 0 && hit.u <= 1)
        throw new Error("This offset would introduce a crossing.");
    }
  }
  return { ...geometry, points: newPoints };
}

function sameStorey(plan: DraftPlanState, first: LineRef, second: LineRef) {
  const find = (ref: LineRef) =>
    ref.kind === "wall" ? lookup(plan.walls, ref) : lookup(plan.sketches, ref);
  const a = find(first);
  const b = find(second);
  if (storeyOf(a) !== storeyOf(b))
    throw new Error("CAD boundaries must be on the same storey.");
  return a.storeyId;
}

function cornerCommands(
  plan: DraftPlanState,
  input: Extract<CadEdit, { operation: "corner" }>,
  nextId: IdFactory,
) {
  const { first, second, mode, sizeMm } = input;
  if (first.kind !== second.kind || first.id === second.id)
    throw new Error(
      "Select two distinct walls or two distinct straight sketches.",
    );
  if (mode === "fillet" && first.kind === "wall")
    throw new Error(
      "Fillets apply to sketch linework. Use a chamfer for straight wall corners.",
    );
  const a = lineFor(plan, first);
  const storeyId = sameStorey(plan, first, second);
  const b = lineFor(plan, second);
  const aEnd = same(a.start, b.start) || same(a.start, b.end) ? "start" : "end";
  const vertex = a[aEnd];
  const bEnd = same(vertex, b.start) ? "start" : "end";
  if (!same(vertex, b[bEnd]))
    throw new Error("The two lines must share an endpoint.");
  const u = direction({ start: vertex, end: a[otherEnd(aEnd)] });
  const v = direction({ start: vertex, end: b[otherEnd(bEnd)] });
  if (Math.abs(cross(u, v)) < 1e-7)
    throw new Error("The corner needs two non-collinear edges.");
  const half = Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) / 2;
  const setback = mode === "fillet" ? sizeMm / Math.tan(half) : sizeMm;
  if (setback < 1 || setback >= Math.min(wallLength(a), wallLength(b)))
    throw new Error("The corner edit must fit on both segments.");
  const start = modelPrecision(add(vertex, scale(u, setback)));
  const end = modelPrecision(add(vertex, scale(v, setback)));
  if (same(start, end) || same(start, vertex) || same(end, vertex))
    throw new Error("The corner is too small at model precision.");
  const commands = [
    ...updateLine(plan, first, { ...a, [aEnd]: start }),
    ...updateLine(plan, second, { ...b, [bEnd]: end }),
  ];
  const id = nextId();
  if (first.kind === "wall") {
    const wall = lookup(plan.walls, first);
    const adjacent = lookup(plan.walls, second);
    if (
      wall.kind !== adjacent.kind ||
      wall.thicknessMm !== adjacent.thicknessMm
    )
      throw new Error(
        "The chamfer requires matching wall types and thicknesses.",
      );
    commands.push({
      type: "wall.add",
      wall: {
        id,
        start,
        end,
        kind: wall.kind,
        thicknessMm: wall.thicknessMm,
        storeyId,
        wallTypeId: wall.wallTypeId,
      },
    });
  } else {
    const geometry: SketchGeometry =
      mode === "chamfer"
        ? { kind: "construction", start, end }
        : connectorArc(start, end, vertex, sizeMm, u, v);
    commands.push({ type: "sketch.add", sketch: { id, geometry, storeyId } });
  }
  return commands;
}

// Resolve the arc from tangent points rounded to the model grid.
function connectorArc(
  a: Point,
  b: Point,
  vertex: Point,
  radius: number,
  u: Point,
  v: Point,
): SketchGeometry {
  const mid = scale(add(a, b), 0.5);
  const chord = subtract(b, a);
  const halfChord = norm(chord) / 2;
  const side = { x: -chord.y / (2 * halfChord), y: chord.x / (2 * halfChord) };
  const center = modelPrecision(
    add(
      mid,
      scale(
        side,
        Math.sign(dot(side, subtract(mid, vertex))) *
          Math.sqrt(Math.max(0, radius ** 2 - halfChord ** 2)),
      ),
    ),
  );
  const [start, end] = cross(u, v) < 0 ? [a, b] : [b, a];
  const startDeg = directionDegrees(center, start);
  const sweepDeg = normalizeDegrees(directionDegrees(center, end) - startDeg);
  return {
    kind: "arc",
    center,
    radiusMm: norm(subtract(center, start)),
    startDeg,
    sweepDeg,
  };
}

export function cadEditCommands(
  plan: DraftPlanState,
  input: CadEdit,
  nextId: IdFactory = () => crypto.randomUUID(),
): PlanCommand[] {
  switch (input.operation) {
    case "transform": {
      const t = input.transform;
      if (t.mode === "rotate")
        return transformEntities(
          plan,
          input.entities,
          rotation(t.pivot, t.angleDeg),
          false,
          nextId,
        );
      if (t.mode === "mirror")
        return transformEntities(
          plan,
          input.entities,
          reflection(t.axisStart, t.axisEnd),
          t.copy,
          nextId,
        );
      return transformEntities(
        plan,
        input.entities,
        translation(t.delta),
        t.mode === "copy",
        nextId,
      );
    }
    case "array": {
      const { pattern, count } = input;
      if (
        pattern.mode === "polar" &&
        Math.abs(pattern.stepDeg) * (count - 1) >= 360
      )
        throw new Error(
          "Polar copies must fit within one turn without duplicating the original.",
        );
      return Array.from({ length: count - 1 }, (_, i) => {
        const step = i + 1;
        const map =
          pattern.mode === "linear"
            ? translation(scale(pattern.step, step))
            : rotation(pattern.center, pattern.stepDeg * step);
        return transformEntities(plan, input.entities, map, true, nextId);
      }).flat();
    }
    case "offset": {
      const { entity, distanceMm, copy } = input;
      if (!distanceMm) throw new Error("Enter a nonzero offset.");
      if (entity.kind === "wall") {
        const wall = lookup(plan.walls, entity);
        const shifted = offsetSegment(wall, distanceMm);
        return transformEntities(
          plan,
          [entity],
          translation(subtract(shifted.start, wall.start)),
          copy,
          nextId,
        );
      }
      const sketch = lookup(plan.sketches, entity);
      const geometry = offsetSketch(sketch.geometry, distanceMm);
      return copy
        ? [
            {
              type: "sketch.add",
              sketch: { id: nextId(), geometry, storeyId: sketch.storeyId },
            },
          ]
        : [{ type: "sketch.update", id: entity.id, geometry }];
    }
    case "trim_extend": {
      sameStorey(plan, input.entity, input.boundary);
      const line = lineFor(plan, input.entity);
      const boundary = lineFor(plan, input.boundary);
      const hit = meeting(line, boundary);
      if (!hit || hit.u < -1e-8 || hit.u > 1 + 1e-8)
        throw new Error("The selected boundary does not intersect this line.");
      const t = input.endpoint === "start" ? hit.t : 1 - hit.t;
      const valid =
        input.mode === "trim" ? t > 1e-8 && t < 1 - 1e-8 : t < -1e-8;
      if (!valid)
        throw new Error(
          "The intersection is on the wrong side of the selected endpoint.",
        );
      return updateLine(plan, input.entity, {
        ...line,
        [input.endpoint]: hit.point,
      });
    }
    case "corner":
      return cornerCommands(plan, input, nextId);
  }
}
