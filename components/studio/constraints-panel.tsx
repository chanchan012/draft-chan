"use client";

import { useMemo, useState, type FormEvent } from "react";
import { constraintReport } from "@/lib/plans/constraints";
import { wallLength } from "@/lib/plans/openings";
import type {
  Constraint,
  DraftPlanState,
  PlanCommand,
  WallEndpoint,
} from "@/lib/plans/model";

const labels = {
  fixed_distance: "Driving distance",
  coincident: "Coincident endpoints",
  parallel: "Parallel walls",
  perpendicular: "Perpendicular walls",
  equal_length: "Equal-length walls",
} as const;

export function ConstraintsPanel({
  plan,
  selectedWalls,
  onCommand,
}: {
  plan: DraftPlanState;
  selectedWalls: readonly string[];
  onCommand(command: PlanCommand): void;
}) {
  const [kind, setKind] = useState<Constraint["kind"]>("fixed_distance");
  const [error, setError] = useState("");
  const report = useMemo(
    () => constraintReport(plan.walls, plan.constraints),
    [plan.walls, plan.constraints],
  );
  const first = selectedWalls[0] ?? plan.walls[0]?.id;
  const second =
    selectedWalls[1] ??
    (kind === "fixed_distance"
      ? first
      : plan.walls.find((w) => w.id !== first)?.id);
  const endpointRelation = kind === "fixed_distance" || kind === "coincident";
  const labelWall = (id: string) => {
    const index = plan.walls.findIndex((w) => w.id === id);
    return index < 0 ? id : "Wall " + (index + 1);
  };

  function run(command: PlanCommand) {
    try {
      onCommand(command);
      setError("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "This constraint could not be applied.",
      );
    }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const firstWallId = String(data.get("first"));
    const secondWallId = String(data.get("second"));
    const id = crypto.randomUUID();
    const ref = (wallId: string, field: string): WallEndpoint => ({
      wallId,
      endpoint: data.get(field) === "start" ? "start" : "end",
    });
    const pair = {
      first: ref(firstWallId, "firstEnd"),
      second: ref(secondWallId, "secondEnd"),
    };
    const constraint: Constraint =
      kind === "coincident"
        ? { id, kind, ...pair }
        : kind === "fixed_distance"
          ? { id, kind, ...pair, distanceMm: Number(data.get("distance")) }
          : { id, kind, firstWallId, secondWallId };
    run({ type: "constraint.add", constraint });
  }

  return (
    <div className="studio-parametric">
      <p>
        {report.degreesOfFreedom} wall degrees of freedom ·{" "}
        {report.constraintCount} constraints
      </p>
      {!plan.walls.length ? (
        <p>Draw a wall to add constraints.</p>
      ) : (
        <form className="studio-fields" onSubmit={add}>
          <label>
            Relation
            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as Constraint["kind"])
              }
            >
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div
            key={first + ":" + second + ":" + kind}
            className="studio-cad-parameters"
          >
            <label>
              First wall
              <select name="first" defaultValue={first} required>
                {plan.walls.map((w) => (
                  <option key={w.id} value={w.id}>
                    {labelWall(w.id)}
                  </option>
                ))}
              </select>
            </label>
            {endpointRelation && (
              <label>
                First endpoint
                <select name="firstEnd" defaultValue="start">
                  <option value="start">Start</option>
                  <option value="end">End</option>
                </select>
              </label>
            )}
            <label>
              Second wall
              <select name="second" defaultValue={second} required>
                {plan.walls.map((w) => (
                  <option key={w.id} value={w.id}>
                    {labelWall(w.id)}
                  </option>
                ))}
              </select>
            </label>
            {endpointRelation && (
              <label>
                Second endpoint
                <select name="secondEnd" defaultValue="end">
                  <option value="start">Start</option>
                  <option value="end">End</option>
                </select>
              </label>
            )}
            {kind === "fixed_distance" && (
              <label>
                Distance (mm)
                <input
                  name="distance"
                  type="number"
                  min="1"
                  step="any"
                  required
                  defaultValue={Math.round(
                    wallLength(
                      plan.walls.find((w) => w.id === first) ?? plan.walls[0],
                    ),
                  )}
                />
              </label>
            )}
          </div>
          <button type="submit" className="studio-cad-apply">
            Add constraint
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {(plan.constraints ?? []).map((c) => (
        <div className="studio-parametric-item" key={c.id}>
          <strong>{labels[c.kind]}</strong>
          <small>
            {"first" in c
              ? labelWall(c.first.wallId) +
                " " +
                c.first.endpoint +
                " · " +
                labelWall(c.second.wallId) +
                " " +
                c.second.endpoint
              : labelWall(c.firstWallId) + " · " + labelWall(c.secondWallId)}
          </small>
          {c.kind === "fixed_distance" && (
            <form
              className="studio-fields"
              onSubmit={(event) => {
                event.preventDefault();
                run({
                  type: "constraint.drive",
                  id: c.id,
                  distanceMm: Number(
                    new FormData(event.currentTarget).get("drive"),
                  ),
                });
              }}
            >
              <label>
                Driving distance (mm)
                <input
                  key={c.distanceMm}
                  name="drive"
                  type="number"
                  min="1"
                  required
                  step="any"
                  defaultValue={c.distanceMm}
                />
              </label>
              <button className="studio-cad-apply" type="submit">
                Solve distance
              </button>
            </form>
          )}
          <button
            className="studio-parametric-remove"
            type="button"
            onClick={() => run({ type: "constraint.remove", id: c.id })}
          >
            Remove constraint
          </button>
        </div>
      ))}
    </div>
  );
}
