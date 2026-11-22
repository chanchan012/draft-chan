import { slabPolygons, validateRing } from "./building";
import { utilityCatalog } from "./catalog";
import {
  bounds,
  boundsMeet,
  fixtureFootprint,
  wallMaterialFootprint,
} from "./footprints";
import {
  compareText,
  type CoordinationFinding,
  type CoordinationIssue,
  type CoordinationSubject,
  type DraftPlanState,
  type Point,
  type ServiceRoute,
} from "./model";
import { doorBounds, pointAlong, wallRuns } from "./openings";
import { inRoom } from "./polygon";
import { planStoreys, storeyById, storeyOf } from "./storeys";

type Point3 = Point & { z: number };
type Segment = { a: Point3; b: Point3 };
type Prism = {
  subject: CoordinationSubject;
  name: string;
  storeyId: string;
  rings: Point[][];
  bottom: number;
  top: number;
  box: ReturnType<typeof bounds>;
};

export const coordinationEdition = "Draft coordination 1.0";
const epsilon = 1e-7;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const difference = (a: Point3, b: Point3) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const at = ({ a, b }: Segment, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
const distance = (a: Point3, b: Point3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flatten = (point: Point): Point3 => ({ x: point.x, y: point.y, z: 0 });
const rounded = (n: number) => Math.round(n * 10) / 10;

function nearest(left: Segment, right: Segment) {
  const u = difference(left.b, left.a);
  const v = difference(right.b, right.a);
  const origin = difference(left.a, right.a);
  const uu = dot(u, u);
  const vv = dot(v, v);
  const uv = dot(u, v);
  const uo = dot(u, origin);
  const vo = dot(v, origin);
  let s = 0;
  let t = 0;
  if (uu <= epsilon) t = vv <= epsilon ? 0 : clamp(vo / vv);
  else if (vv <= epsilon) s = clamp(-uo / uu);
  else {
    const determinant = uu * vv - uv * uv;
    if (determinant > epsilon) s = clamp((uv * vo - uo * vv) / determinant);
    t = (uv * s + vo) / vv;
    if (t < 0) {
      t = 0;
      s = clamp(-uo / uu);
    } else if (t > 1) {
      t = 1;
      s = clamp((uv - uo) / uu);
    }
  }
  const a = at(left, s);
  const b = at(right, t);
  return { a, b, s, t, distance: distance(a, b) };
}

export function routePoints(
  plan: DraftPlanState,
  route: ServiceRoute,
): Point3[] {
  const markers = new Map(plan.utilities.map((item) => [item.id, item]));
  const levels = new Map(
    planStoreys(plan).map((item) => [item.id, item.elevationMm]),
  );
  return route.nodes.map((node) => {
    if (node.kind === "point")
      return {
        ...node.point,
        z: storeyById(plan, route.storeyId).elevationMm + node.zMm,
      };
    const marker = markers.get(node.utilityId);
    if (!marker || utilityCatalog[marker.template].layer !== route.system)
      throw new Error(
        "Connect " + route.name + " to existing " + route.system + " symbols.",
      );
    return {
      ...marker.position,
      z: (levels.get(storeyOf(marker)) ?? 0) + node.zMm,
    };
  });
}

export function validateCoordination(plan: DraftPlanState) {
  const items = plan.coordination ?? [];
  if (new Set(items.map(({ id }) => id)).size !== items.length)
    throw new Error("Coordination IDs must be unique.");
  let legs = 0;
  const definedProfiles = new Set<string>();
  for (const item of items) {
    if (item.kind === "issue") continue;
    storeyById(plan, item.storeyId);
    if (item.kind === "route") {
      const points = routePoints(plan, item);
      legs += points.length - 1;
      if (points.some((point, i) => i && distance(point, points[i - 1]) < 1))
        throw new Error(
          "Adjacent service route points must differ by at least 1 mm.",
        );
    } else if (item.kind === "zone") {
      validateRing(item.polygon, item.name);
      if (item.topMm <= item.bottomMm)
        throw new Error("An equipment zone must have positive height.");
    }
    if (item.kind === "profile") {
      if (definedProfiles.has(item.storeyId))
        throw new Error("Keep one rule profile per storey.");
      definedProfiles.add(item.storeyId);
    }
    if (
      item.kind === "egress" &&
      item.waypoints.some(
        (point, i) =>
          i > 0 &&
          point.x === item.waypoints[i - 1].x &&
          point.y === item.waypoints[i - 1].y,
      )
    )
      throw new Error("Adjacent egress waypoints must be distinct.");
  }
  if (legs > 768)
    throw new Error("This plan can contain up to 768 service route segments.");
}

function obstacles(plan: DraftPlanState): Prism[] {
  const levels = new Map(planStoreys(plan).map((item) => [item.id, item]));
  const output: Prism[] = [];
  function add(
    subject: CoordinationSubject,
    name: string,
    storeyId: string,
    rings: Point[][],
    bottom: number,
    top: number,
  ) {
    if (top <= bottom) return;
    output.push({
      subject,
      name,
      storeyId,
      rings,
      bottom,
      top,
      box: bounds(rings[0]),
    });
  }
  for (const item of plan.buildingElements ?? []) {
    if (item.kind !== "slab") continue;
    const top = levels.get(item.storeyId)!.elevationMm + item.offsetMm;
    for (const rings of slabPolygons(plan, item))
      add(
        { kind: "slab", id: item.id },
        item.name,
        item.storeyId,
        rings,
        top - item.thicknessMm,
        top,
      );
  }
  for (const item of plan.coordination ?? []) {
    if (item.kind !== "zone") continue;
    const level = levels.get(item.storeyId)!;
    add(
      { kind: "zone", id: item.id },
      item.name,
      item.storeyId,
      [item.polygon],
      level.elevationMm + item.bottomMm,
      level.elevationMm + item.topMm,
    );
  }
  for (const fixture of plan.fixtures) {
    const level = levels.get(storeyOf(fixture))!;
    add(
      { kind: "fixture", id: fixture.id },
      fixture.template,
      level.id,
      [fixtureFootprint(fixture)],
      level.elevationMm,
      level.elevationMm + fixture.heightMm,
    );
  }
  const openings = [...plan.openings, ...(plan.windows ?? [])];
  for (const wall of plan.walls) {
    const level = levels.get(storeyOf(wall))!;
    const bottom = level.elevationMm;
    const top = bottom + level.wallHeightMm;
    const subject = { kind: "wall" as const, id: wall.id };
    const hosted = openings.filter((opening) => opening.wallId === wall.id);
    for (const run of wallRuns(wall, hosted))
      add(
        subject,
        "Wall",
        level.id,
        [wallMaterialFootprint(wall, run)],
        bottom,
        top,
      );
    for (const opening of hosted) {
      const [from, to] = doorBounds(opening);
      const footprint = wallMaterialFootprint(wall, {
        start: pointAlong(wall, from),
        end: pointAlong(wall, to),
      });
      const sill = "sillMm" in opening ? opening.sillMm : 0;
      const head =
        "heightMm" in opening
          ? sill + opening.heightMm
          : Math.min(2100, level.wallHeightMm);
      add(subject, "Wall", level.id, [footprint], bottom, bottom + sill);
      add(subject, "Wall", level.id, [footprint], bottom + head, top);
    }
  }
  return output;
}

function hitPrism(segment: Segment, radius: number, solid: Prism) {
  if (!boundsMeet(bounds([segment.a, segment.b]), solid.box, radius)) return;
  const low = solid.bottom - radius;
  const high = solid.top + radius;
  const dz = segment.b.z - segment.a.z;
  const min = Math.min(segment.a.z, segment.b.z);
  const max = Math.max(segment.a.z, segment.b.z);
  if (max < low - epsilon || min > high + epsilon) return;
  const t1 =
    Math.abs(dz) < epsilon
      ? 0
      : clamp(Math.min((low - segment.a.z) / dz, (high - segment.a.z) / dz));
  const t2 =
    Math.abs(dz) < epsilon
      ? 1
      : clamp(Math.max((low - segment.a.z) / dz, (high - segment.a.z) / dz));
  const a = at(segment, t1);
  const b = at(segment, t2);
  const hit = segmentAgainstPlanPolygon(a, b, solid.rings, radius);
  return hit === undefined ? undefined : at({ a, b }, hit);
}

export function segmentAgainstPlanPolygon(
  a: Point,
  b: Point,
  rings: Point[][],
  radius = 0,
) {
  const [polygon, ...holes] = rings;
  if (inRoom({ id: "", polygon, holes }, a)) return 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const edge = {
        a: flatten(ring[i]),
        b: flatten(ring[(i + 1) % ring.length]),
      };
      const result = nearest({ a: flatten(a), b: flatten(b) }, edge);
      if (result.distance <= radius + epsilon) return result.s;
    }
  }
  if (inRoom({ id: "", polygon, holes }, b)) return 1;
}

