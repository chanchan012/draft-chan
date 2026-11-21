"use client";

import { useState, type FormEvent } from "react";
import { elementsOnStorey, openingsForSlab } from "@/lib/plans/building";
import { bounds } from "@/lib/plans/footprints";
import {
  buildingElementInput,
  buildingViewInput,
  type BuildingElement,
  type BuildingView,
  type DraftPlanState,
  type PlanCommand,
  type Point,
  type Storey,
} from "@/lib/plans/model";
import { planStoreys, storeyPlan } from "@/lib/plans/storeys";

type Apply = (command: PlanCommand) => void;
const captions = {
  slab: "Slab",
  opening: "Floor opening",
  stair: "Straight stair",
  roof: "Roof",
};
const number = (data: FormData, key: string) => Number(data.get(key));
const point = (data: FormData, key: string): Point => ({
  x: number(data, key + "X"),
  y: number(data, key + "Y"),
});
const textRing = (ring: Point[]) =>
  ring.map(({ x, y }) => x + " " + y).join("\n");

function defaultFootprint(building: DraftPlanState, id: string) {
  const walls = storeyPlan(building, id).walls;
  const { left, right, top, bottom } = walls.length
    ? bounds(walls.flatMap((wall) => [wall.start, wall.end]))
    : { left: 0, right: 4000, top: 0, bottom: 3000 };
  return [
    { x: left, y: top },
    { x: Math.max(right, left + 1000), y: top },
    { x: Math.max(right, left + 1000), y: Math.max(bottom, top + 1000) },
    { x: left, y: Math.max(bottom, top + 1000) },
  ];
}

function Input({
  label,
  name,
  value,
  step = 1,
}: {
  label: string;
  name: string;
  value: number;
  step?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        name={name}
        defaultValue={value}
        step={step}
        required
      />
    </label>
  );
}

function PointFields({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: Point;
}) {
  return (
    <div className="studio-cad-parameters">
      <Input label={label + " X (mm)"} name={name + "X"} value={value.x} />
      <Input label={label + " Y (mm)"} name={name + "Y"} value={value.y} />
    </div>
  );
}

