import { useMemo, useRef, useState } from "react";
import {
  dxfImportCommands,
  dxfUnits,
  stageDxf,
  type DxfUnit,
  type StagedDxf,
} from "@/lib/plans/dxf-import";
import { sketchPath, sketchPoints } from "@/lib/plans/sketch";
import type { DraftPlanState, PlanCommand } from "@/lib/plans/model";
import { UnderlayPanel } from "./underlay-panel";

function Preview({
  stage,
  selected,
}: {
  stage: StagedDxf;
  selected: string[];
}) {
  const shapes = stage.shapes.filter(({ layer }) => selected.includes(layer));
  const points = shapes.flatMap(({ geometry }) => sketchPoints(geometry));
  if (!points.length) return null;
  const bounds = points.reduce(
    (value, { x, y }) => ({
      left: Math.min(value.left, x),
      right: Math.max(value.right, x),
      top: Math.min(value.top, y),
      bottom: Math.max(value.bottom, y),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  );
  const extent = Math.max(
    1,
    bounds.right - bounds.left,
    bounds.bottom - bounds.top,
  );
  const padding = Math.max(20, extent * 0.08);
  const colors = new Map(
    stage.layers.map(({ name, color }) => [
      name,
      color.toLowerCase() === "#ffffff" ? "#304739" : color,
    ]),
  );
  return (
    <svg
      className="interchange-preview interchange-dxf-preview"
      role="img"
      aria-label="DXF staging preview"
      viewBox={`${bounds.left - padding} ${bounds.top - padding} ${bounds.right - bounds.left + 2 * padding} ${bounds.bottom - bounds.top + 2 * padding}`}
    >
      {shapes.map(({ geometry, layer }, index) => (
        <path
          key={index}
          data-staged-dxf={geometry.kind}
          d={sketchPath(geometry)}
          stroke={colors.get(layer)}
          strokeWidth="1.2"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function InterchangePanel({
  plan,
  storeyId,
  onEdit,
}: {
  plan: DraftPlanState;
  storeyId: string;
  onEdit(commands: PlanCommand[]): void;
}) {
  const [tab, setTab] = useState<"dxf" | "underlays">("dxf");
  const [source, setSource] = useState<{ name: string; text: string }>();
  const [override, setOverride] = useState<DxfUnit>();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const readRequest = useRef(0);

  const inspection = useMemo(() => {
    if (!source) return null;
    try {
      return { stage: stageDxf(source.text, override), error: "" };
    } catch (cause) {
      return {
        stage: null,
        error: cause instanceof Error ? cause.message : "Invalid DXF file.",
      };
    }
  }, [source, override]);
  const stage = inspection?.stage;
  const selected =
    stage?.layers
      .filter(({ name, supported }) => supported && !excluded.includes(name))
      .map(({ name }) => name) ?? [];
  const count =
    stage?.shapes.filter(({ layer }) => selected.includes(layer)).length ?? 0;

  async function read(file: File) {
    const ticket = ++readRequest.current;
    setError("");
    setStatus("");
    setSource(undefined);
    setOverride(undefined);
    setExcluded([]);
    try {
      if (!file.size || file.size > 2_000_000)
        throw new Error("Choose a DXF file up to 2 MB.");
      const text = await file.text();
      if (ticket === readRequest.current) setSource({ name: file.name, text });
    } catch (cause) {
      if (ticket === readRequest.current)
        setError(
          cause instanceof Error ? cause.message : "The DXF could not be read.",
        );
    }
  }

  function commit() {
    if (!stage) return;
    try {
      const { commands, imported } = dxfImportCommands(
        plan,
        stage,
        storeyId,
        selected,
      );
      onEdit(commands);
      setStatus(
        "Imported " + imported + (imported === 1 ? " entity." : " entities."),
      );
      setSource(undefined);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The DXF could not be imported.",
      );
    }
  }

  return (
    <section className="studio-fields interchange-panel">
      <div
        className="studio-building-tabs"
        role="group"
        aria-label="Interchange mode"
      >
        <button
          type="button"
          aria-pressed={tab === "dxf"}
          onClick={() => setTab("dxf")}
        >
          Import DXF
        </button>
        <button
          type="button"
          aria-pressed={tab === "underlays"}
          onClick={() => setTab("underlays")}
        >
          Underlays
        </button>
      </div>
      {tab === "underlays" ? (
        <UnderlayPanel plan={plan} storeyId={storeyId} onEdit={onEdit} />
      ) : (
        <>
          <label>
            DXF file
            <input
              type="file"
              aria-label="DXF file"
              accept=".dxf,text/plain,application/dxf"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void read(file);
              }}
            />
          </label>
          {(error || inspection?.error) && (
            <p className="interchange-error" role="alert">
              {error || inspection?.error}
            </p>
          )}
          {status && <p role="status">{status}</p>}
          {stage && source && (
            <>
              <p className="interchange-file">{source.name}</p>
              <label>
                Source units
                <select
                  value={override ?? ""}
                  onChange={(event) =>
                    setOverride((event.target.value as DxfUnit) || undefined)
                  }
                >
                  <option value="">
                    {stage.declaredUnit
                      ? "Drawing units · " + stage.declaredUnit
                      : "Choose units"}
                  </option>
                  {dxfUnits.map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
              </label>
              {!stage.unit && (
                <p role="status">This drawing needs an explicit length unit.</p>
              )}
              <Preview stage={stage} selected={selected} />
              <fieldset>
                <legend>Layers to import</legend>
                {stage.layers.map(({ name, supported, skipped }) => (
                  <label className="interchange-toggle" key={name}>
                    <input
                      type="checkbox"
                      disabled={!supported}
                      checked={supported > 0 && !excluded.includes(name)}
                      onChange={(event) =>
                        setExcluded((items) =>
                          event.target.checked
                            ? items.filter((item) => item !== name)
                            : [...items, name],
                        )
                      }
                    />
                    <span>
                      {name}
                      <small>
                        {supported} supported
                        {skipped ? " · " + skipped + " skipped" : ""}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {stage.unsupported.length > 0 && (
                <details className="interchange-report" open>
                  <summary>Skipped entities</summary>
                  <ul>
                    {stage.unsupported.map(({ reason, count }) => (
                      <li key={reason}>
                        {reason} ({count})
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <button
                type="button"
                className="studio-cad-apply"
                disabled={!stage.unit || !count}
                onClick={commit}
              >
                Import {count} {count === 1 ? "entity" : "entities"}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
