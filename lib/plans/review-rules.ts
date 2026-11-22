import polygonClipping from "polygon-clipping";
import { clipPolygon, drawingArea, drawingPolygons } from "./clipping";
import {
  coordinationEdition,
  coordinationFinding,
  findClashes,
  segmentAgainstPlanPolygon,
} from "./coordination";
import {
  bounds,
  boundsMeet,
  fixtureFootprint,
  wallMaterialCenter,
  wallMaterialFootprint,
} from "./footprints";
import {
  coordinationFindingInput,
  reviewPackId,
  type ApproachCheck,
  type CoordinationFinding,
  type CoordinationIssue,
  type CoordinationSubject,
  type DraftPlanState,
  type EgressPath,
  type Point,
  type RuleProfile,
  type TurningCheck,
} from "./model";
import { doorSwing, pointAlong, wallRuns } from "./openings";
import { inRoom } from "./polygon";
import { planStoreys, storeyById, storeyOf, storeyPlan } from "./storeys";

const ada = "https://www.ada.gov/law-and-regs/design-standards/2010-stds/";
const ibc =
  "https://codes.iccsafe.org/s/IBC2021P1/chapter-10-means-of-egress/IBC2021P1-Ch10-Sec1017.2";
export const rulePack = {
  id: reviewPackId,
  label: "US model codes",
  version: 1,
  sources: [
    { edition: "2021 International Building Code", url: ibc },
    { edition: "2010 ADA Standards for Accessible Design", url: ada },
  ],
} as const;

const references = {
  travel: { rule: "IBC 1017.2", edition: "2021 IBC · Draft v1", source: ibc },
  continuity: {
    rule: "Egress path continuity",
    edition: "Draft review v1",
    source: ibc,
  },
  approach: {
    rule: "ADA 404.2.4.1",
    edition: "2010 ADA · Draft v1",
    source: ada,
  },
  turning: { rule: "ADA 304.3.1", edition: "2010 ADA · Draft v1", source: ada },
};

type Value = string | number | boolean | null;
type RuleStatus = "pass" | "fail" | "needs_input";
type RuleResult = {
  status: RuleStatus;
  rule: string;
  edition: string;
  source: string;
  storeyId: string;
  title: string;
  detail: string;
  inputs: Record<string, Value>;
  subjects: CoordinationSubject[];
  unresolved?: string[];
  finding?: CoordinationFinding;
};
type Barrier = { subject: CoordinationSubject; name: string; polygon: Point[] };
const round = (n: number) => Math.round(n * 10) / 10;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function offset(point: Point, vector: Point, amount: number): Point {
  return { x: point.x + vector.x * amount, y: point.y + vector.y * amount };
}
const along = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function barriers(plan: DraftPlanState): Barrier[] {
  return [
    ...plan.walls.flatMap((wall): Barrier[] =>
      wallRuns(wall, plan.openings).map((run) => ({
        subject: { kind: "wall", id: wall.id },
        name: "wall",
        polygon: wallMaterialFootprint(wall, run),
      })),
    ),
    ...plan.fixtures.map(
      (item): Barrier => ({
        subject: { kind: "fixture", id: item.id },
        name: item.template,
        polygon: fixtureFootprint(item),
      }),
    ),
  ];
}

function hostedDoor(plan: DraftPlanState, id: string) {
  const door = plan.openings.find((item) => item.id === id);
  const wall = door && plan.walls.find((item) => item.id === door.wallId);
  return door && wall ? { door, wall } : undefined;
}

export function egressPoints(plan: DraftPlanState, path: EgressPath) {
  const host = hostedDoor(plan, path.exitDoorId);
  if (!host || storeyOf(host.wall) !== path.storeyId)
    return [...path.waypoints];
  const wall = { ...host.wall, ...wallMaterialCenter(host.wall) };
  const terminal = pointAlong(wall, host.door.offsetMm);
  return [...path.waypoints, terminal];
}

