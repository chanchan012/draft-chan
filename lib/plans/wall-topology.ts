import { compareText, type Point, type Room, type Wall } from "./model";
import { signedAreaMm2 } from "./polygon";

type Vector = { x: number; y: number };
type Vertex = {
  key: string;
  x: bigint;
  y: bigint;
  denominator: bigint;
  edges: HalfEdge[];
};
type Span = {
  start: Vertex;
  end: Vertex;
  wallIds: string[];
};
type HalfEdge = {
  from: Vertex;
  opposite: HalfEdge;
  direction: Vector;
  face?: number;
  next?: HalfEdge;
};
type Segment = {
  wall: Wall;
  direction: Vector;
  vertices: Map<string, Vertex>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
type Ring = { key: string; points: Vertex[]; polygon: Point[]; area: number };

const subtract = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vector, b: Vector) => a.x * b.y - a.y * b.x;

function gcd(a: bigint, b: bigint) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

function compareCoordinate(a: Vertex, b: Vertex, axis: "x" | "y") {
  const delta = a[axis] * b.denominator - b[axis] * a.denominator;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

function compareVertices(a: Vertex, b: Vertex) {
  return compareCoordinate(a, b, "x") || compareCoordinate(a, b, "y");
}

function orientation(a: Vertex, b: Vertex, c: Vertex) {
  const bx = b.x * a.denominator - a.x * b.denominator;
  const by = b.y * a.denominator - a.y * b.denominator;
  const cx = c.x * a.denominator - a.x * c.denominator;
  const cy = c.y * a.denominator - a.y * c.denominator;
  return bx * cy - by * cx;
}

function point(vertex: Vertex): Point {
  return {
    x: Number(vertex.x) / Number(vertex.denominator),
    y: Number(vertex.y) / Number(vertex.denominator),
  };
}

function withinBounds(p: Point, segment: Segment) {
  return (
    p.x >= segment.minX &&
    p.x <= segment.maxX &&
    p.y >= segment.minY &&
    p.y <= segment.maxY
  );
}

function traceFaces(edges: HalfEdge[]) {
  for (const edge of edges) delete edge.face;
  const walks: Vertex[][] = [];
  for (const first of edges) {
    if (first.face !== undefined) continue;
    const walk: Vertex[] = [];
    let edge = first;
    do {
      edge.face = walks.length;
      walk.push(edge.from);
      edge = edge.next!;
    } while (edge !== first);
    walks.push(walk);
  }
  return walks;
}

// A face walk can visit an articulation vertex more than once. Split it into
// simple boundary rings, retaining each ring's winding.
function boundaryRings(walk: Vertex[]) {
  const path: Vertex[] = [];
  const indices = new Map<Vertex, number>();
  const rings: Ring[] = [];
  for (const vertex of [...walk, walk[0]]) {
    const index = indices.get(vertex);
    if (index === undefined) {
      indices.set(vertex, path.length);
      path.push(vertex);
      continue;
    }
    const ring = path.slice(index);
    for (const removed of path.splice(index + 1)) indices.delete(removed);
    const corners = ring.filter(
      (v, i) =>
        orientation(
          ring[(i + ring.length - 1) % ring.length],
          v,
          ring[(i + 1) % ring.length],
        ) !== 0n,
    );
    if (corners.length < 3) continue;
    let first = 0;
    for (let i = 1; i < corners.length; i++) {
      if (compareVertices(corners[i], corners[first]) < 0) first = i;
    }
    const points = [...corners.slice(first), ...corners.slice(0, first)];
    const polygon = points.map(point);
    const magnitude = Math.abs(signedAreaMm2(polygon));
    const direction = orientation(points.at(-1)!, points[0], points[1]);
    rings.push({
      points,
      polygon,
      area: direction > 0n ? magnitude : -magnitude,
      key: points.map((p) => p.key).join(";"),
    });
  }
  return rings;
}

function classify(p: Vertex, ring: Vertex[]) {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const turn = orientation(a, b, p);
    const ay = compareCoordinate(a, p, "y");
    const by = compareCoordinate(b, p, "y");
    if (
      turn === 0n &&
      ay * by <= 0 &&
      compareCoordinate(a, p, "x") * compareCoordinate(b, p, "x") <= 0
    )
      return "boundary";
    if ((ay <= 0 && by > 0 && turn > 0n) || (by <= 0 && ay > 0 && turn < 0n)) {
      inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

function strictlyContains(outer: Ring, inner: Ring) {
  let someInside = false;
  for (const p of inner.points) {
    const location = classify(p, outer.points);
    if (location === "outside") return false;
    if (location === "inside") someInside = true;
  }
  return someInside;
}

export function solveWallTopology(walls: readonly Wall[]) {
  const vertices = new Map<string, Vertex>();
  function vertex(x: bigint, y: bigint, denominator = 1n) {
    const divisor = gcd(gcd(x, y), denominator) * (denominator < 0n ? -1n : 1n);
    x /= divisor;
    y /= divisor;
    denominator /= divisor;
    const key = denominator === 1n ? `${x},${y}` : `${x},${y}/${denominator}`;
    const existing = vertices.get(key);
    if (existing) return existing;
    const result = { key, x, y, denominator, edges: [] };
    vertices.set(key, result);
    return result;
  }

  function endpoint(p: Point) {
    return vertex(BigInt(p.x), BigInt(p.y));
  }

  const segments: Segment[] = walls
    .map((wall) => {
      const { start, end } = wall;
      const a = endpoint(start);
      const b = endpoint(end);
      return {
        wall,
        direction: subtract(end, start),
        vertices: new Map([
          [a.key, a],
          [b.key, b],
        ]),
        minX: Math.min(start.x, end.x),
        maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxY: Math.max(start.y, end.y),
      };
    })
    .sort((a, b) => a.minX - b.minX || compareText(a.wall.id, b.wall.id));

  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (
      let j = i + 1;
      j < segments.length && segments[j].minX <= a.maxX;
      j++
    ) {
      const b = segments[j];
      if (a.maxY < b.minY || b.maxY < a.minY) continue;
      const delta = subtract(b.wall.start, a.wall.start);
      const denominator = cross(a.direction, b.direction);
      const alongA = cross(delta, b.direction);
      const alongB = cross(delta, a.direction);
      if (denominator === 0) {
        if (alongB !== 0) continue;
        for (const [source, target] of [
          [a, b],
          [b, a],
        ]) {
          for (const p of [source.wall.start, source.wall.end]) {
            if (withinBounds(p, target)) {
              const v = endpoint(p);
              target.vertices.set(v.key, v);
            }
          }
        }
        continue;
      }
      const min = Math.min(0, denominator);
      const max = Math.max(0, denominator);
      if (alongA < min || alongA > max || alongB < min || alongB > max)
        continue;
      const d = BigInt(denominator);
      const t = BigInt(alongA);
      const v = vertex(
        BigInt(a.wall.start.x) * d + BigInt(a.direction.x) * t,
        BigInt(a.wall.start.y) * d + BigInt(a.direction.y) * t,
        d,
      );
      a.vertices.set(v.key, v);
      b.vertices.set(v.key, v);
    }
  }

  const segmentsByEndpoints = new Map<string, Span>();
  const halfEdges: HalfEdge[] = [];
  for (const segment of segments) {
    const split = [...segment.vertices.values()].sort(compareVertices);
    const { x, y } = segment.direction;
    // The sorted vertex order is `+x`, or `+y` for a vertical line.
    const sign = x < 0 || (x === 0 && y < 0) ? -1 : 1;
    for (let i = 1; i < split.length; i++) {
      const start = split[i - 1];
      const end = split[i];
      const key = `${start.key};${end.key}`;
      const existing = segmentsByEndpoints.get(key);
      if (existing) {
        existing.wallIds.push(segment.wall.id);
        continue;
      }
      segmentsByEndpoints.set(key, { start, end, wallIds: [segment.wall.id] });
      const forward = {
        from: start,
        direction: { x: x * sign, y: y * sign },
      } as HalfEdge;
      const reverse = {
        from: end,
        direction: { x: -x * sign, y: -y * sign },
        opposite: forward,
      };
      forward.opposite = reverse;
      start.edges.push(forward);
      end.edges.push(reverse);
      halfEdges.push(forward, reverse);
    }
  }

  function linkFaces() {
    for (const v of vertices.values()) {
      const edges = v.edges;
      for (let i = 0; i < edges.length; i++) {
        edges[i].opposite.next = edges[(i + edges.length - 1) % edges.length];
      }
    }
  }
  function half({ x, y }: Vector) {
    return y > 0 || (y === 0 && x >= 0) ? 0 : 1;
  }
  for (const v of vertices.values()) {
    v.edges.sort(
      (a, b) =>
        half(a.direction) - half(b.direction) ||
        -cross(a.direction, b.direction),
    );
  }
  linkFaces();
  traceFaces(halfEdges);

  // Both directions of a bridge border the same face. Keep it in the drawing
  // spans and leave it out of room boundaries.
  const onBoundary = (edge: HalfEdge) => edge.face !== edge.opposite.face;
  const boundary = halfEdges.filter(onBoundary);
  const bounded = new Set(
    boundary.map((edge) => edge.from.key + ";" + edge.opposite.from.key),
  );
  for (const v of vertices.values()) v.edges = v.edges.filter(onBoundary);
  linkFaces();
  const rings = traceFaces(boundary).flatMap(boundaryRings);
  const outerRings = rings
    .filter((ring) => ring.area > 0)
    .sort((a, b) => a.area - b.area || compareText(a.key, b.key));
  const holeRings = rings
    .filter((ring) => ring.area < 0)
    .sort((a, b) => compareText(a.key, b.key));
  const holes = new Map<Ring, Point[][]>();
  for (const hole of holeRings) {
    const outer = outerRings.find(
      (ring) => ring.area > -hole.area && strictlyContains(ring, hole),
    );
    if (!outer) continue;
    const cutouts = holes.get(outer) ?? [];
    cutouts.push(hole.polygon);
    holes.set(outer, cutouts);
  }
  const rooms: Room[] = outerRings
    .map((ring) => {
      const cutouts = holes.get(ring);
      return {
        id: "room:" + ring.key,
        polygon: ring.polygon,
        ...(cutouts ? { holes: cutouts } : {}),
      };
    })
    .sort((a, b) => compareText(a.id, b.id));
  const spans = [...segmentsByEndpoints.values()]
    .sort(
      (a, b) =>
        compareVertices(a.start, b.start) || compareVertices(a.end, b.end),
    )
    .map(({ start, end, wallIds }) => ({
      start: point(start),
      end: point(end),
      wallIds: wallIds.sort(compareText),
    }));
  const boundarySpans = [...segmentsByEndpoints.values()]
    .filter(({ start, end }) => bounded.has(start.key + ";" + end.key))
    .map(({ start, end, wallIds }) => ({
      start: point(start),
      end: point(end),
      wallIds,
    }));
  return { rooms, spans, boundarySpans };
}
