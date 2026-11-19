"use client";

import { useState, type FormEvent } from "react";
import {
  fixtureCatalog,
  fixtureKinds,
  utilityCatalog,
  utilityKinds,
  type FixtureKind,
  type UtilityKind,
  type UtilityLayer,
} from "@/lib/plans/catalog";
import { unitFactor } from "@/lib/plans/cad";
import type { DisplayUnit, Fixture, Point, Utility } from "@/lib/plans/model";

export type FixtureSettings = Pick<
  Fixture,
  "template" | "widthMm" | "depthMm" | "heightMm" | "rotation"
>;
export function fixtureDefaults(template: FixtureKind): FixtureSettings {
  const { widthMm, depthMm, heightMm } = fixtureCatalog[template];
  return { template, widthMm, depthMm, heightMm, rotation: 0 };
}
const groups = [
  ...new Set(fixtureKinds.map((key) => fixtureCatalog[key].group)),
];

export function Layers({
  layers,
  onToggle,
}: {
  layers: Record<UtilityLayer, boolean>;
  onToggle(layer: UtilityLayer): void;
}) {
  return (
    <section
      className="studio-fields studio-layers"
      aria-label="Utility layers"
    >
      <h3>Utility layers</h3>
      {(["electrical", "plumbing"] as const).map((layer) => (
        <label key={layer}>
          <input
            type="checkbox"
            checked={layers[layer]}
            onChange={() => onToggle(layer)}
          />
          <span className={`studio-layer-key ${layer}`} />
          {layer === "electrical" ? "Electrical" : "Plumbing"}
        </label>
      ))}
    </section>
  );
}

function readDistance(data: FormData, name: string, unit: DisplayUnit) {
  return Math.round(Number(data.get(name)) * unitFactor(unit));
}

function distance(mm: number, unit: DisplayUnit) {
  return Number((mm / unitFactor(unit)).toFixed(2));
}

function PositionFields({
  position,
  unit,
}: {
  position: Point;
  unit: DisplayUnit;
}) {
  const limit = distance(1_000_000, unit);
  return (
    <div className="studio-field-pair">
      {(["x", "y"] as const).map((axis) => (
        <label key={axis}>
          {axis.toUpperCase()} ({unit})
          <input
            name={axis}
            type="number"
            min={-limit}
            max={limit}
            step="any"
            defaultValue={distance(position[axis], unit)}
            required
          />
        </label>
      ))}
    </div>
  );
}

export function FixtureFields({
  unit,
  value,
  active,
  onSet,
}: {
  unit: DisplayUnit;
  value: FixtureSettings;
  active?: Fixture;
  onSet(value: FixtureSettings, position?: Point): void;
}) {
  const [settings, setSettings] = useState<FixtureSettings>(value);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const angle = Number(data.get("rotation"));
    onSet(
      {
        template: settings.template,
        widthMm: readDistance(data, "widthMm", unit),
        depthMm: readDistance(data, "depthMm", unit),
        heightMm: readDistance(data, "heightMm", unit),
        rotation: angle === 90 || angle === 180 || angle === 270 ? angle : 0,
      },
      active
        ? { x: readDistance(data, "x", unit), y: readDistance(data, "y", unit) }
        : undefined,
    );
  }
  return (
    <form className="studio-fields" onSubmit={save}>
      <h3>{active ? "Selected fixture" : "Fixture catalog"}</h3>
      {!active && (
        <p>
          Choose a template and apply its dimensions, then click the plan to
          place it.
        </p>
      )}
      <label>
        Fixture template
        <select
          value={settings.template}
          onChange={(event) => {
            const template = event.currentTarget.value as FixtureKind;
            setSettings(fixtureDefaults(template));
          }}
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {fixtureKinds
                .filter((key) => fixtureCatalog[key].group === group)
                .map((key) => (
                  <option key={key} value={key}>
                    {fixtureCatalog[key].label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="studio-fields-compact" key={settings.template}>
        {(
          [
            ["widthMm", "Width", 50],
            ["depthMm", "Depth", 50],
            ["heightMm", "Height", 1],
          ] as const
        ).map(([id, label, min]) => (
          <label key={id}>
            {label} ({unit})
            <input
              type="number"
              name={id}
              min={distance(min, unit)}
              max={distance(10_000, unit)}
              step="any"
              defaultValue={distance(settings[id], unit)}
              required
            />
          </label>
        ))}
      </div>
      <label>
        Rotation
        <select name="rotation" defaultValue={value.rotation}>
          {[0, 90, 180, 270].map((angle) => (
            <option key={angle} value={angle}>
              {angle}°
            </option>
          ))}
        </select>
      </label>
      {active && <PositionFields position={active.position} unit={unit} />}
      <button className="studio-apply" type="submit">
        {active ? "Update fixture" : "Apply fixture settings"}
      </button>
    </form>
  );
}

export function UtilityFields({
  unit,
  value,
  active,
  onSet,
}: {
  unit: DisplayUnit;
  value: UtilityKind;
  active?: Utility;
  onSet(template: UtilityKind, position?: Point): void;
}) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const template = data.get("template") as UtilityKind;
    onSet(
      template,
      active
        ? { x: readDistance(data, "x", unit), y: readDistance(data, "y", unit) }
        : undefined,
    );
  }
  return (
    <form className="studio-fields" onSubmit={save}>
      <h3>{active ? "Selected utility" : "Utility symbols"}</h3>
      {!active && <p>Choose a symbol, apply it, then click the plan.</p>}
      <label>
        Utility symbol
        <select name="template" defaultValue={value}>
          {(["electrical", "plumbing"] as const).map((layer) => (
            <optgroup
              key={layer}
              label={layer === "electrical" ? "Electrical" : "Plumbing"}
            >
              {utilityKinds
                .filter((key) => utilityCatalog[key].layer === layer)
                .map((key) => (
                  <option key={key} value={key}>
                    {utilityCatalog[key].label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {active && <PositionFields position={active.position} unit={unit} />}
      <button className="studio-apply" type="submit">
        {active ? "Update utility" : "Apply utility settings"}
      </button>
    </form>
  );
}