export function traceEgress(
  plan: DraftPlanState,
  path: EgressPath,
  solids = barriers(storeyPlan(plan, path.storeyId)),
) {
  const host = hostedDoor(plan, path.exitDoorId);
  const points = egressPoints(plan, path);
  const measuredMm = points
    .slice(1)
    .reduce((sum, point, i) => sum + distance(points[i], point), 0);
  const unresolved: string[] = [];
  if (!host || storeyOf(host.wall) !== path.storeyId)
    unresolved.push("exitDoor");
  const start = path.waypoints[0];
  if (
    !start ||
    !plan.rooms.some(
      (room) => storeyOf(room) === path.storeyId && inRoom(room, start),
    )
  )
    unresolved.push("startInEnclosedRoom");
  if (measuredMm < 1) unresolved.push("measurablePath");
  const obstructions = new Map<
    string,
    {
      subject: CoordinationSubject;
      point: Point;
      segment: number;
      name: string;
      outline: Point[];
    }
  >();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    for (const solid of solids) {
      const key = solid.subject.kind + ":" + solid.subject.id;
      if (
        obstructions.has(key) ||
        !boundsMeet(bounds([a, b]), bounds(solid.polygon))
      )
        continue;
      const t = segmentAgainstPlanPolygon(a, b, [solid.polygon]);
      if (t !== undefined)
        obstructions.set(key, {
          subject: solid.subject,
          point: along(a, b, t),
          segment: i - 1,
          name: solid.name,
          outline: solid.polygon,
        });
    }
  }
  return {
    points,
    measuredMm: round(measuredMm),
    unresolved,
    obstructions: [...obstructions.values()],
  };
}

function evidence(
  base: Pick<
    RuleResult,
    "rule" | "edition" | "storeyId" | "title" | "detail" | "subjects"
  >,
  at: Point,
  z: number,
  extra: Pick<
    CoordinationFinding,
    "outline" | "measuredMm" | "requiredMm"
  > = {},
) {
  const { rule, edition, storeyId, title, detail, subjects } = base;
  return coordinationFinding({
    rule,
    edition,
    storeyId,
    title,
    detail,
    subjects,
    ...extra,
    point: { x: at.x, y: at.y, z },
  });
}

function checkEgress(
  plan: DraftPlanState,
  path: EgressPath,
  profile: RuleProfile | undefined,
  solids: Barrier[],
): RuleResult[] {
  const input = traceEgress(plan, path, solids);
  const { storeyId } = path;
  const z = storeyById(plan, storeyId).elevationMm;
  const subjects: CoordinationSubject[] = [
    { kind: "egress", id: path.id },
    { kind: "door", id: path.exitDoorId },
  ];
  const obstruction = input.obstructions[0];
  const continuity: RuleResult = {
    ...references.continuity,
    storeyId,
    subjects: obstruction ? [...subjects, obstruction.subject] : subjects,
    title: path.name + " · path continuity",
    detail: obstruction
      ? "The route crosses modeled " + obstruction.name + " geometry."
      : input.unresolved.length
        ? "Choose an enclosed start and a same-storey exit door."
        : "The route reaches the designated exit without crossing modeled obstructions.",
    status: obstruction
      ? "fail"
      : input.unresolved.length
        ? "needs_input"
        : "pass",
    inputs: { waypoints: path.waypoints.length, exitDoorId: path.exitDoorId },
    unresolved: input.unresolved,
  };
  if (obstruction)
    continuity.finding = evidence(continuity, obstruction.point, z, {
      outline: obstruction.outline,
    });
  const travel: RuleResult = {
    ...references.travel,
    storeyId,
    subjects,
    title: path.name + " · travel distance",
    status: "needs_input",
    detail: "Specify an occupancy group and a qualifying sprinkler system.",
    inputs: {
      profile: profile?.pack ?? reviewPackId,
      jurisdiction: profile?.jurisdiction ?? null,
      occupancy: profile?.occupancy ?? null,
      sprinkler: profile?.sprinkler ?? null,
      measuredMm: input.measuredMm,
    },
  };
  const occupancy = profile?.occupancy;
  const sprinkler = profile?.sprinkler;
  const unresolved = [
    ...(!occupancy ? ["occupancy"] : []),
    ...(!sprinkler ? ["sprinkler"] : []),
    ...input.unresolved,
  ];
  if (unresolved.length) return [continuity, { ...travel, unresolved }];
  if (
    (occupancy === "B" && sprinkler === "nfpa13r") ||
    (occupancy === "R-2" && sprinkler === "none")
  )
    return [
      continuity,
      {
        ...travel,
        detail: "Confirm a qualifying sprinkler design for this occupancy.",
        unresolved: ["qualifyingSprinkler"],
      },
    ];
  if (obstruction)
    return [
      continuity,
      {
        ...travel,
        detail:
          "Clear the modeled obstruction before evaluating travel distance.",
        unresolved: ["continuousPath"],
      },
    ];
  const feet = occupancy === "B" ? (sprinkler === "nfpa13" ? 300 : 200) : 250;
  const requiredMm = feet * 304.8;
  travel.inputs.maximumMm = requiredMm;
  travel.status = input.measuredMm > requiredMm + 0.001 ? "fail" : "pass";
  travel.detail =
    "The authored route measures " +
    input.measuredMm +
    " mm. The selected Table 1017.2 limit is " +
    requiredMm +
    " mm.";
  if (travel.status === "fail")
    travel.finding = evidence(travel, path.waypoints[0], z, {
      measuredMm: input.measuredMm,
      requiredMm,
    });
  return [continuity, travel];
}

