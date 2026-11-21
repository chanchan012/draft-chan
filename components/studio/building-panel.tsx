"use client";

import { useMemo, useState, type FormEvent } from "react";
import { planStoreys, assemblyThickness } from "@/lib/plans/storeys";
import { querySpaces } from "@/lib/plans/spaces";
import {
  storeyInput,
  wallTypeInput,
  wallReferenceInput,
  type DraftPlanState,
  type PlanCommand,
  type Storey,
  type WallType,
} from "@/lib/plans/model";

type Props = {
  building: DraftPlanState;
  storey: Storey;
  wallIds: string[];
  onStorey(id: string): void;
  onEdit(commands: PlanCommand[]): void;
};
const number = (data: FormData, key: string) => Number(data.get(key));

function StoreyFields({
  value,
}: {
  value: { name: string; elevationMm: number; wallHeightMm: number };
}) {
  return (
    <>
      <label>
        Storey name
        <input name="name" defaultValue={value.name} required maxLength={80} />
      </label>
      <div className="studio-cad-parameters">
        <label>
          Elevation (mm)
          <input
            name="elevation"
            type="number"
            defaultValue={value.elevationMm}
            required
          />
        </label>
        <label>
          Wall height (mm)
          <input
            name="height"
            type="number"
            min="1000"
            max="12000"
            defaultValue={value.wallHeightMm}
            required
          />
        </label>
      </div>
    </>
  );
}

function AssemblyForm({
  type,
  onSave,
}: {
  type?: WallType;
  onSave(type: unknown): void;
}) {
  const [rows, setRows] = useState(type?.layers.length ?? 1);
  return (
    <form
      className="studio-fields"
      aria-label={type ? "Edit wall assembly" : "Create wall assembly"}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSave({
          id: type?.id ?? crypto.randomUUID(),
          name: data.get("name"),
          layers: Array.from({ length: rows }, (_, i) => ({
            material: data.get("material-" + i),
            thicknessMm: number(data, "thickness-" + i),
          })),
        });
      }}
    >
      <label>
        Assembly name
        <input name="name" defaultValue={type?.name} required maxLength={80} />
      </label>
      {Array.from({ length: rows }, (_, i) => (
        <div className="studio-cad-parameters" key={i}>
          <label>
            Material {i + 1}
            <input
              name={"material-" + i}
              defaultValue={type?.layers[i]?.material}
              required
              maxLength={80}
            />
          </label>
          <label>
            Thickness {i + 1} (mm)
            <input
              name={"thickness-" + i}
              type="number"
              defaultValue={type?.layers[i]?.thicknessMm ?? 120}
              min="1"
              max="10000"
              required
            />
          </label>
        </div>
      ))}
      <button
        className="studio-parametric-remove"
        type="button"
        disabled={rows === 16}
        onClick={() => setRows(rows + 1)}
      >
        Add material layer
      </button>
      {rows > 1 && (
        <button
          className="studio-parametric-remove"
          type="button"
          onClick={() => setRows(rows - 1)}
        >
          Remove last material
        </button>
      )}
      <button className="studio-cad-apply" type="submit">
        {type ? "Update assembly" : "Create assembly"}
      </button>
    </form>
  );
}

export function BuildingPanel({
  building,
  storey,
  wallIds,
  onStorey,
  onEdit,
}: Props) {
  const [tab, setTab] = useState<"storeys" | "assemblies">("storeys");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [typeId, setTypeId] = useState("");
  const levels = [...planStoreys(building)].sort(
    (a, b) => a.elevationMm - b.elevationMm,
  );
  const types = building.wallTypes ?? [];
  const type = types.find((item) => item.id === typeId);
  const summary = useMemo(() => {
    if (tab !== "storeys") return undefined;
    try {
      return querySpaces(building, storey.id)[0];
    } catch {
      return undefined;
    }
  }, [building, storey.id, tab]);
  function run(work: () => void) {
    try {
      work();
      setError("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not update the building.",
      );
    }
  }
  function saveStorey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(() => {
      const level = storeyInput.parse({
        id: adding ? crypto.randomUUID() : storey.id,
        name: data.get("name"),
        elevationMm: number(data, "elevation"),
        wallHeightMm: number(data, "height"),
      });
      onEdit([{ type: "storey.write", storey: level }]);
      onStorey(level.id);
      setAdding(false);
    });
  }
  return (
    <div className="studio-parametric">
      <div
        className="studio-building-tabs"
        role="group"
        aria-label="Building settings"
      >
        <button
          type="button"
          aria-pressed={tab === "storeys"}
          onClick={() => {
            setTab("storeys");
            setError("");
          }}
        >
          Storeys
        </button>
        <button
          type="button"
          aria-pressed={tab === "assemblies"}
          onClick={() => {
            setTab("assemblies");
            setError("");
          }}
        >
          Wall assemblies
        </button>
      </div>
      {tab === "storeys" ? (
        <>
          <label className="studio-org-label">
            Active storey
            <select
              value={storey.id}
              onChange={(event) => {
                onStorey(event.target.value);
                setAdding(false);
                setError("");
              }}
            >
              {levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name}
                </option>
              ))}
            </select>
          </label>
          {summary && (
            <p>
              {summary.spaces.length} spaces · {summary.netAreaM2.toFixed(2)} m²
              net · {summary.grossAreaM2.toFixed(2)} m² gross
            </p>
          )}
          {!summary && <p>Area unavailable for the current geometry.</p>}
          <button
            type="button"
            className="studio-parametric-remove"
            onClick={() => setAdding(!adding)}
          >
            {adding ? "Cancel new storey" : "New storey"}
          </button>
          <form
            className="studio-fields"
            aria-label="Storey settings"
            onSubmit={saveStorey}
            key={adding ? "new" : JSON.stringify(storey)}
          >
            <StoreyFields
              value={
                adding
                  ? {
                      name: "",
                      elevationMm:
                        levels.at(-1)!.elevationMm +
                        levels.at(-1)!.wallHeightMm +
                        250,
                      wallHeightMm: storey.wallHeightMm,
                    }
                  : storey
              }
            />
            <button type="submit" className="studio-cad-apply">
              {adding ? "Create storey" : "Save storey"}
            </button>
          </form>
        </>
      ) : (
        <>
          <label className="studio-org-label">
            Wall assembly
            <select
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
            >
              <option value="">New assembly</option>
              {types.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {assemblyThickness(item)} mm
                </option>
              ))}
            </select>
          </label>
          <AssemblyForm
            key={JSON.stringify(type ?? null)}
            type={type}
            onSave={(value) =>
              run(() => {
                const item = wallTypeInput.parse(value);
                onEdit([{ type: "wall_type.write", wallType: item }]);
                setTypeId(item.id);
              })
            }
          />
          <form
            className="studio-fields studio-parametric-item"
            aria-label="Assign wall assembly"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() =>
                onEdit(
                  wallIds.map((id) => ({
                    type: "wall.assembly",
                    id,
                    wallTypeId: typeId || null,
                    referenceLine: wallReferenceInput.parse(
                      data.get("reference"),
                    ),
                  })),
                ),
              );
            }}
          >
            <p>Select walls on the active storey to assign an assembly.</p>
            <label>
              Reference line
              <select name="reference">
                <option value="center">Centre</option>
                <option value="positive">Positive face</option>
                <option value="negative">Negative face</option>
              </select>
            </label>
            <button
              type="submit"
              className="studio-cad-apply"
              disabled={!wallIds.length}
            >
              {typeId ? "Assign assembly" : "Set reference and detach"}
            </button>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
