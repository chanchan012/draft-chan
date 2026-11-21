"use client";

import { useState, type FormEvent } from "react";
import { cadEditSchema, type CadEdit } from "@/lib/plans/cad-edit";
import type { Selection } from "@/lib/plans/editor-selection";

const operations = [
  ["move", "Move"],
  ["copy", "Copy"],
  ["rotate", "Rotate"],
  ["mirror", "Mirror"],
  ["offset", "Offset"],
  ["trim", "Trim"],
  ["extend", "Extend"],
  ["chamfer", "Chamfer"],
  ["fillet", "Fillet"],
  ["linear", "Linear array"],
  ["polar", "Polar array"],
] as const;
type Mode = (typeof operations)[number][0];
const isLine = (item: Selection) =>
  item.kind === "wall" || item.kind === "sketch";

function NumberField({
  label,
  name,
  initial = 0,
}: {
  label: string;
  name: string;
  initial?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        required
        step="any"
        name={name}
        defaultValue={initial}
      />
    </label>
  );
}

export function CadEditPanel({
  selection,
  onApply,
}: {
  selection: readonly Selection[];
  onApply(input: CadEdit): string;
}) {
  const [mode, setMode] = useState<Mode>("move");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();
  const offset = mode === "offset";
  const corner = mode === "chamfer" || mode === "fillet";
  const boundary = mode === "trim" || mode === "extend";
  const usePair = boundary || corner;
  const useLines = offset || usePair;
  const enough = useLines
    ? selection.length === (offset ? 1 : 2) && selection.every(isLine)
    : selection.length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enough) return;
    const data = new FormData(event.currentTarget);
    const num = (field: string) => Number(data.get(field));
    const xy = (a: string, b: string) => ({ x: num(a), y: num(b) });
    const [first, second] = selection;
    const entities = [...selection];
    let body: unknown;
    switch (mode) {
      case "move":
      case "copy":
        body = {
          operation: "transform",
          entities,
          transform: { mode, delta: xy("x", "y") },
        };
        break;
      case "rotate":
        body = {
          operation: "transform",
          entities,
          transform: { mode, pivot: xy("x", "y"), angleDeg: num("angle") },
        };
        break;
      case "mirror":
        body = {
          operation: "transform",
          entities,
          transform: {
            mode,
            axisStart: xy("x", "y"),
            axisEnd: xy("endX", "endY"),
            copy: data.has("keep"),
          },
        };
        break;
      case "offset":
        body = {
          operation: "offset",
          entity: first,
          distanceMm: num("size"),
          copy: data.has("keep"),
        };
        break;
      case "trim":
      case "extend":
        body = {
          operation: "trim_extend",
          entity: first,
          boundary: second,
          endpoint: data.get("endpoint"),
          mode,
        };
        break;
      case "chamfer":
      case "fillet":
        body = {
          operation: "corner",
          first,
          second,
          mode,
          sizeMm: num("size"),
        };
        break;
      case "linear":
      case "polar":
        body = {
          operation: "array",
          entities,
          count: num("count"),
          pattern:
            mode === "linear"
              ? { mode, step: xy("x", "y") }
              : { mode, center: xy("x", "y"), stepDeg: num("angle") },
        };
        break;
    }
    try {
      const input = cadEditSchema.parse(body);
      setFeedback({ text: onApply(input), error: false });
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? error.message
            : "This edit could not be applied.",
        error: true,
      });
    }
  }

  const xyName =
    mode === "move" || mode === "copy" || mode === "linear"
      ? "Displacement"
      : mode === "mirror"
        ? "Axis start"
        : "Pivot";
  return (
    <form className="studio-fields studio-cad-edit" onSubmit={submit}>
      <label>
        Operation
        <select
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as Mode);
            setFeedback(undefined);
          }}
        >
          {operations.map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p>
        {usePair
          ? boundary
            ? "Multi-select the target first and the boundary second."
            : "Select two lines that share an endpoint."
          : offset
            ? "Select one wall or sketch."
            : "Select objects on the plan. Doors and windows follow their host wall."}
      </p>
      <div key={mode} className="studio-cad-parameters">
        {!useLines && (
          <>
            <NumberField
              name="x"
              label={xyName + " X (mm)"}
              initial={xyName === "Displacement" ? 500 : 0}
            />
            <NumberField name="y" label={xyName + " Y (mm)"} />
          </>
        )}
        {mode === "mirror" && (
          <>
            <NumberField name="endX" label="Axis end X (mm)" />
            <NumberField name="endY" label="Axis end Y (mm)" initial={1000} />
          </>
        )}
        {(mode === "mirror" || offset) && (
          <label className="studio-cad-checkbox">
            <input type="checkbox" name="keep" defaultChecked={offset} /> Keep
            original
          </label>
        )}
        {(offset || corner) && (
          <NumberField
            name="size"
            label={mode === "fillet" ? "Radius (mm)" : "Distance (mm)"}
            initial={150}
          />
        )}
        {boundary && (
          <label>
            Endpoint
            <select name="endpoint" defaultValue="end">
              <option value="start">Start</option>
              <option value="end">End</option>
            </select>
          </label>
        )}
        {(mode === "rotate" || mode === "polar") && (
          <NumberField name="angle" label="Clockwise angle (°)" initial={90} />
        )}
        {(mode === "linear" || mode === "polar") && (
          <NumberField
            name="count"
            label="Count including original"
            initial={3}
          />
        )}
      </div>
      <button className="studio-cad-apply" type="submit" disabled={!enough}>
        Apply edit
      </button>
      {feedback && (
        <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>
      )}
    </form>
  );
}