function checkApproach(
  plan: DraftPlanState,
  check: ApproachCheck,
  solids: Barrier[],
): RuleResult {
  const target = hostedDoor(plan, check.doorId);
  const subjects: CoordinationSubject[] = [
    { kind: "approach", id: check.id },
    { kind: "door", id: check.doorId },
  ];
  const base = {
    ...references.approach,
    storeyId: check.storeyId,
    subjects,
    title: check.name,
    inputs: {
      side: check.side,
      doorId: check.doorId,
      closerAndLatch: check.closerAndLatch ?? null,
    },
  };
  if (!target || storeyOf(target.wall) !== check.storeyId)
    return {
      ...base,
      status: "needs_input",
      detail: "Select a door on this storey.",
      unresolved: ["door"],
    };
  if (check.side === "front-push" && check.closerAndLatch === undefined)
    return {
      ...base,
      status: "needs_input",
      detail: "Specify whether the door has both a closer and a latch.",
      unresolved: ["closerAndLatch"],
    };
  const { hinge, closed, leaf } = doorSwing(target.wall, target.door);
  const width = target.door.widthMm;
  const pull = check.side === "front-pull";
  const depth = pull ? 1525 : 1220;
  const latch = pull ? 455 : check.closerAndLatch ? 305 : 0;
  const axis = {
    x: (closed.x - hinge.x) / width,
    y: (closed.y - hinge.y) / width,
  };
  const toward = {
    x: ((leaf.x - hinge.x) / width) * (pull ? 1 : -1),
    y: ((leaf.y - hinge.y) / width) * (pull ? 1 : -1),
  };
  const a = offset(hinge, toward, target.wall.thicknessMm / 2);
  const b = offset(a, axis, width + latch);
  const outline = [a, b, offset(b, toward, depth), offset(a, toward, depth)];
  const box = bounds(outline);
  const blocker = solids.find(
    (solid) =>
      (solid.subject.kind !== "wall" || solid.subject.id !== target.wall.id) &&
      boundsMeet(box, bounds(solid.polygon)) &&
      drawingArea(
        drawingPolygons(
          polygonClipping.intersection(
            clipPolygon([outline]),
            clipPolygon([solid.polygon]),
          ),
        ),
      ) > 0.01,
  );
  const status = blocker ? "fail" : "pass";
  const result: RuleResult = {
    ...base,
    status,
    subjects: blocker ? [...subjects, blocker.subject] : subjects,
    inputs: {
      ...base.inputs,
      depthMm: depth,
      latchSideMm: latch,
      openingWidthMm: width,
    },
    detail: blocker
      ? "The front approach is obstructed by modeled " + blocker.name + "."
      : "The modeled front approach has " +
        depth +
        " mm depth and " +
        latch +
        " mm beyond the latch.",
  };
  if (blocker)
    result.finding = evidence(
      result,
      offset(a, axis, width / 2),
      storeyById(plan, check.storeyId).elevationMm,
      { outline, requiredMm: depth },
    );
  return result;
}

