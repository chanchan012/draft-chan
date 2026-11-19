"use client";

import {
  fixtureCatalog,
  fixtureKinds,
  utilityCatalog,
  utilityKinds,
  type FixtureKind,
  type UtilityKind,
  type UtilityLayer,
} from "@/lib/plans/catalog";
import { LiveDistance } from "./live-number";
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

function PositionFields({
  position,
  unit,
  onPosition,
}: {
  position: Point;
  unit: DisplayUnit;
  onPosition(position: Point): void;
}) {
  return (
    <div className="studio-field-pair">
      {(["x", "y"] as const).map((axis) => (
        <LiveDistance
          key={axis}
          label={axis.toUpperCase()}
          unit={unit}
          value={position[axis]}
          min={-1_000_000}
          max={1_000_000}
          onValue={(value) => onPosition({ ...position, [axis]: value })}
        />
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
  onSet(changes: Partial<FixtureSettings> & { position?: Point }): void;
}) {
  return (
    <section className="studio-fields" key={unit}>
      <h3>{active ? "Selected fixture" : "Fixture catalog"}</h3>
      {!active && (
        <p>Choose a template, then click or tap the plan to place it.</p>
      )}
      <label>
        Fixture template
        <select
          value={value.template}
          onChange={(event) =>
            onSet(fixtureDefaults(event.target.value as FixtureKind))
          }
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
      <div className="studio-fields-compact" key={value.template}>
        {(
          [
            ["widthMm", "Width", 50],
            ["depthMm", "Depth", 50],
            ["heightMm", "Height", 1],
          ] as const
        ).map(([id, label, min]) => (
          <LiveDistance
            key={id}
            label={label}
            unit={unit}
            value={value[id]}
            min={min}
            max={10_000}
            onValue={(mm) => onSet({ [id]: mm })}
          />
        ))}
      </div>
      <label>
        Rotation
        <select
          value={value.rotation}
          onChange={(event) => {
            const angle = Number(event.target.value);
            onSet({
              rotation:
                angle === 90 || angle === 180 || angle === 270 ? angle : 0,
            });
          }}
        >
          {[0, 90, 180, 270].map((angle) => (
            <option key={angle} value={angle}>
              {angle}°
            </option>
          ))}
        </select>
      </label>
      {active && (
        <PositionFields
          position={active.position}
          unit={unit}
          onPosition={(position) => onSet({ position })}
        />
      )}
    </section>
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
  onSet(changes: { template?: UtilityKind; position?: Point }): void;
}) {
  return (
    <section className="studio-fields" key={unit}>
      <h3>{active ? "Selected utility" : "Utility symbols"}</h3>
      {!active && (
        <p>Choose a symbol, then click or tap the plan to place it.</p>
      )}
      <label>
        Utility symbol
        <select
          value={value}
          onChange={(event) =>
            onSet({ template: event.target.value as UtilityKind })
          }
        >
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
      {active && (
        <PositionFields
          position={active.position}
          unit={unit}
          onPosition={(position) => onSet({ position })}
        />
      )}
    </section>
  );
}
