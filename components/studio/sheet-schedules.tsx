import { useMemo, useState } from "react";
import {
  finishRoom,
  roomLabelPoint,
  schedules,
  scheduleTables,
  type RoomFinish,
} from "@/lib/plans/construction-schedules";
import { polygonAreaMm2 } from "@/lib/plans/polygon";
import type { DraftPlanState, PlanCommand } from "@/lib/plans/model";

export function SheetSchedules({
  building,
  plan,
  storeyId,
  dispatch,
}: {
  building: DraftPlanState;
  plan: DraftPlanState;
  storeyId: string;
  dispatch(command: PlanCommand): boolean;
}) {
  const [draftId, setDraftId] = useState("");
  const [error, setError] = useState("");
  const tables = useMemo(() => scheduleTables(schedules(building)), [building]);
  const finishes =
    building.documentItems?.filter(
      (item): item is RoomFinish =>
        item.kind === "finish" && item.storeyId === storeyId,
    ) ?? [];
  const selected = finishes.find(({ id }) => id === draftId);
  const roomId = selected && finishRoom(plan, selected)?.id;
  return (
    <>
      <label>
        Room finish
        <select
          value={selected?.id ?? ""}
          onChange={(event) => setDraftId(event.target.value)}
        >
          <option value="">New room finish</option>
          {finishes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.room}
            </option>
          ))}
        </select>
      </label>
      {plan.rooms.length ? (
        <form
          className="studio-fields"
          key={JSON.stringify(selected) ?? storeyId}
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const value = (name: string) =>
              String(fields.get(name) ?? "").trim();
            const room = plan.rooms.find(({ id }) => id === value("region"));
            if (!room) return;
            const id = selected?.id ?? crypto.randomUUID();
            let point;
            try {
              point =
                roomId === room.id && selected
                  ? selected.point
                  : roomLabelPoint(room);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "The room needs a valid interior point.",
              );
              return;
            }
            setError("");
            if (
              dispatch({
                type: "document.write",
                item: {
                  kind: "finish",
                  id,
                  storeyId,
                  point,
                  room: value("name"),
                  floor: value("floor"),
                  walls: value("walls"),
                  ceiling: value("ceiling"),
                },
              })
            )
              setDraftId(id);
          }}
        >
          <label>
            Enclosed room
            <select name="region" required defaultValue={roomId ?? ""}>
              <option value="" disabled>
                Choose a room
              </option>
              {plan.rooms.map((room, i) => (
                <option key={room.id} value={room.id}>
                  Room {i + 1} ·{" "}
                  {(
                    polygonAreaMm2(room.polygon, room.holes) / 1_000_000
                  ).toFixed(1)}{" "}
                  m²
                </option>
              ))}
            </select>
          </label>
          <label>
            Room name
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={selected?.room}
            />
          </label>
          <label>
            Floor finish
            <input
              name="floor"
              required
              maxLength={120}
              defaultValue={selected?.floor}
            />
          </label>
          <label>
            Wall finish
            <input
              name="walls"
              required
              maxLength={120}
              defaultValue={selected?.walls}
            />
          </label>
          <label>
            Ceiling finish
            <input
              name="ceiling"
              required
              maxLength={120}
              defaultValue={selected?.ceiling}
            />
          </label>
          <button type="submit" className="studio-cad-apply">
            {selected ? "Update finish" : "Save finish"}
          </button>
        </form>
      ) : (
        <p>Draw an enclosed room on this storey to assign finishes.</p>
      )}
      {error && (
        <p className="sheets-error" role="alert">
          {error}
        </p>
      )}
      {selected && (
        <button
          type="button"
          className="studio-cad-apply"
          onClick={() => {
            if (dispatch({ type: "document.remove", id: selected.id }))
              setDraftId("");
          }}
        >
          Remove finish
        </button>
      )}
      {tables.map((table) => (
        <details key={table.key} className="sheets-schedule">
          <summary>
            {table.title} <span>{table.rows.length}</span>
          </summary>
          {!table.rows.length ? (
            <p>No entries</p>
          ) : (
            table.rows.map((row, i) => (
              <dl key={i}>
                {row.map((cell, j) => (
                  <div key={table.columns[j]}>
                    <dt>{table.columns[j]}</dt>
                    <dd>{cell}</dd>
                  </div>
                ))}
              </dl>
            ))
          )}
        </details>
      ))}
    </>
  );
}
