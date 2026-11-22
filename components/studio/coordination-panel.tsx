import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { findClashes, issueFromFinding } from "@/lib/plans/coordination";
import { utilityCatalog } from "@/lib/plans/catalog";
import { RuleReviewPanel } from "./rule-review-panel";
import type {
  CoordinationFinding,
  DraftPlanState,
  EquipmentZone,
  PlanCommand,
  ServiceRoute,
} from "@/lib/plans/model";

type Edit = (command: PlanCommand) => boolean;
const text = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
const number = (data: FormData, name: string) => Number(text(data, name));
const coords = (value: string, size: number) => {
  const input = value.trim().split(/[ ,]+/).map(Number);
  if (input.length !== size || input.some((n) => !Number.isInteger(n)))
    throw new Error(
      "Enter " + size + " whole millimeter coordinates per line.",
    );
  return input;
};

function Form({
  submit,
  onSubmit,
  children,
}: {
  submit: string;
  onSubmit(data: FormData): void;
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
      <button type="submit" className="studio-cad-apply">
        {submit}
      </button>
    </form>
  );
}

function RouteForm({
  route,
  plan,
  storeyId,
  write,
  error,
}: {
  route?: ServiceRoute;
  plan: DraftPlanState;
  storeyId: string;
  write: Edit;
  error(message: string): void;
}) {
  const [system, setSystem] = useState<ServiceRoute["system"]>(
    route?.system ?? "plumbing",
  );
  const nodes = route?.nodes;
  const beginning = nodes?.[0];
  const ending = nodes?.at(-1);
  const markers = plan.utilities.filter(
    ({ template }) => utilityCatalog[template].layer === system,
  );
  const markerOptions = markers.map((item) => (
    <option key={item.id} value={item.id}>
      {utilityCatalog[item.template].label} · {item.position.x},{" "}
      {item.position.y}
    </option>
  ));
  const waypoints = nodes
    ?.map((node) => {
      if (node.kind === "point")
        return node.point.x + ", " + node.point.y + ", " + node.zMm;
      const marker = plan.utilities.find((item) => item.id === node.utilityId)!;
      return marker.position.x + ", " + marker.position.y + ", " + node.zMm;
    })
    .join("\n");
  return (
    <Form
      submit={route ? "Update route" : "Create route"}
      onSubmit={(data) => {
        try {
          const rows = text(data, "points").split(/\n+/);
          const parsed: ServiceRoute["nodes"] = rows.map((row, index) => {
            const [x, y, zMm] = coords(row, 3);
            const utilityId =
              index === 0
                ? text(data, "start")
                : index === rows.length - 1
                  ? text(data, "end")
                  : "";
            return utilityId
              ? { kind: "utility", utilityId, zMm }
              : { kind: "point", point: { x, y }, zMm };
          });
          write({
            type: "coordination.write",
            item: {
              kind: "route",
              id: route?.id ?? crypto.randomUUID(),
              name: text(data, "name"),
              storeyId,
              system,
              diameterMm: number(data, "diameter"),
              nodes: parsed,
            },
          });
        } catch (cause) {
          error(
            cause instanceof Error ? cause.message : "Enter a valid route.",
          );
        }
      }}
    >
      <label>
        Route name
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={route?.name ?? "Service route"}
        />
      </label>
      <div className="studio-cad-parameters">
        <label>
          System
          <select
            value={system}
            onChange={(event) =>
              setSystem(event.target.value as ServiceRoute["system"])
            }
          >
            <option value="plumbing">Plumbing</option>
            <option value="electrical">Electrical</option>
          </select>
        </label>
        <label>
          Diameter (mm)
          <input
            type="number"
            name="diameter"
            min={5}
            max={1000}
            required
            defaultValue={route?.diameterMm ?? 50}
          />
        </label>
      </div>
      {markers.length > 0 && (
        <div className="studio-cad-parameters" key={system}>
          <label>
            Start symbol
            <select
              name="start"
              defaultValue={
                beginning?.kind === "utility" ? beginning.utilityId : ""
              }
            >
              <option value="">First waypoint</option>
              {markerOptions}
            </select>
          </label>
          <label>
            End symbol
            <select
              name="end"
              defaultValue={ending?.kind === "utility" ? ending.utilityId : ""}
            >
              <option value="">Last waypoint</option>
              {markerOptions}
            </select>
          </label>
        </div>
      )}
      <label>
        Waypoints (X, Y, Z in mm)
        <textarea
          name="points"
          rows={4}
          required
          defaultValue={waypoints ?? "0, 0, 500\n2000, 0, 500"}
        />
      </label>
      <p>
        Z is relative to the waypoint’s storey or its linked symbol’s storey.
      </p>
    </Form>
  );
}

