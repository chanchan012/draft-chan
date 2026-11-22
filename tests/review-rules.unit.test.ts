import { describe, expect, it } from "vitest";
import { issueFromFinding } from "../lib/plans/coordination";
import {
  evaluateRuleSet,
  reproduceCoordinationIssue,
  traceEgress,
} from "../lib/plans/review-rules";
import { reviewFixture } from "./review-fixture";

describe("versioned code review", () => {
  it("follows a relocated exit and reports exact model length and obstructions", () => {
    const plan = reviewFixture();
    const path = plan.coordination?.find((item) => item.kind === "egress");
    if (!path) throw new Error("Missing test path");
    expect(traceEgress(plan, path)).toMatchObject({
      measuredMm: 2500,
      points: [
        { x: 3000, y: 2500 },
        { x: 3000, y: 0 },
      ],
      obstructions: [],
      unresolved: [],
    });
    plan.openings[0].offsetMm = 3100;
    plan.fixtures[0].position = { x: 3100, y: 900 };
    expect(traceEgress(plan, path)).toMatchObject({
      points: [
        { x: 3000, y: 2500 },
        { x: expect.closeTo(3100, 8), y: 0 },
      ],
      obstructions: [
        {
          subject: { kind: "fixture", id: "approach-obstruction" },
          segment: 0,
        },
      ],
    });
    plan.openings = [];
    expect(traceEgress(plan, path).unresolved).toContain("exitDoor");
  });

  it("uses declared occupancy and sprinkler design for the travel-distance limit", () => {
    const plan = reviewFixture();
    const travel = () =>
      evaluateRuleSet(plan).checks.find((check) => check.rule === "IBC 1017.2");
    const profile = plan.coordination?.find((item) => item.kind === "profile");
    if (!profile) throw new Error("Missing test profile");
    expect(travel()).toMatchObject({
      status: "needs_input",
      unresolved: ["occupancy"],
    });
    profile.occupancy = "B";
    expect(travel()).toMatchObject({
      status: "pass",
      inputs: { maximumMm: 60960 },
    });
    profile.sprinkler = "nfpa13";
    expect(travel()).toMatchObject({
      status: "pass",
      inputs: { maximumMm: 91440 },
    });
    profile.occupancy = "R-2";
    profile.sprinkler = "nfpa13r";
    expect(travel()).toMatchObject({
      status: "pass",
      inputs: { maximumMm: 76200 },
    });
    profile.sprinkler = "none";
    expect(travel()).toMatchObject({
      status: "needs_input",
      unresolved: ["qualifyingSprinkler"],
    });
  });

  it("screens ADA pull, push and turning geometry and replays original evidence", () => {
    const plan = reviewFixture();
    const { checks, findings } = evaluateRuleSet(plan);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "ADA 404.2.4.1",
          status: "fail",
          inputs: expect.objectContaining({ depthMm: 1525, latchSideMm: 455 }),
          subjects: expect.arrayContaining([
            { kind: "fixture", id: "approach-obstruction" },
          ]),
        }),
        expect.objectContaining({
          rule: "ADA 304.3.1",
          status: "fail",
          inputs: expect.objectContaining({ diameterMm: 1525 }),
        }),
      ]),
    );
    const finding = findings.find((item) => item.rule === "ADA 404.2.4.1");
    if (!finding) throw new Error("Missing test finding");
    const issue = issueFromFinding(plan, finding, 7);
    const edited = structuredClone(plan);
    edited.fixtures[0].position = { x: 5300, y: 3600 };
    expect(evaluateRuleSet(edited).findings).toEqual([]);
    expect(reproduceCoordinationIssue(edited, issue)).toBeNull();
    expect(reproduceCoordinationIssue(plan, issue)).toMatchObject({
      matches: true,
      inputs: { depthMm: 1525, latchSideMm: 455 },
    });
    const approach = edited.coordination?.find(
      (item) => item.kind === "approach",
    );
    if (!approach) throw new Error("Missing test approach");
    approach.side = "front-push";
    const push = () =>
      evaluateRuleSet(edited).checks.find(
        (check) => check.rule === "ADA 404.2.4.1",
      );
    expect(push()).toMatchObject({
      status: "needs_input",
      unresolved: ["closerAndLatch"],
    });
    approach.closerAndLatch = true;
    expect(push()).toMatchObject({
      status: "pass",
      inputs: { depthMm: 1220, latchSideMm: 305 },
    });
  });
});
