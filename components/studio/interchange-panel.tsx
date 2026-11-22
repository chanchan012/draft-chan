import { useMemo, useRef, useState } from "react";
import {
  dxfImportCommands,
  dxfUnits,
  stageDxf,
  type DxfUnit,
  type StagedDxf,
} from "@/lib/plans/dxf-import";
import { createDrawingReference } from "@/lib/plans/drawing-references";
import { interchangeDownloadPath } from "@/lib/plans/interchange-export";
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
  planId,
  revision,
  dirty,
  onEdit,
}: {
  plan: DraftPlanState;
  storeyId: string;
  planId: string;
  revision: number;
  dirty: boolean;
  onEdit(commands: PlanCommand[]): void;
}) {
  const [tab, setTab] = useState<
    "dxf" | "underlays" | "references" | "exports"
  >("dxf");
  const [source, setSource] = useState<{ name: string; text: string }>();
  const [override, setOverride] = useState<DxfUnit>();
  const [excluded, setExcluded] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const allReferences =
    plan.drawingReferences?.filter((item) => item.storeyId === storeyId) ?? [];
  const reference = allReferences.find((item) => item.id === referenceId);
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
      if (tab === "references" && source) {
        const id = reference?.id ?? crypto.randomUUID();
        const name =
          source.name
            .replace(/[\x00-\x1f\x7f]/g, " ")
            .trim()
            .slice(0, 120) || "DXF reference";
        const item = createDrawingReference(
          stage,
          name,
          storeyId,
          id,
          selected,
          reference,
        );
        onEdit([{ type: "reference.write", item }]);
        setReferenceId(id);
        setStatus(reference ? "Reference refreshed." : "Reference attached.");
        setSource(undefined);
        setError("");
        return;
      }
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
        <button
          type="button"
          aria-pressed={tab === "references"}
          onClick={() => {
            setTab("references");
            setStatus("");
            setError("");
          }}
        >
          References
        </button>
        <button
          type="button"
          aria-pressed={tab === "exports"}
          onClick={() => setTab("exports")}
        >
          Export CAD
        </button>
      </div>
      {tab === "underlays" ? (
        <UnderlayPanel plan={plan} storeyId={storeyId} onEdit={onEdit} />
      ) : tab === "exports" ? (
        <>
          {dirty ? (
            <p role="status">
              Save this drawing to export its latest revision.
            </p>
          ) : (
            <>
              <p>Saved revision {revision}</p>
              <a
                className="interchange-action"
                href={interchangeDownloadPath(
                  planId,
                  revision,
                  "typed-dxf",
                  storeyId,
                )}
              >
                Download typed DXF
              </a>
              <a
                className="interchange-action"
                href={interchangeDownloadPath(planId, revision, "ifc")}
              >
                Download IFC4 building
              </a>
            </>
          )}
        </>
      ) : (
        <>
          {tab === "references" && (
            <>
              <label>
                Drawing reference
                <select
                  value={reference?.id ?? ""}
                  onChange={(event) => {
                    setReferenceId(event.currentTarget.value);
                    setStatus("");
                  }}
                >
                  <option value="">Attach new reference</option>
                  {allReferences.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · v{item.version}
                    </option>
                  ))}
                </select>
              </label>
              {reference && (
                <>
                  <p>
                    {reference.shapes.length} read-only entities · source v
                    {reference.version}
                  </p>
                  <form
                    className="studio-fields"
                    key={JSON.stringify([
                      reference.id,
                      reference.offset,
                      reference.visible,
                    ])}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      try {
                        onEdit([
                          {
                            type: "reference.write",
                            item: {
                              ...reference,
                              visible: data.has("visible"),
                              offset: {
                                x: Number(data.get("x")),
                                y: Number(data.get("y")),
                              },
                            },
                          },
                        ]);
                        setStatus("Placement saved.");
                        setError("");
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Placement could not be saved.",
                        );
                      }
                    }}
                  >
                    <div className="studio-cad-parameters">
                      <label>
                        Reference X (mm)
                        <input
                          name="x"
                          type="number"
                          required
                          min="-1000000"
                          max="1000000"
                          defaultValue={reference.offset.x}
                        />
                      </label>
                      <label>
                        Reference Y (mm)
                        <input
                          name="y"
                          type="number"
                          required
                          min="-1000000"
                          max="1000000"
                          defaultValue={reference.offset.y}
                        />
                      </label>
                    </div>
                    <label className="interchange-toggle">
                      <input
                        name="visible"
                        type="checkbox"
                        defaultChecked={reference.visible}
                      />{" "}
                      Show reference
                    </label>
                    <button type="submit" className="studio-cad-apply">
                      Save reference placement
                    </button>
                  </form>
                  <button
                    type="button"
                    className="interchange-action"
                    onClick={() => {
                      try {
                        onEdit([
                          { type: "reference.remove", id: reference.id },
                        ]);
                        setReferenceId("");
                        setStatus("Reference detached.");
                        setError("");
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "Reference could not be detached.",
                        );
                      }
                    }}
                  >
                    Detach reference
                  </button>
                </>
              )}
            </>
          )}
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
                <legend>
                  {tab === "references"
                    ? "Reference layers"
                    : "Layers to import"}
                </legend>
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
                {tab === "references"
                  ? reference
                    ? "Refresh reference"
                    : "Attach reference"
                  : "Import " + count + (count === 1 ? " entity" : " entities")}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