function ZoneForm({
  zone,
  storeyId,
  write,
  error,
}: {
  zone?: EquipmentZone;
  storeyId: string;
  write: Edit;
  error(message: string): void;
}) {
  return (
    <Form
      submit={zone ? "Update zone" : "Create zone"}
      onSubmit={(data) => {
        try {
          const polygon = text(data, "polygon")
            .split(/\n+/)
            .map((row) => {
              const [x, y] = coords(row, 2);
              return { x, y };
            });
          write({
            type: "coordination.write",
            item: {
              kind: "zone",
              id: zone?.id ?? crypto.randomUUID(),
              storeyId,
              name: text(data, "name"),
              polygon,
              bottomMm: number(data, "bottom"),
              topMm: number(data, "top"),
            },
          });
        } catch (cause) {
          error(cause instanceof Error ? cause.message : "Enter a valid zone.");
        }
      }}
    >
      <label>
        Zone name
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={zone?.name ?? "Equipment zone"}
        />
      </label>
      <label>
        Boundary (X, Y in mm)
        <textarea
          rows={4}
          name="polygon"
          required
          defaultValue={
            zone?.polygon.map(({ x, y }) => x + ", " + y).join("\n") ??
            "0, 0\n1200, 0\n1200, 900\n0, 900"
          }
        />
      </label>
      <div className="studio-cad-parameters">
        <label>
          Bottom (mm)
          <input
            type="number"
            name="bottom"
            required
            defaultValue={zone?.bottomMm ?? 0}
          />
        </label>
        <label>
          Top (mm)
          <input
            type="number"
            name="top"
            required
            defaultValue={zone?.topMm ?? 2100}
          />
        </label>
      </div>
    </Form>
  );
}