function checkTurning(
  plan: DraftPlanState,
  check: TurningCheck,
  solids: Barrier[],
): RuleResult {
  const radius = 1525 / 2;
  const { center } = check;
  const box = bounds([
    { x: center.x - radius, y: center.y - radius },
    { x: center.x + radius, y: center.y + radius },
  ]);
  const blocker = solids.find(
    (solid) =>
      boundsMeet(box, bounds(solid.polygon)) &&
      segmentAgainstPlanPolygon(
        center,
        center,
        [solid.polygon],
        radius - 0.0005,
      ) !== undefined,
  );
  const subjects: CoordinationSubject[] = [{ kind: "turning", id: check.id }];
  if (blocker) subjects.push(blocker.subject);
  const result: RuleResult = {
    ...references.turning,
    title: check.name,
    status: blocker ? "fail" : "pass",
    storeyId: check.storeyId,
    inputs: { diameterMm: 1525, x: center.x, y: center.y },
    subjects,
    detail: blocker
      ? "Modeled " +
        blocker.name +
        " geometry intrudes into the 1525 mm turning circle."
      : "The modeled 1525 mm turning circle is clear.",
  };
  if (blocker) {
    const outline = Array.from({ length: 32 }, (_, i) => {
      const angle = (i * 2 * Math.PI) / 32;
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    });
    result.finding = evidence(
      result,
      center,
      storeyById(plan, check.storeyId).elevationMm,
      { outline, requiredMm: 1525 },
    );
  }
  return result;
}

export function evaluateRuleSet(plan: DraftPlanState, storeyId?: string) {
  const items = plan.coordination ?? [];
  const checks: RuleResult[] = [];
  for (const level of planStoreys(plan)) {
    if (storeyId && level.id !== storeyId) continue;
    const local = items.filter(
      (item) => item.kind !== "issue" && item.storeyId === level.id,
    );
    const profile = local.find(
      (item): item is RuleProfile => item.kind === "profile",
    );
    const authoredChecks = local.filter(
      (item) => item.kind === "egress" || item.kind === "approach" || item.kind === "turning",
    );
    if (!authoredChecks.length) continue;
    const solids = barriers(storeyPlan(plan, level.id));
    for (const item of authoredChecks) {
      if (item.kind === "egress")
        checks.push(...checkEgress(plan, item, profile, solids));
      else if (item.kind === "approach")
        checks.push(checkApproach(plan, item, solids));
      else checks.push(checkTurning(plan, item, solids));
    }
  }
  return {
    pack: rulePack,
    checks,
    findings: checks.flatMap(({ finding }) => (finding ? [finding] : [])),
  };
}

export function findingAtRevision(plan: DraftPlanState, key: string) {
  const set = key.startsWith("[" + JSON.stringify(coordinationEdition) + ",")
    ? findClashes(plan)
    : evaluateRuleSet(plan);
  return set.findings.find((finding) => finding.key === key);
}

export function reproduceCoordinationIssue(
  plan: DraftPlanState,
  issue: CoordinationIssue,
) {
  const isClash = issue.finding.edition === coordinationEdition;
  const check = isClash
    ? undefined
    : evaluateRuleSet(plan, issue.finding.storeyId).checks.find(
        (item) => item.finding?.key === issue.finding.key,
      );
  const finding = isClash
    ? findingAtRevision(plan, issue.finding.key)
    : check?.finding;
  if (!finding) return null;
  return {
    finding,
    matches:
      JSON.stringify(coordinationFindingInput.parse(finding)) ===
      JSON.stringify(coordinationFindingInput.parse(issue.finding)),
    ...(check && { inputs: check.inputs, source: check.source }),
  };
}