function pathSegments(plan: DraftPlanState, route: ServiceRoute) {
  const points = routePoints(plan, route);
  return points.slice(1).map((b, i) => ({
    a: points[i],
    b,
    startNode: route.nodes[i],
    endNode: route.nodes[i + 1],
  }));
}

export function coordinationFinding(input: Omit<CoordinationFinding, "key">) {
  return {
    ...input,
    key: JSON.stringify([
      input.edition,
      input.rule,
      ...input.subjects.map(({ kind, id }) => [kind, id]),
    ]),
    point: {
      x: rounded(input.point.x),
      y: rounded(input.point.y),
      z: rounded(input.point.z),
    },
  };
}

export function findClashes(plan: DraftPlanState, onlyStorey?: string) {
  const systems = (plan.coordination ?? [])
    .filter((item): item is ServiceRoute => item.kind === "route")
    .slice()
    .sort((a, b) => compareText(a.id, b.id))
    .map((route) => ({
      route,
      radius: route.diameterMm / 2,
      segments: pathSegments(plan, route),
    }));
  const solids = obstacles(plan);
  const findings = new Map<string, CoordinationFinding>();
  let truncated = false;
  function report(value: Omit<CoordinationFinding, "key" | "edition">) {
    if (onlyStorey && onlyStorey !== value.storeyId) return;
    const finding = coordinationFinding({
      ...value,
      edition: coordinationEdition,
    });
    if (findings.has(finding.key)) return;
    if (findings.size >= 200) truncated = true;
    else findings.set(finding.key, finding);
  }
  for (let i = 0; i < systems.length; i++) {
    const { route, radius, segments } = systems[i];
    const first = { kind: "route" as const, id: route.id };
    for (const solid of solids) {
      if (onlyStorey && solid.storeyId !== onlyStorey) continue;
      for (const segment of segments) {
        const point = hitPrism(segment, radius, solid);
        if (!point) continue;
        report({
          rule: "service-" + solid.subject.kind,
          storeyId: solid.storeyId,
          title: route.name + " intersects " + solid.name,
          detail:
            "The route envelope intersects the modeled " +
            solid.subject.kind +
            " volume.",
          subjects: [first, solid.subject],
          point,
          ...(solid.rings[0].length <= 64 ? { outline: solid.rings[0] } : {}),
        });
        break;
      }
      if (truncated) return { findings: [...findings.values()], truncated };
    }
    for (const other of systems.slice(i + 1)) {
      const clearance = radius + other.radius;
      for (const a of segments)
        for (const b of other.segments) {
          if (!boundsMeet(bounds([a.a, a.b]), bounds([b.a, b.b]), clearance))
            continue;
          const result = nearest(a, b);
          if (result.distance >= clearance - epsilon) continue;
          const firstNode =
            result.s < epsilon
              ? a.startNode
              : result.s > 1 - epsilon
                ? a.endNode
                : undefined;
          const nextNode =
            result.t < epsilon
              ? b.startNode
              : result.t > 1 - epsilon
                ? b.endNode
                : undefined;
          if (
            firstNode?.kind === "utility" &&
            nextNode?.kind === "utility" &&
            firstNode.utilityId === nextNode.utilityId &&
            Math.abs(result.a.z - result.b.z) < epsilon
          )
            continue;
          report({
            rule: "service-route",
            storeyId: route.storeyId,
            title: route.name + " intersects " + other.route.name,
            detail:
              "The 3D centreline separation is less than the sum of the route radii.",
            subjects: [first, { kind: "route", id: other.route.id }],
            point: result.a,
            measuredMm: rounded(result.distance),
            requiredMm: clearance,
          });
          if (truncated) return { findings: [...findings.values()], truncated };
        }
    }
  }
  return { findings: [...findings.values()], truncated };
}

export function issueFromFinding(
  plan: DraftPlanState,
  finding: CoordinationFinding,
  sourceRevision: number,
  note = "",
): CoordinationIssue {
  if (
    plan.coordination?.some(
      (item) =>
        item.kind === "issue" &&
        item.status === "open" &&
        item.sourceRevision === sourceRevision &&
        item.finding.key === finding.key,
    )
  )
    throw new Error(
      "An open issue already records this finding at that revision.",
    );
  return {
    kind: "issue",
    id: crypto.randomUUID(),
    status: "open",
    finding,
    sourceRevision,
    note,
  };
}
