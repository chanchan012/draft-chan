"use client";

import { useState } from "react";
import { unitFactor } from "@/lib/plans/cad";
import type { DisplayUnit } from "@/lib/plans/model";

export function LiveDistance({
  label,
  value,
  unit,
  min,
  max,
  onValue,
}: {
  label: string;
  value: number;
  unit: DisplayUnit;
  min: number;
  max: number;
  onValue(value: number): void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const factor = unitFactor(unit);
  const display = (mm: number) => Number((mm / factor).toFixed(2));
  return (
    <label>
      {label} ({unit})
      <input
        type="number"
        min={display(min)}
        max={display(max)}
        step="any"
        value={editing ?? display(value)}
        onBlur={() => setEditing(null)}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setEditing(raw);
          const mm = Math.round(Number(raw) * factor);
          if (
            raw !== "" &&
            Number.isFinite(mm) &&
            mm >= min &&
            mm <= max &&
            mm !== value
          )
            onValue(mm);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Escape")
            event.currentTarget.blur();
        }}
      />
    </label>
  );
}
