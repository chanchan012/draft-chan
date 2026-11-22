import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  reviewPackId,
  type ApproachCheck,
  type CoordinationFinding,
  type DraftPlanState,
  type EgressPath,
  type PlanCommand,
  type RuleProfile,
  type TurningCheck,
} from "@/lib/plans/model";
import { evaluateRuleSet } from "@/lib/plans/review-rules";
import { storeyOf } from "@/lib/plans/storeys";

type Check = ApproachCheck | TurningCheck | EgressPath;
const text = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
const captions = {
  egress: "Egress path",
  approach: "Door approach",
  turning: "Turning circle",
};

function ReviewForm({
  onSubmit,
  label,
  children,
}: {
  onSubmit(data: FormData): void;
  label: string;
  children: ReactNode;
}) {
  return (
    <form
      className="studio-fields"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      {children}
      <button className="studio-cad-apply" type="submit">
        {label}
      </button>
    </form>
  );
}

export function RuleReviewPanel({
  plan,
  storeyId,
  dirty,
  onEdit,
  onShow,
  onRecord,
  recorded,
}: {
  plan: DraftPlanState;
  storeyId: string;
  dirty: boolean;
  onEdit(command: PlanCommand): boolean;
  onShow(finding: CoordinationFinding): void;
  onRecord(finding: CoordinationFinding): void;
  recorded(key: string): boolean;
}) {
  const [id, setId] = useState("");
  const [kind, setKind] = useState<Check["kind"]>("egress");
  const [error, setError] = useState("");
  const items = plan.coordination ?? [];
  const profile = items.find(
    (item): item is RuleProfile =>
      item.kind === "profile" && item.storeyId === storeyId,
  );
  const checks = items.filter(
    (item): item is Check =>
      (item.kind === "approach" ||
        item.kind === "egress" ||
        item.kind === "turning") &&
      item.storeyId === storeyId,
  );
  const selected = checks.find((item) => item.id === id);
  const current = selected?.kind ?? kind;
  const wallIds = new Set(
    plan.walls
      .filter((wall) => storeyOf(wall) === storeyId)
      .map(({ id }) => id),
  );
  const doors = plan.openings.filter((door) => wallIds.has(door.wallId));
  const report = useMemo(
    () => evaluateRuleSet(plan, storeyId),
    [plan, storeyId],
  );

  function saveProfile(data: FormData) {
    const occupancy = text(data, "occupancy") as RuleProfile["occupancy"];
    const sprinkler = text(data, "sprinkler") as RuleProfile["sprinkler"];
    onEdit({
      type: "coordination.write",
      item: {
        kind: "profile",
        id: profile?.id ?? crypto.randomUUID(),
        storeyId,
        pack: reviewPackId,
        jurisdiction: text(data, "jurisdiction"),
        occupancy: occupancy || undefined,
        sprinkler: sprinkler || undefined,
      },
    });
  }

  function saveCheck(data: FormData) {
    const input = {
      id: selected?.id ?? crypto.randomUUID(),
      name: text(data, "name"),
      storeyId,
    };
    setError("");
    let item: Check;
    if (current === "egress") {
      const waypoints = text(data, "waypoints")
        .split(/\n+/)
        .map((line) => {
          const values = line.trim().split(/[ ,]+/).map(Number);
          if (
            values.length !== 2 ||
            values.some((number) => !Number.isInteger(number))
          )
            return null;
          const [x, y] = values;
          return { x, y };
        });
      if (waypoints.some((point) => !point)) {
        setError("Enter one X, Y pair in whole millimeters per line.");
        return;
      }
      item = {
        ...input,
        kind: "egress",
        exitDoorId: text(data, "door"),
        waypoints: waypoints.filter((point) => point !== null),
      };
    } else if (current === "approach") {
      const hardware = text(data, "hardware");
      item = {
        ...input,
        kind: "approach",
        doorId: text(data, "door"),
        side: text(data, "side") as ApproachCheck["side"],
        closerAndLatch: hardware === "" ? undefined : hardware === "yes",
      };
    } else {
      item = {
        ...input,
        kind: "turning",
        center: { x: Number(text(data, "x")), y: Number(text(data, "y")) },
      };
    }
    if (onEdit({ type: "coordination.write", item })) setId(item.id);
  }

  return (
    <>
      <p>
        {report.pack.label} · 2021 IBC / 2010 ADA · v{report.pack.version}
      </p>
      <details className="coordination-card">
        <summary>Rule profile</summary>
        <ReviewForm
          key={JSON.stringify(profile ?? storeyId)}
          label="Save rule profile"
          onSubmit={saveProfile}
        >
          <label>
            Jurisdiction label
            <input
              name="jurisdiction"
              required
              maxLength={100}
              defaultValue={profile?.jurisdiction ?? "US model codes"}
            />
          </label>
          <label>
            Occupancy group
            <select name="occupancy" defaultValue={profile?.occupancy ?? ""}>
              <option value="">Unspecified</option>
              <option value="B">B · Business</option>
              <option value="R-2">R-2 · Residential</option>
            </select>
          </label>
          <label>
            Sprinkler system
            <select name="sprinkler" defaultValue={profile?.sprinkler ?? ""}>
              <option value="">Unspecified</option>
              <option value="none">None</option>
              <option value="nfpa13">IBC 903.3.1.1 throughout</option>
              <option value="nfpa13r">IBC 903.3.1.2 throughout</option>
            </select>
          </label>
        </ReviewForm>
      </details>
      <details className="coordination-card">
        <summary>Egress and access checks</summary>
        <div className="studio-fields">
          <label>
            Saved check
            <select
              value={selected?.id ?? ""}
              onChange={(event) => setId(event.target.value)}
            >
              <option value="">New check</option>
              {checks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Check type
            <select
              value={current}
              disabled={!!selected}
              onChange={(event) => setKind(event.target.value as Check["kind"])}
            >
              {Object.entries(captions).map(([value, caption]) => (
                <option key={value} value={value}>
                  {caption}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="coordination-error">
            {error}
          </p>
        )}
        <ReviewForm
          key={JSON.stringify(selected ?? [storeyId, current])}
          label={selected ? "Update check" : "Add check"}
          onSubmit={saveCheck}
        >
          <label>
            Check name
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={selected?.name ?? captions[current]}
            />
          </label>
          {current !== "turning" && (
            <label>
              {current === "egress" ? "Designated exit door" : "Door to check"}
              <select
                name="door"
                required
                defaultValue={
                  selected?.kind === "egress"
                    ? selected.exitDoorId
                    : selected?.kind === "approach"
                      ? selected.doorId
                      : ""
                }
              >
                <option value="">Choose door</option>
                {doors.map((door, i) => (
                  <option key={door.id} value={door.id}>
                    Door {i + 1} · {door.widthMm} mm
                  </option>
                ))}
              </select>
            </label>
          )}
          {current === "egress" && (
            <label>
              Waypoints (X, Y in mm)
              <textarea
                name="waypoints"
                required
                rows={4}
                defaultValue={
                  selected?.kind === "egress"
                    ? selected.waypoints
                        .map(({ x, y }) => x + ", " + y)
                        .join("\n")
                    : ""
                }
                placeholder="1000, 1500"
              />
            </label>
          )}
          {current === "approach" && (
            <>
              <label>
                Front approach side
                <select
                  name="side"
                  defaultValue={
                    selected?.kind === "approach" ? selected.side : "front-pull"
                  }
                >
                  <option value="front-pull">Pull</option>
                  <option value="front-push">Push</option>
                </select>
              </label>
              <label>
                Closer and latch
                <select
                  name="hardware"
                  defaultValue={
                    selected?.kind === "approach" &&
                    selected.closerAndLatch !== undefined
                      ? selected.closerAndLatch
                        ? "yes"
                        : "no"
                      : ""
                  }
                >
                  <option value="">Unspecified</option>
                  <option value="yes">Both present</option>
                  <option value="no">One or both absent</option>
                </select>
              </label>
            </>
          )}
          {current === "turning" && (
            <div className="studio-cad-parameters">
              <label>
                Center X (mm)
                <input
                  name="x"
                  type="number"
                  required
                  defaultValue={
                    selected?.kind === "turning" ? selected.center.x : 0
                  }
                />
              </label>
              <label>
                Center Y (mm)
                <input
                  name="y"
                  type="number"
                  required
                  defaultValue={
                    selected?.kind === "turning" ? selected.center.y : 0
                  }
                />
              </label>
            </div>
          )}
        </ReviewForm>
        {selected && (
          <button
            type="button"
            className="interchange-action"
            onClick={() => {
              if (onEdit({ type: "coordination.remove", id: selected.id }))
                setId("");
            }}
          >
            Remove check
          </button>
        )}
      </details>
      {report.checks.length === 0 && (
        <p>Add an egress or accessibility check to see results.</p>
      )}
      {report.checks.map((check) => {
        const { finding } = check;
        return (
          <article
            className="coordination-card"
            key={check.rule + ":" + check.subjects[0].id}
            data-review-status={check.status}
          >
            <strong>{check.title}</strong>
            <p>
              <b>
                {check.status === "needs_input"
                  ? "Needs input"
                  : check.status === "fail"
                    ? "Obstructed or over limit"
                    : "Model check passed"}
              </b>
            </p>
            <p>{check.detail}</p>
            <a href={check.source} target="_blank" rel="noreferrer">
              {check.rule} · {check.edition}
            </a>
            <details>
              <summary>Inputs and objects</summary>
              <dl>
                {Object.entries(check.inputs).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value === null ? "Unspecified" : String(value)}</dd>
                  </div>
                ))}
                <div>
                  <dt>Objects</dt>
                  <dd>
                    {check.subjects
                      .map(({ kind, id }) => kind + " " + id)
                      .join(", ")}
                  </dd>
                </div>
                {!!check.unresolved?.length && (
                  <div>
                    <dt>Missing inputs</dt>
                    <dd>{check.unresolved.join(", ")}</dd>
                  </div>
                )}
              </dl>
            </details>
            {finding && (
              <div className="interchange-choices">
                <button type="button" onClick={() => onShow(finding)}>
                  Show finding
                </button>
                <button
                  type="button"
                  disabled={dirty || recorded(finding.key)}
                  onClick={() => onRecord(finding)}
                >
                  Create issue
                </button>
              </div>
            )}
          </article>
        );
      })}
    </>
  );
}