export function StructurePanel({
  building,
  storey,
  onCommand,
}: {
  building: DraftPlanState;
  storey: Storey;
  onCommand: Apply;
}) {
  const [activeId, setActiveId] = useState("");
  const [kind, setKind] = useState<BuildingElement["kind"]>("slab");
  const [error, setError] = useState("");
  const items = elementsOnStorey(building, storey.id);
  const item = items.find((item) => item.id === activeId);
  const currentKind = item?.kind ?? kind;
  const slabs = (building.buildingElements ?? []).filter(
    (item) => item.kind === "slab",
  );
  const levels = [...planStoreys(building)].sort(
    (a, b) => a.elevationMm - b.elevationMm,
  );
  const outline = defaultFootprint(building, storey.id);
  const middleY = Math.round((outline[0].y + outline[2].y) / 2);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const id = item?.id ?? crypto.randomUUID();
      const shape = {
        id,
        name: String(data.get("name")),
        kind: currentKind,
        storeyId: item && "storeyId" in item ? item.storeyId : storey.id,
      };
      const footprint =
        currentKind === "stair"
          ? undefined
          : String(data.get("footprint"))
              .trim()
              .split(/\r?\n/)
              .map((line) => {
                const parts = line.trim().split(/[ ,]+/).map(Number);
                if (parts.length !== 2)
                  throw new Error("Enter one X and Y pair per line.");
                const [x, y] = parts;
                return { x, y };
              });
      const fields =
        currentKind === "slab"
          ? {
              storeyId: shape.storeyId,
              footprint,
              thicknessMm: number(data, "thickness"),
              offsetMm: number(data, "offset"),
            }
          : currentKind === "roof"
            ? {
                storeyId: shape.storeyId,
                footprint,
                thicknessMm: number(data, "thickness"),
                offsetMm: number(data, "offset"),
                profile: data.get("profile"),
                pitchDeg: number(data, "pitch"),
                directionDeg: number(data, "direction"),
              }
            : currentKind === "opening"
              ? { slabId: data.get("slab"), footprint }
              : {
                  start: point(data, "start"),
                  end: point(data, "end"),
                  widthMm: number(data, "width"),
                  risers: number(data, "risers"),
                  fromStoreyId: data.get("from"),
                  toStoreyId: data.get("to"),
                  openingSlabId: data.get("slab") || undefined,
                };
      const saved = buildingElementInput.parse({
        id,
        name: shape.name,
        kind: currentKind,
        ...fields,
      });
      onCommand({ type: "building.write", item: saved });
      setActiveId(id);
      setError("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save the element.",
      );
    }
  }

  function remove(id: string) {
    try {
      onCommand({ type: "building.remove", collection: "elements", id });
      setActiveId("");
      setError("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not remove the element.",
      );
    }
  }
  return (
    <>
      <label className="studio-org-label">
        Building element
        <select
          value={item?.id ?? ""}
          onChange={(event) => {
            setActiveId(event.target.value);
            setError("");
          }}
        >
          <option value="">New element</option>
          {items.map((entry) => (
            <option value={entry.id} key={entry.id}>
              {entry.name} · {captions[entry.kind]}
            </option>
          ))}
        </select>
      </label>
      {!item && (
        <label className="studio-org-label">
          Element type
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as BuildingElement["kind"])
            }
          >
            {Object.entries(captions).map(([key, caption]) => (
              <option key={key} value={key}>
                {caption}
              </option>
            ))}
          </select>
        </label>
      )}
      <form
        className="studio-fields"
        key={JSON.stringify(item ?? [currentKind, storey.id])}
        onSubmit={save}
      >
        <label>
          Element name
          <input
            name="name"
            defaultValue={item?.name}
            required
            maxLength={80}
          />
        </label>
        {currentKind !== "stair" && (
          <label>
            Footprint vertices (X Y in mm)
            <textarea
              name="footprint"
              rows={4}
              required
              defaultValue={textRing(
                item && "footprint" in item
                  ? item.footprint
                  : currentKind === "opening"
                    ? outline.map((p, i) => ({
                        x: p.x + (i === 0 || i === 3 ? 250 : -250),
                        y: p.y + (i < 2 ? 250 : -250),
                      }))
                    : outline,
              )}
            />
          </label>
        )}
        {(currentKind === "slab" || currentKind === "roof") && (
          <div className="studio-cad-parameters">
            <Input
              name="thickness"
              label="Thickness (mm)"
              value={item && "thicknessMm" in item ? item.thicknessMm : 200}
            />
            <Input
              name="offset"
              label="Vertical offset (mm)"
              value={item && "offsetMm" in item ? item.offsetMm : 0}
            />
          </div>
        )}
        {currentKind === "opening" && (
          <label>
            Host slab
            <select
              name="slab"
              required
              defaultValue={item?.kind === "opening" ? item.slabId : ""}
            >
              <option value="" disabled>
                Choose a slab
              </option>
              {slabs
                .filter((slab) => slab.storeyId === storey.id)
                .map((slab) => (
                  <option key={slab.id} value={slab.id}>
                    {slab.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {currentKind === "stair" && (
          <>
            <div className="studio-cad-parameters">
              <label>
                From storey
                <select
                  name="from"
                  defaultValue={
                    item?.kind === "stair" ? item.fromStoreyId : storey.id
                  }
                >
                  {levels.map((level) => (
                    <option value={level.id} key={level.id}>
                      {level.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                To storey
                <select
                  name="to"
                  required
                  defaultValue={
                    item?.kind === "stair"
                      ? item.toStoreyId
                      : (levels.find(
                          (level) => level.elevationMm > storey.elevationMm,
                        )?.id ?? "")
                  }
                >
                  <option value="" disabled>
                    Choose a storey
                  </option>
                  {levels.map((level) => (
                    <option value={level.id} key={level.id}>
                      {level.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <PointFields
              name="start"
              label="Start"
              value={
                item?.kind === "stair"
                  ? item.start
                  : { x: outline[0].x + 500, y: middleY }
              }
            />
            <PointFields
              name="end"
              label="End"
              value={
                item?.kind === "stair"
                  ? item.end
                  : { x: outline[2].x - 500, y: middleY }
              }
            />
            <div className="studio-cad-parameters">
              <Input
                label="Stair width (mm)"
                name="width"
                value={item?.kind === "stair" ? item.widthMm : 1000}
              />
              <Input
                label="Riser count"
                name="risers"
                value={item?.kind === "stair" ? item.risers : 16}
              />
            </div>
            <label>
              Destination slab opening
              <select
                name="slab"
                defaultValue={
                  item?.kind === "stair" ? (item.openingSlabId ?? "") : ""
                }
              >
                <option value="">No linked opening</option>
                {slabs.map((slab) => (
                  <option value={slab.id} key={slab.id}>
                    {slab.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {currentKind === "roof" && (
          <>
            <label>
              Roof profile
              <select
                name="profile"
                defaultValue={item?.kind === "roof" ? item.profile : "gable"}
              >
                <option value="flat">Flat</option>
                <option value="shed">Shed</option>
                <option value="gable">Gable</option>
              </select>
            </label>
            <div className="studio-cad-parameters">
              <Input
                name="pitch"
                label="Pitch (°)"
                value={item?.kind === "roof" ? item.pitchDeg : 25}
                step={0.1}
              />
              <Input
                name="direction"
                label="Direction (°)"
                value={item?.kind === "roof" ? item.directionDeg : 0}
                step={0.1}
              />
            </div>
          </>
        )}
        <button type="submit" className="studio-cad-apply">
          {item ? "Update element" : "Create element"}
        </button>
      </form>
      {item?.kind === "slab" && (
        <p>{openingsForSlab(building, item.id).length} floor openings</p>
      )}
      {item && (
        <button
          type="button"
          className="studio-parametric-remove"
          onClick={() => remove(item.id)}
        >
          Remove element
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function BuildingViewsPanel({
  building,
  storey,
  onCommand,
  onView,
}: {
  building: DraftPlanState;
  storey: Storey;
  onCommand: Apply;
  onView(id: string): void;
}) {
  const [kind, setKind] = useState<BuildingView["kind"]>("section");
  const [active, setActive] = useState("");
  const [error, setError] = useState("");
  const views = building.buildingViews ?? [];
  const view = views.find((item) => item.id === active);
  const viewKind = view?.kind ?? kind;
  const outline = defaultFootprint(building, storey.id);
  const mid = Math.round((outline[0].y + outline[2].y) / 2);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const id = view?.id ?? crypto.randomUUID();
      const saved = buildingViewInput.parse({
        id,
        kind: viewKind,
        name: data.get("name"),
        ...(viewKind === "section"
          ? { start: point(data, "start"), end: point(data, "end") }
          : { direction: data.get("direction") }),
      });
      onCommand({ type: "building.view", view: saved });
      setActive(id);
      onView(id);
      setError("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save the view.",
      );
    }
  }
  return (
    <>
      <label className="studio-org-label">
        Building view
        <select
          value={view?.id ?? ""}
          onChange={(event) => {
            setActive(event.target.value);
            if (event.target.value) onView(event.target.value);
            setError("");
          }}
        >
          <option value="">New view</option>
          {views.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {!view && (
        <label className="studio-org-label">
          View type
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as BuildingView["kind"])
            }
          >
            <option value="section">Section</option>
            <option value="elevation">Elevation</option>
          </select>
        </label>
      )}
      <form
        className="studio-fields"
        onSubmit={submit}
        key={JSON.stringify(view ?? [viewKind, storey.id])}
      >
        <label>
          View name
          <input
            name="name"
            defaultValue={view?.name}
            required
            maxLength={80}
          />
        </label>
        {viewKind === "section" ? (
          <>
            <PointFields
              name="start"
              label="Cut start"
              value={
                view?.kind === "section"
                  ? view.start
                  : { x: outline[0].x - 500, y: mid }
              }
            />
            <PointFields
              name="end"
              label="Cut end"
              value={
                view?.kind === "section"
                  ? view.end
                  : { x: outline[2].x + 500, y: mid }
              }
            />
          </>
        ) : (
          <label>
            Elevation side
            <select
              name="direction"
              defaultValue={
                view?.kind === "elevation" ? view.direction : "north"
              }
            >
              <option value="north">North</option>
              <option value="south">South</option>
              <option value="east">East</option>
              <option value="west">West</option>
            </select>
          </label>
        )}
        <button className="studio-cad-apply" type="submit">
          {view ? "Update view" : "Create view"}
        </button>
      </form>
      {view && (
        <button
          type="button"
          className="studio-parametric-remove"
          onClick={() => {
            try {
              onCommand({
                type: "building.remove",
                collection: "views",
                id: view.id,
              });
              setActive("");
              setError("");
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not remove the view.",
              );
            }
          }}
        >
          Remove view
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
