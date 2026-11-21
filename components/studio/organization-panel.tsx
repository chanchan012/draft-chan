"use client";

import { useState, type FormEvent } from "react";
import { fixtureCatalog, fixtureKinds } from "@/lib/plans/catalog";
import {
  blockInput,
  blockPlacementInput,
  drawingLayerInput,
  type BlockDefinition,
  type DraftPlanState,
  type DrawingEntity,
  type DrawingLayer,
  type PlanCommand,
  type ReusableKind,
} from "@/lib/plans/model";
import { entityKey } from "@/lib/plans/organization";

type Apply = (command: PlanCommand) => void;

function useAction(onCommand: Apply) {
  const [error, setError] = useState("");
  const run = (getCommand: () => PlanCommand) => {
    try {
      onCommand(getCommand());
      setError("");
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The drawing could not be updated.",
      );
      return false;
    }
  };
  return { error, run };
}

function number(data: FormData, name: string) {
  return Number(data.get(name));
}

function NumberField({
  name,
  label,
  value,
  optional = false,
}: {
  name: string;
  label: string;
  value?: number;
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        name={name}
        defaultValue={value}
        required={!optional}
      />
    </label>
  );
}

export function NamedLayersPanel({
  plan,
  selection,
  onCommand,
}: {
  plan: DraftPlanState;
  selection: readonly DrawingEntity[];
  onCommand: Apply;
}) {
  const { error, run } = useAction(onCommand);
  const [active, setActive] = useState("");
  const layers = plan.drawingLayers ?? [];
  const layer = layers.find((item) => item.id === active) ?? layers[0];
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    const id = crypto.randomUUID();
    if (
      run(() => ({
        type: "layer.write",
        layer: drawingLayerInput.parse({
          id,
          name,
          visible: true,
          locked: false,
          color: "#355f6c",
          lineStyle: "solid",
          members: [],
        }),
      }))
    ) {
      setActive(id);
      event.currentTarget.reset();
    }
  }
  const replace = (changes: Partial<DrawingLayer>) =>
    layer &&
    run(() => ({
      type: "layer.write",
      layer: drawingLayerInput.parse({ ...layer, ...changes }),
    }));
  return (
    <div className="studio-parametric">
      <strong>Named layers</strong>
      <form
        className="studio-fields"
        aria-label="Create named layer"
        onSubmit={add}
      >
        <label>
          New layer name
          <input name="name" required maxLength={80} />
        </label>
        <button className="studio-cad-apply" type="submit">
          Create layer
        </button>
      </form>
      {layer && (
        <div className="studio-parametric-item">
          <label className="studio-org-label">
            Named layer
            <select
              value={layer.id}
              onChange={(event) => setActive(event.target.value)}
            >
              {layers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <form
            key={layer.id + layer.name + layer.color + layer.lineStyle}
            className="studio-fields"
            aria-label="Layer style"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              replace({
                name: String(data.get("name")),
                color: String(data.get("color")),
                lineStyle: data.get("line") as DrawingLayer["lineStyle"],
              });
            }}
          >
            <label>
              Layer name
              <input
                name="name"
                required
                maxLength={80}
                defaultValue={layer.name}
              />
            </label>
            <div className="studio-cad-parameters">
              <label>
                Layer color
                <input type="color" name="color" defaultValue={layer.color} />
              </label>
              <label>
                Line style
                <select name="line" defaultValue={layer.lineStyle}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </label>
            </div>
            <button className="studio-cad-apply" type="submit">
              Save layer style
            </button>
          </form>
          <label className="studio-org-toggle">
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(event) => replace({ visible: event.target.checked })}
            />{" "}
            Show layer
          </label>
          <label className="studio-org-toggle">
            <input
              type="checkbox"
              checked={layer.locked}
              onChange={(event) => replace({ locked: event.target.checked })}
            />{" "}
            Lock layer
          </label>
          <p>{layer.members.length} assigned objects</p>
          <button
            className="studio-cad-apply"
            type="button"
            disabled={layer.locked || !selection.length}
            onClick={() =>
              replace({
                members: [
                  ...new Map(
                    [...layer.members, ...selection].map((item) => [
                      entityKey(item),
                      item,
                    ]),
                  ).values(),
                ],
              })
            }
          >
            Assign selection
          </button>
          <button
            className="studio-parametric-remove"
            type="button"
            disabled={layer.locked || !selection.length}
            onClick={() => {
              const keys = new Set(selection.map(entityKey));
              replace({
                members: layer.members.filter(
                  (item) => !keys.has(entityKey(item)),
                ),
              });
            }}
          >
            Unassign selection
          </button>
          <button
            className="studio-parametric-remove"
            type="button"
            disabled={layer.locked}
            onClick={() => run(() => ({ type: "layer.remove", id: layer.id }))}
          >
            Remove layer
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function ParameterFields({ definition }: { definition: BlockDefinition }) {
  const { kind, parameters } = definition;
  return (
    <>
      <NumberField
        name="width"
        label="Default width (mm)"
        value={parameters.widthMm}
      />
      {kind === "door" && (
        <>
          <label>
            Default hinge
            <select name="hinge" defaultValue={parameters.hinge}>
              <option value="start">Start</option>
              <option value="end">End</option>
            </select>
          </label>
          <label>
            Default swing
            <select name="swing" defaultValue={parameters.swing}>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
        </>
      )}
      {kind === "window" && (
        <NumberField
          name="sill"
          label="Default sill (mm)"
          value={parameters.sillMm}
        />
      )}
      {kind === "fixture" && (
        <>
          <label>
            Fixture template
            <select name="template" defaultValue={parameters.template}>
              {fixtureKinds.map((value) => (
                <option value={value} key={value}>
                  {fixtureCatalog[value].label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            name="depth"
            label="Default depth (mm)"
            value={parameters.depthMm}
          />
        </>
      )}
      {kind !== "door" && (
        <NumberField
          name="height"
          label="Default height (mm)"
          value={parameters.heightMm}
        />
      )}
    </>
  );
}

function newDefinition(
  id: string,
  name: string,
  kind: ReusableKind,
): BlockDefinition {
  switch (kind) {
    case "door":
      return {
        id,
        name,
        kind,
        parameters: { widthMm: 900, hinge: "start", swing: "right" },
      };
    case "window":
      return {
        id,
        name,
        kind,
        parameters: { widthMm: 1200, sillMm: 900, heightMm: 900 },
      };
    case "fixture": {
      const { widthMm, depthMm, heightMm } = fixtureCatalog.sofa;
      return {
        id,
        name,
        kind,
        parameters: { template: "sofa", widthMm, depthMm, heightMm },
      };
    }
  }
}

export function BlocksPanel({
  plan,
  selectedWall,
  onCommand,
}: {
  plan: DraftPlanState;
  selectedWall?: string;
  onCommand: Apply;
}) {
  const { error, run } = useAction(onCommand);
  const [active, setActive] = useState("");
  const definitions = plan.blocks ?? [];
  const block =
    definitions.find((item) => item.id === active) ?? definitions[0];
  const linked =
    plan.blockInstances?.filter((item) => item.blockId === block?.id) ?? [];
  return (
    <div className="studio-parametric">
      <form
        aria-label="Create block definition"
        className="studio-fields"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const id = crypto.randomUUID();
          if (
            run(() => ({
              type: "block.define",
              definition: blockInput.parse(
                newDefinition(
                  id,
                  String(data.get("name")),
                  data.get("kind") as ReusableKind,
                ),
              ),
            }))
          ) {
            setActive(id);
            event.currentTarget.reset();
          }
        }}
      >
        <label>
          New block name
          <input name="name" required maxLength={80} />
        </label>
        <label>
          Block type
          <select name="kind">
            <option value="door">Door type</option>
            <option value="window">Window type</option>
            <option value="fixture">Fixture type</option>
          </select>
        </label>
        <button className="studio-cad-apply" type="submit">
          Create definition
        </button>
      </form>
      {block && (
        <>
          <label className="studio-org-label">
            Block definition
            <select
              value={block.id}
              onChange={(event) => setActive(event.target.value)}
            >
              {definitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            {linked.length} linked instances ·{" "}
            {linked.filter((item) => Object.keys(item.overrides).length).length}{" "}
            with overrides
          </p>
          <form
            className="studio-fields studio-parametric-item"
            aria-label="Edit block defaults"
            key={JSON.stringify(block)}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const widthMm = number(data, "width");
              const parameters =
                block.kind === "door"
                  ? {
                      widthMm,
                      hinge: data.get("hinge"),
                      swing: data.get("swing"),
                    }
                  : block.kind === "window"
                    ? {
                        widthMm,
                        sillMm: number(data, "sill"),
                        heightMm: number(data, "height"),
                      }
                    : {
                        widthMm,
                        template: data.get("template"),
                        depthMm: number(data, "depth"),
                        heightMm: number(data, "height"),
                      };
              run(() => ({
                type: "block.update",
                definition: blockInput.parse({ ...block, parameters }),
              }));
            }}
          >
            <ParameterFields definition={block} />
            <button className="studio-cad-apply" type="submit">
              Update definition
            </button>
          </form>
          <form
            className="studio-fields studio-parametric-item"
            aria-label="Insert block instance"
            key={block.id + ":" + selectedWall}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const overrides = data.get("width")
                ? { widthMm: number(data, "width") }
                : undefined;
              const placement =
                block.kind === "fixture"
                  ? {
                      kind: block.kind,
                      position: { x: number(data, "x"), y: number(data, "y") },
                      rotation: number(data, "rotation"),
                      overrides,
                    }
                  : {
                      kind: block.kind,
                      wallId: data.get("host"),
                      offsetMm: number(data, "offset"),
                      overrides,
                    };
              run(() => ({
                type: "block.insert",
                id: crypto.randomUUID(),
                blockId: block.id,
                placement: blockPlacementInput.parse(placement),
              }));
            }}
          >
            {block.kind === "fixture" ? (
              <>
                <div className="studio-cad-parameters">
                  <NumberField name="x" label="X (mm)" value={0} />
                  <NumberField name="y" label="Y (mm)" value={0} />
                </div>
                <label>
                  Rotation
                  <select name="rotation">
                    {[0, 90, 180, 270].map((angle) => (
                      <option key={angle} value={angle}>
                        {angle}°
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Host wall
                  <select
                    name="host"
                    required
                    defaultValue={selectedWall ?? plan.walls[0]?.id}
                  >
                    {plan.walls.map((wall, index) => (
                      <option key={wall.id} value={wall.id}>
                        Wall {index + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  name="offset"
                  label="Host offset (mm)"
                  value={1000}
                />
              </>
            )}
            <NumberField
              name="width"
              label="Instance width override (mm)"
              optional
            />
            <button
              className="studio-cad-apply"
              type="submit"
              disabled={block.kind !== "fixture" && !plan.walls.length}
            >
              Insert block
            </button>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
