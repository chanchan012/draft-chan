"use client";

import type { ReactNode } from "react";
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
import { LiveDistance } from "./live-number";
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
  selectedCount: number;
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
      {props.selectedCount > 1 ? (
        <section className="studio-fields">
          <h3>{props.selectedCount} selected</h3>
          <p>
            Drag an item in the selection or use the arrow keys to move the
            group.
          </p>
        </section>
      ) : activeWall || (!activeDoor && tool === "wall") ? (
        <section
          className="studio-fields"
          key={JSON.stringify([activeWall?.id, unit])}
        >
          <h3>{activeWall ? "Selected wall" : "Wall tool"}</h3>
          <p>
            {activeWall
              ? `Length ${number.format(wallLength(activeWall) / factor)} ${unit}`
              : "Place two points or drag to draw a wall."}
          </p>
          <LiveDistance
            label="Thickness"
            unit={unit}
            value={wall.thicknessMm}
            min={1}
            max={10000}
            onValue={(thicknessMm) =>
              props.onWall({ thicknessMm, kind: wall.kind })
            }
          />
          <label>
            Wall type
            <select
              value={wall.kind}
              onChange={(event) =>
                props.onWall({
                  kind:
                    event.target.value === "exterior" ? "exterior" : "interior",
                  thicknessMm: wall.thicknessMm,
                })
              }
            >
              <option value="interior">Interior</option>
              <option value="exterior">Exterior</option>
            </select>
          </label>
        </section>
      ) : activeDoor || tool === "door" ? (
        <section
          className="studio-fields"
          key={JSON.stringify([activeDoor?.id, unit])}
        >
          <h3>{activeDoor ? "Selected door" : "Door tool"}</h3>
          {!activeDoor && <p>Choose a point on a wall to place a door.</p>}
          <LiveDistance
            label="Width"
            unit={unit}
            value={door.widthMm}
            min={100}
            max={10000}
            onValue={(widthMm) =>
              props.onDoor({ widthMm, hinge: door.hinge, swing: door.swing })
            }
          />
          <label>
            Hinge
            <select
              value={door.hinge}
              onChange={(event) =>
                props.onDoor({
                  hinge: event.target.value === "end" ? "end" : "start",
                  widthMm: door.widthMm,
                  swing: door.swing,
                })
              }
            >
              <option value="start">Start of opening</option>
              <option value="end">End of opening</option>
            </select>
          </label>
          <label>
            Swing
            <select
              value={door.swing}
              onChange={(event) =>
                props.onDoor({
                  swing: event.target.value === "right" ? "right" : "left",
                  widthMm: door.widthMm,
                  hinge: door.hinge,
                })
              }
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
        </section>
      ) : null}
      {props.placementFields}
      {props.layers}
      {(activeWall ||
        activeDoor ||
        props.placementSelected ||
        props.selectedCount > 1) && (
        <button
          className="studio-remove"
          onClick={props.onRemove}
          type="button"
        >
          <Trash2 size={15} />
          {props.selectedCount > 1
            ? "Delete selected items"
            : props.placementSelected
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