export function CoordinationPanel({
  plan,
  planId,
  storeyId,
  revision,
  dirty,
  onEdit,
  onShow,
}: {
  plan: DraftPlanState;
  planId: string;
  storeyId: string;
  revision: number;
  dirty: boolean;
  onEdit(command: PlanCommand): void;
  onShow(finding: CoordinationFinding): void;
}) {
  const [tab, setTab] = useState<
    "routes" | "zones" | "clashes" | "rules" | "issues"
  >("routes");
  const [routeId, setRouteId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [error, setError] = useState("");
  const [activeClash, setActiveClash] = useState("");
  const [replay, setReplay] = useState<{
    id: string;
    message: string;
    pending?: boolean;
  }>();
  const items = plan.coordination ?? [];
  const routes = items.filter(
    (item): item is ServiceRoute =>
      item.kind === "route" && item.storeyId === storeyId,
  );
  const zones = items.filter(
    (item): item is EquipmentZone =>
      item.kind === "zone" && item.storeyId === storeyId,
  );
  const route = routes.find(({ id }) => id === routeId);
  const zone = zones.find(({ id }) => id === zoneId);
  const issues = items.filter((item) => item.kind === "issue");
  const report = useMemo(
    () => (tab === "clashes" ? findClashes(plan) : undefined),
    [plan, tab],
  );

  function dispatch(command: PlanCommand) {
    try {
      onEdit(command);
      setError("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The coordination edit could not be saved.",
      );
      return false;
    }
  }

  function recorded(key: string) {
    return issues.some(
      (item) =>
        item.status === "open" &&
        item.finding.key === key &&
        item.sourceRevision === revision,
    );
  }

  function record(finding: CoordinationFinding) {
    try {
      dispatch({
        type: "coordination.write",
        item: issueFromFinding(plan, finding, revision),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The issue could not be created.",
      );
    }
  }

  async function reproduce(id: string) {
    setReplay({ id, message: "Replaying saved revision…", pending: true });
    try {
      const response = await fetch(
        `/api/floorplans/${encodeURIComponent(planId)}/coordination-issues/${encodeURIComponent(id)}`,
      );
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? "The issue or its source revision is unavailable."
            : "The issue could not be replayed.",
        );
      const result: {
        sourceRevision: number;
        reproduced: { matches: boolean } | null;
      } = await response.json();
      const message = result.reproduced?.matches
        ? `Finding reproduced at revision ${result.sourceRevision}.`
        : result.reproduced
          ? `Finding evidence differs at revision ${result.sourceRevision}.`
          : `No matching finding at revision ${result.sourceRevision}.`;
      setReplay({ id, message });
    } catch (cause) {
      setReplay({
        id,
        message:
          cause instanceof Error
            ? cause.message
            : "The issue could not be replayed.",
      });
    }
  }

  return (
    <section className="studio-fields coordination-panel">
      <div
        className="studio-building-tabs"
        role="group"
        aria-label="Coordination views"
      >
        {(["routes", "zones", "clashes", "rules", "issues"] as const).map(
          (view) => (
            <button
              key={view}
              type="button"
              aria-pressed={tab === view}
              onClick={() => {
                setTab(view);
                setError("");
              }}
            >
              {view[0].toUpperCase() + view.slice(1)}
            </button>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="coordination-error">
          {error}
        </p>
      )}
      {tab === "routes" && (
        <>
          <label>
            Service route
            <select
              value={route?.id ?? ""}
              onChange={(event) => setRouteId(event.target.value)}
            >
              <option value="">New route</option>
              {routes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <RouteForm
            key={JSON.stringify(route ?? storeyId)}
            {...{ route, plan, storeyId }}
            error={setError}
            write={(command) => {
              if (!dispatch(command)) return false;
              if (command.type === "coordination.write")
                setRouteId(command.item.id);
              return true;
            }}
          />
          {route && (
            <button
              type="button"
              className="interchange-action"
              onClick={() => {
                if (dispatch({ type: "coordination.remove", id: route.id }))
                  setRouteId("");
              }}
            >
              Remove route
            </button>
          )}
        </>
      )}
      {tab === "zones" && (
        <>
          <label>
            Equipment zone
            <select
              value={zone?.id ?? ""}
              onChange={(event) => setZoneId(event.target.value)}
            >
              <option value="">New zone</option>
              {zones.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <ZoneForm
            key={JSON.stringify(zone ?? storeyId)}
            {...{ zone, storeyId }}
            error={setError}
            write={(command) => {
              if (!dispatch(command)) return false;
              if (command.type === "coordination.write")
                setZoneId(command.item.id);
              return true;
            }}
          />
          {zone && (
            <button
              type="button"
              className="interchange-action"
              onClick={() => {
                if (dispatch({ type: "coordination.remove", id: zone.id }))
                  setZoneId("");
              }}
            >
              Remove zone
            </button>
          )}
        </>
      )}
      {tab === "clashes" && (
        <>
          {dirty && <p>Save the plan to record findings as issues.</p>}
          {report?.findings.length === 0 && <p>No modeled clashes.</p>}
          {report?.truncated && <p>Showing the first 200 clashes.</p>}
          {report?.findings.map((finding) => (
            <article className="coordination-card" key={finding.key}>
              <strong>{finding.title}</strong>
              <p>{finding.detail}</p>
              <div className="interchange-choices">
                <button
                  type="button"
                  aria-pressed={finding.key === activeClash}
                  onClick={() => {
                    setActiveClash(finding.key);
                    onShow(finding);
                  }}
                >
                  Show clash
                </button>
                <button
                  type="button"
                  disabled={dirty || recorded(finding.key)}
                  onClick={() => record(finding)}
                >
                  Create issue
                </button>
              </div>
            </article>
          ))}
        </>
      )}
      {tab === "rules" && (
        <RuleReviewPanel
          {...{ plan, storeyId, dirty, onShow, recorded }}
          onEdit={dispatch}
          onRecord={record}
        />
      )}
      {tab === "issues" && (
        <>
          {issues.length === 0 && <p>No saved coordination issues.</p>}
          {issues.map((item) => (
            <article className="coordination-card" key={item.id}>
              <strong>{item.finding.title}</strong>
              <p>
                Revision {item.sourceRevision} · {item.status}
              </p>
              <p>{item.finding.edition}</p>
              <div className="interchange-choices">
                <button type="button" onClick={() => onShow(item.finding)}>
                  Show issue
                </button>
                <button
                  type="button"
                  disabled={!!replay?.pending || dirty}
                  onClick={() => void reproduce(item.id)}
                >
                  Reproduce issue
                </button>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "coordination.write",
                      item: {
                        ...item,
                        status: item.status === "open" ? "resolved" : "open",
                      },
                    })
                  }
                >
                  {item.status === "open" ? "Resolve issue" : "Reopen issue"}
                </button>
              </div>
              {replay?.id === item.id && <p role="status">{replay.message}</p>}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
