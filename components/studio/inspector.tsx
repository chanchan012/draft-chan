"use client";

import type { FormEvent, ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { gridSteps, unitFactor } from "@/lib/plans/cad";
import { wallLength } from "@/lib/plans/openings";
import type {
  DisplayUnit,
  Door,
  DraftPlanState,
  Wall,
} from "@/lib/plans/model";
import { polygonAreaMm2 } from "@/lib/plans/polygon";
import type { Tool } from "./surface";

export type WallSettings = Pick<Wall, "thicknessMm" | "kind">;
export type DoorSettings = Pick<Door, "widthMm" | "hinge" | "swing">;

interface InspectorProps {
  plan: DraftPlanState;
  tool: Tool;
  unit: DisplayUnit;
  gridIndex: number;
  wall: WallSettings;
  door: DoorSettings;
  activeWall?: Wall;
  activeDoor?: Door;
  placementFields?: ReactNode;
  layers?: ReactNode;
  placementSelected?: "fixture" | "utility";
  onUnit(unit: DisplayUnit): void;
  onGrid(index: number): void;
  onWall(value: WallSettings): void;
  onDoor(value: DoorSettings): void;
  onRemove(): void;
}
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function Inspector(props: InspectorProps) {
  const { plan, tool, unit, gridIndex, activeWall, activeDoor } = props;
  const wall = activeWall ?? props.wall;
  const door = activeDoor ?? props.door;
  const area = plan.rooms.reduce(
    (sum, room) => sum + polygonAreaMm2(room.polygon, room.holes),
    0,
  );
  const factor = unitFactor(unit);
  const display = (mm: number) => Number((mm / factor).toFixed(2));
  const mm = (value: FormDataEntryValue | null) =>
    Math.round(Number(value) * factor);

  function saveWall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    props.onWall({
      thicknessMm: mm(data.get("thickness")),
      kind: data.get("kind") === "exterior" ? "exterior" : "interior",
    });
  }
  function saveDoor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    props.onDoor({
      widthMm: mm(data.get("width")),
      hinge: data.get("hinge") === "end" ? "end" : "start",
      swing: data.get("swing") === "right" ? "right" : "left",
    });
  }

  return (
    <div className="studio-inspector-content">
      <h2>Inspector</h2>
      <section className="studio-fields" aria-label="Drawing settings">
        <label>
          Units
          <select
            value={unit}
            onChange={(event) =>
              props.onUnit(event.target.value === "in" ? "in" : "mm")
            }
          >
            <option value="mm">Millimeters</option>
            <option value="in">Inches</option>
          </select>
        </label>
        <label>
          Snap spacing
          <select
            value={gridIndex}
            onChange={(event) => props.onGrid(Number(event.target.value))}
          >
            {gridSteps[unit].map((step, index) => (
              <option key={step} value={index}>
                {step} {unit}
              </option>
            ))}
          </select>
        </label>
      </section>
      {activeWall || (!activeDoor && tool === "wall") ? (
        <form
          className="studio-fields"
          onSubmit={saveWall}
          key={JSON.stringify([
            activeWall?.id,
            wall.kind,
            wall.thicknessMm,
            unit,
          ])}
        >
          <h3>{activeWall ? "Selected wall" : "Wall tool"}</h3>
          <p>
            {activeWall
              ? `Length ${number.format(wallLength(activeWall) / factor)} ${unit}`
              : "Place two points or drag to draw a wall."}
          </p>
          <label>
            Thickness ({unit})
            <input
              name="thickness"
              type="number"
              min={unit === "mm" ? 1 : 0.04}
              max={display(10000)}
              step={unit === "mm" ? 1 : 0.01}
              required
              defaultValue={display(wall.thicknessMm)}
            />
          </label>
          <label>
            Wall type
            <select name="kind" defaultValue={wall.kind}>
              <option value="interior">Interior</option>
              <option value="exterior">Exterior</option>
            </select>
          </label>
          <button type="submit" className="studio-apply">
            {activeWall ? "Update wall" : "Apply settings"}
          </button>
        </form>
      ) : activeDoor || tool === "door" ? (
        <form
          className="studio-fields"
          onSubmit={saveDoor}
          key={JSON.stringify([
            activeDoor?.id,
            door.widthMm,
            door.hinge,
            door.swing,
            unit,
          ])}
        >
          <h3>{activeDoor ? "Selected door" : "Door tool"}</h3>
          {!activeDoor && <p>Choose a point on a wall to place a door.</p>}
          <label>
            Width ({unit})
            <input
              name="width"
              type="number"
              min={display(100)}
              max={display(10000)}
              step={unit === "mm" ? 1 : 0.01}
              required
              defaultValue={display(door.widthMm)}
            />
          </label>
          <label>
            Hinge
            <select name="hinge" defaultValue={door.hinge}>
              <option value="start">Start of opening</option>
              <option value="end">End of opening</option>
            </select>
          </label>
          <label>
            Swing
            <select name="swing" defaultValue={door.swing}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <button type="submit" className="studio-apply">
            {activeDoor ? "Update door" : "Apply settings"}
          </button>
        </form>
      ) : null}
      {props.placementFields}
      {props.layers}
      {(activeWall || activeDoor || props.placementSelected) && (
        <button
          className="studio-remove"
          onClick={props.onRemove}
          type="button"
        >
          <Trash2 size={15} />
          {props.placementSelected
            ? `Delete ${props.placementSelected}`
            : activeDoor
              ? "Delete door"
              : plan.openings.some((item) => item.wallId === activeWall?.id)
                ? "Delete wall and doors"
                : "Delete wall"}
        </button>
      )}
      <section
        className="studio-fields studio-quantities"
        aria-label="Plan quantities"
      >
        <h3>Plan quantities</h3>
        <dl>
          <div>
            <dt>Walls</dt>
            <dd>{plan.walls.length}</dd>
          </div>
          <div>
            <dt>Doors</dt>
            <dd>{plan.openings.length}</dd>
          </div>
          <div>
            <dt>Fixtures</dt>
            <dd>{plan.fixtures.length}</dd>
          </div>
          <div>
            <dt>Utilities</dt>
            <dd>{plan.utilities.length}</dd>
          </div>
          <div>
            <dt>Rooms</dt>
            <dd>{plan.rooms.length}</dd>
          </div>
          <div>
            <dt>Area</dt>
            <dd>
              {number.format(
                unit === "in" ? area / 92903.04 : area / 1_000_000,
              )}{" "}
              {unit === "in" ? "ft²" : "m²"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
