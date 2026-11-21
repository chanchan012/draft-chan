import { useState, type FormEvent, type ReactNode } from "react";
import {
  anchorPoint,
  markAnchors,
  paperSize,
} from "@/lib/plans/drawing-documents";
import { planStoreys } from "@/lib/plans/storeys";
import { viewCenter } from "@/lib/plans/sheet-drawing";
import type {
  DocumentAnchor,
  DocumentItem,
  DrawingMark,
  DraftPlanState,
  PlanCommand,
  Sheet,
  Storey,
} from "@/lib/plans/model";
import type { Selection } from "@/lib/plans/editor-selection";

type ItemOf<K extends DocumentItem["kind"]> = Extract<
  DocumentItem,
  { kind: K }
>;
const text = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
const number = (data: FormData, name: string) => Number(text(data, name));
const position = (data: FormData, x: string, y: string) => ({
  x: number(data, x),
  y: number(data, y),
});
const key = () => crypto.randomUUID();

function NumberField({
  label,
  name,
  value,
  min,
  step = "1",
}: {
  label: string;
  name: string;
  value: number;
  min?: number;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        required
        type="number"
        name={name}
        min={min}
        step={step}
        defaultValue={value}
      />
    </label>
  );
}

function Form({
  onSubmit,
  children,
  label,
}: {
  onSubmit(data: FormData): void;
  children: ReactNode;
  label: string;
}) {
  return (
    <form
      className="sheets-form studio-fields"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      {children}
      <button className="studio-cad-apply" type="submit">
        {label}
      </button>
    </form>
  );
}

type MarkKind = "chain" | "leader" | "tag" | "hatch";
const markNames: Record<MarkKind, string> = {
  chain: "Dimension chain",
  leader: "Leader",
  tag: "Tag",
  hatch: "Hatch",
};

export function SheetsPanel({
  building,
  plan,
  level,
  selection,
  sheet,
  showSheet,
  onCommand,
}: {
  building: DraftPlanState;
  plan: DraftPlanState;
  level: Storey;
  selection: Selection[];
  sheet?: Sheet;
  showSheet(id?: string): void;
  onCommand(command: PlanCommand): void;
}) {
  const [tab, setTab] = useState<"sheets" | "views" | "marks">("sheets");
  const [chosenSheet, setChosenSheet] = useState("");
  const [chosenView, setChosenView] = useState("");
  const [chosenViewport, setChosenViewport] = useState("");
  const [chosenMark, setChosenMark] = useState("");
  const [markKind, setMarkKind] = useState<MarkKind>("chain");
  const [error, setError] = useState("");
  const items = building.documentItems ?? [];
  const sheets = items.filter((item) => item.kind === "sheet");
  const views = items.filter((item) => item.kind === "view");
  const view = views.find(({ id }) => id === chosenView);
  const editingSheet = sheets.find(({ id }) => id === chosenSheet) ?? sheet;
  const viewports = items.filter(
    (item): item is ItemOf<"viewport"> =>
      item.kind === "viewport" && item.sheetId === editingSheet?.id,
  );
  const viewport = viewports.find(({ id }) => id === chosenViewport);
  const marks = items.filter(
    (item): item is DrawingMark =>
      "storeyId" in item && item.storeyId === level.id,
  );
  const mark = marks.find((item) => item.id === chosenMark);
  const kind = mark?.kind ?? markKind;
  const unresolved = marks.filter((item) =>
    markAnchors(item).some((anchor) => !anchorPoint(plan, level.id, anchor)),
  );
  const paper = editingSheet && paperSize(editingSheet);
  const sources = [
    { id: "plan:" + level.id, name: level.name },
    ...planStoreys(building)
      .filter(({ id }) => id !== level.id)
      .map(({ id, name }) => ({ id: "plan:" + id, name })),
    ...(building.buildingViews ?? []).map(({ id, name }) => ({
      id: "building:" + id,
      name,
    })),
  ];
  const selectedWalls = new Set(
    selection.filter(({ kind }) => kind === "wall").map(({ id }) => id),
  );
  const targetOptions = [
    ...plan.openings.map(({ id }, i) => ({
      anchor: { kind: "door", id } as const,
      label: "Door " + (i + 1),
    })),
    ...(plan.windows ?? []).map(({ id }, i) => ({
      anchor: { kind: "window", id } as const,
      label: "Window " + (i + 1),
    })),
    ...plan.fixtures.map(({ id, template }, i) => ({
      anchor: { kind: "fixture", id } as const,
      label: template + " " + (i + 1),
    })),
  ];
  const anchors = [
    ...plan.walls.flatMap(({ id }, i) =>
      (["start", "end"] as const).map((end) => ({
        anchor: { kind: "wall", id, end } as const,
        label: "Wall " + (i + 1) + " · " + end,
      })),
    ),
    ...targetOptions,
  ];
  const markAnchor = (data: FormData, name: string): DocumentAnchor => {
    const anchor = JSON.parse(text(data, name)) as DocumentAnchor | null;
    if (!anchor) return { kind: "point", point: position(data, "ax", "ay") };
    return anchor;
  };
  function dispatch(command: PlanCommand) {
    try {
      onCommand(command);
      setError("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The drawing edit could not be saved.",
      );
      return false;
    }
  }
  const write = (item: DocumentItem) =>
    dispatch({ type: "document.write", item });
  function remove(id: string) {
    if (dispatch({ type: "document.remove", id })) {
      if (id === sheet?.id) showSheet();
      if (id === chosenSheet) setChosenSheet("");
      if (id === chosenView) setChosenView("");
      if (id === chosenViewport) setChosenViewport("");
      if (id === chosenMark) setChosenMark("");
    }
  }
  const sheetId = editingSheet?.id ?? "";
  const sheetKey = editingSheet ? JSON.stringify(editingSheet) : "new-sheet";
  const existingChain = mark?.kind === "chain" ? mark : undefined;
  const existingNote =
    mark?.kind === "tag" || mark?.kind === "leader" ? mark : undefined;
  const defaultAnchors =
    existingChain?.anchors.map((anchor) => JSON.stringify(anchor)) ??
    anchors
      .filter(
        ({ anchor }) => anchor.kind === "wall" && selectedWalls.has(anchor.id),
      )
      .map(({ anchor }) => JSON.stringify(anchor));
  const selectedTag = selection.find(
    (object) =>
      object.kind === "door" ||
      object.kind === "window" ||
      object.kind === "fixture",
  );
  const sameSource =
    view?.source.kind === "plan"
      ? "plan:" + view.source.storeyId
      : view && "building:" + view.source.viewId;
  return (
    <div className="studio-fields studio-sheets-panel">
      <div
        className="studio-building-tabs"
        role="group"
        aria-label="Document editing"
      >
        {(["sheets", "views", "marks"] as const).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            onClick={() => {
              setTab(name);
              setError("");
            }}
          >
            {name === "marks"
              ? "Annotations"
              : name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      {error && (
        <p className="sheets-error" role="alert">
          {error}
        </p>
      )}
      {tab === "sheets" && (
        <>
          <label>
            Sheet
            <select
              value={sheetId}
              onChange={(event) => {
                setChosenSheet(event.target.value);
                showSheet(event.target.value || undefined);
              }}
            >
              <option value="">New sheet</option>
              {sheets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <Form
            key={sheetKey}
            label={editingSheet ? "Update sheet" : "Create sheet"}
            onSubmit={(data) => {
              const id = sheetId || key();
              if (
                write({
                  kind: "sheet",
                  id,
                  number: text(data, "number"),
                  name: text(data, "title"),
                  size: text(data, "size") as Sheet["size"],
                  orientation: text(
                    data,
                    "orientation",
                  ) as Sheet["orientation"],
                  project: editingSheet?.project,
                  drawnBy: editingSheet?.drawnBy,
                })
              ) {
                setChosenSheet(id);
                showSheet(id);
              }
            }}
          >
            <div className="studio-cad-parameters">
              <label>
                Sheet number
                <input
                  name="number"
                  required
                  maxLength={16}
                  defaultValue={
                    editingSheet?.number ?? "A" + String(101 + sheets.length)
                  }
                />
              </label>
              <label>
                Sheet title
                <input
                  name="title"
                  required
                  maxLength={120}
                  defaultValue={editingSheet?.name ?? "Floor plan"}
                />
              </label>
              <label>
                Paper size
                <select name="size" defaultValue={editingSheet?.size ?? "A3"}>
                  {["A4", "A3", "A2"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Orientation
                <select
                  name="orientation"
                  defaultValue={editingSheet?.orientation ?? "landscape"}
                >
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                </select>
              </label>
            </div>
          </Form>
          {editingSheet && paper && (
            <>
              <div className="sheets-actions">
                <button
                  type="button"
                  className="studio-cad-apply"
                  onClick={() => showSheet(editingSheet.id)}
                >
                  Show sheet
                </button>
                <button
                  type="button"
                  className="studio-cad-apply"
                  onClick={() => remove(editingSheet.id)}
                >
                  Remove sheet
                </button>
              </div>
              <h3>Viewports</h3>
              {views.length ? (
                <>
                  <label>
                    Viewport
                    <select
                      value={viewport?.id ?? ""}
                      onChange={(event) =>
                        setChosenViewport(event.target.value)
                      }
                    >
                      <option value="">New viewport</option>
                      {viewports.map((item) => (
                        <option key={item.id} value={item.id}>
                          {views.find(({ id }) => id === item.viewId)?.name} ·
                          1:{item.scale}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Form
                    key={sheetKey + JSON.stringify(viewport)}
                    label={viewport ? "Update viewport" : "Place viewport"}
                    onSubmit={(data) => {
                      const id = viewport?.id ?? key();
                      if (
                        write({
                          kind: "viewport",
                          id,
                          sheetId,
                          viewId: text(data, "view"),
                          scale: number(data, "scale"),
                          x: number(data, "x"),
                          y: number(data, "y"),
                          width: number(data, "width"),
                          height: number(data, "height"),
                        })
                      )
                        setChosenViewport(id);
                    }}
                  >
                    <label>
                      Named view
                      <select name="view" defaultValue={viewport?.viewId}>
                        {views.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="studio-cad-parameters">
                      <NumberField
                        label="Scale denominator"
                        name="scale"
                        value={viewport?.scale ?? 50}
                        min={1}
                      />
                      <NumberField
                        label="Left (mm)"
                        name="x"
                        value={viewport?.x ?? 10}
                        min={0}
                        step="0.1"
                      />
                      <NumberField
                        label="Top (mm)"
                        name="y"
                        value={viewport?.y ?? 10}
                        min={0}
                        step="0.1"
                      />
                      <NumberField
                        label="Width (mm)"
                        name="width"
                        value={viewport?.width ?? paper.width - 20}
                        min={10}
                        step="0.1"
                      />
                      <NumberField
                        label="Height (mm)"
                        name="height"
                        value={viewport?.height ?? paper.height - 45}
                        min={10}
                        step="0.1"
                      />
                    </div>
                  </Form>
                  {viewport && (
                    <button
                      className="studio-cad-apply"
                      type="button"
                      onClick={() => remove(viewport.id)}
                    >
                      Remove viewport
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="studio-cad-apply"
                  onClick={() => setTab("views")}
                >
                  Create a named view
                </button>
              )}
            </>
          )}
        </>
      )}
      {tab === "views" && (
        <>
          <label>
            View
            <select
              value={view?.id ?? ""}
              onChange={(event) => setChosenView(event.target.value)}
            >
              <option value="">New named view</option>
              {views.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Form
            key={JSON.stringify(view) ?? level.id}
            label={view ? "Update named view" : "Save named view"}
            onSubmit={(data) => {
              const value = text(data, "source");
              const source = value.startsWith("plan:")
                ? { kind: "plan" as const, storeyId: value.slice(5) }
                : { kind: "building" as const, viewId: value.slice(9) };
              const id = view?.id ?? key();
              const center =
                text(data, "cx") && text(data, "cy")
                  ? position(data, "cx", "cy")
                  : viewCenter(building, source);
              if (
                write({
                  kind: "view",
                  id,
                  name: text(data, "name"),
                  source,
                  center,
                })
              )
                setChosenView(id);
            }}
          >
            <label>
              View name
              <input
                required
                name="name"
                maxLength={120}
                defaultValue={view?.name ?? level.name}
              />
            </label>
            <label>
              Drawing source
              <select name="source" defaultValue={sameSource}>
                {sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="studio-cad-parameters">
              <label>
                Center X (mm)
                <input
                  name="cx"
                  type="number"
                  placeholder="Automatic"
                  defaultValue={view?.center.x}
                />
              </label>
              <label>
                Center Y (mm)
                <input
                  name="cy"
                  type="number"
                  placeholder="Automatic"
                  defaultValue={view?.center.y}
                />
              </label>
            </div>
          </Form>
          {view && (
            <button
              className="studio-cad-apply"
              type="button"
              onClick={() => remove(view.id)}
            >
              Remove named view
            </button>
          )}
        </>
      )}
      {tab === "marks" && (
        <>
          {unresolved.length > 0 && (
            <p role="status">
              {unresolved.length}{" "}
              {unresolved.length === 1
                ? "annotation needs"
                : "annotations need"}{" "}
              a replacement anchor.
            </p>
          )}
          <label>
            Annotation
            <select
              value={chosenMark}
              onChange={(event) => setChosenMark(event.target.value)}
            >
              <option value="">New annotation</option>
              {marks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.kind === "tag" || item.kind === "leader"
                    ? item.text
                    : markNames[item.kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={kind}
              disabled={Boolean(mark)}
              onChange={(event) => setMarkKind(event.target.value as MarkKind)}
            >
              {Object.entries(markNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <Form
            key={JSON.stringify(mark) ?? kind + defaultAnchors.join("")}
            label={mark ? "Update annotation" : "Add annotation"}
            onSubmit={(data) => {
              const id = mark?.id ?? key();
              const base = { id, storeyId: level.id };
              let next: DocumentItem;
              if (kind === "chain") {
                const selected = data
                  .getAll("anchor")
                  .map((value) => JSON.parse(String(value)) as DocumentAnchor);
                next = {
                  ...base,
                  kind,
                  anchors: selected,
                  axis: text(data, "axis") as ItemOf<"chain">["axis"],
                  offsetMm: number(data, "offset"),
                };
              } else if (kind === "tag" || kind === "leader") {
                const anchor = markAnchor(data, "anchor");
                const labelAt = position(data, "x", "y");
                const label = text(data, "label");
                if (kind === "tag") {
                  if (anchor.kind === "point" || anchor.kind === "wall") {
                    setError("Choose a door, window or fixture.");
                    return;
                  }
                  next = {
                    ...base,
                    kind,
                    target: anchor,
                    labelAt,
                    text: label,
                  };
                } else next = { ...base, kind, anchor, labelAt, text: label };
              } else {
                const polygon = text(data, "polygon")
                  .split(/\s*;\s*|\n+/)
                  .map((entry) => {
                    const [x, y] = entry
                      .trim()
                      .split(/[\s,]+/)
                      .map(Number);
                    return { x, y };
                  });
                next = {
                  ...base,
                  kind,
                  polygon,
                  pattern: text(data, "pattern") as ItemOf<"hatch">["pattern"],
                  spacingMm: number(data, "spacing"),
                };
              }
              if (write(next)) setChosenMark(id);
            }}
          >
            {kind === "chain" && (
              <>
                <label>
                  Chain anchors
                  <select
                    required
                    name="anchor"
                    multiple
                    size={Math.min(6, Math.max(2, anchors.length))}
                    defaultValue={defaultAnchors}
                  >
                    {anchors.map(({ anchor, label }) => (
                      <option
                        key={JSON.stringify(anchor)}
                        value={JSON.stringify(anchor)}
                      >
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Dimension axis
                  <select name="axis" defaultValue={existingChain?.axis}>
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                  </select>
                </label>
                <NumberField
                  label="Offset (mm)"
                  name="offset"
                  value={existingChain?.offsetMm ?? -450}
                />
              </>
            )}
            {(kind === "tag" || kind === "leader") && (
              <>
                <label>
                  Anchor
                  <select
                    required
                    name="anchor"
                    defaultValue={JSON.stringify(
                      mark?.kind === "tag"
                        ? mark.target
                        : mark?.kind === "leader"
                          ? mark.anchor.kind === "point"
                            ? null
                            : mark.anchor
                          : selectedTag
                            ? { kind: selectedTag.kind, id: selectedTag.id }
                            : null,
                    )}
                  >
                    {kind === "leader" && (
                      <option value="null">Fixed point</option>
                    )}
                    {(kind === "tag" ? targetOptions : anchors).map(
                      ({ anchor, label }) => (
                        <option
                          key={JSON.stringify(anchor)}
                          value={JSON.stringify(anchor)}
                        >
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Label
                  <input
                    name="label"
                    required
                    maxLength={kind === "tag" ? 24 : 120}
                    defaultValue={existingNote?.text}
                  />
                </label>
                <div className="studio-cad-parameters">
                  {kind === "leader" && (
                    <>
                      <NumberField
                        label="Fixed anchor X (mm)"
                        name="ax"
                        value={
                          mark?.kind === "leader" &&
                          mark.anchor.kind === "point"
                            ? mark.anchor.point.x
                            : 0
                        }
                      />
                      <NumberField
                        label="Fixed anchor Y (mm)"
                        name="ay"
                        value={
                          mark?.kind === "leader" &&
                          mark.anchor.kind === "point"
                            ? mark.anchor.point.y
                            : 0
                        }
                      />
                    </>
                  )}
                  <NumberField
                    label="Label X (mm)"
                    name="x"
                    value={existingNote?.labelAt.x ?? 500}
                  />
                  <NumberField
                    label="Label Y (mm)"
                    name="y"
                    value={existingNote?.labelAt.y ?? -350}
                  />
                </div>
              </>
            )}
            {kind === "hatch" && (
              <>
                <label>
                  Boundary coordinates (X, Y per line)
                  <textarea
                    name="polygon"
                    rows={4}
                    required
                    defaultValue={(mark?.kind === "hatch"
                      ? mark.polygon
                      : (plan.rooms[0]?.polygon ?? [])
                    )
                      .map(({ x, y }) => `${x}, ${y}`)
                      .join("\n")}
                  />
                </label>
                <label>
                  Hatch pattern
                  <select
                    name="pattern"
                    defaultValue={
                      mark?.kind === "hatch" ? mark.pattern : "diagonal"
                    }
                  >
                    <option value="diagonal">Diagonal</option>
                    <option value="cross">Crosshatch</option>
                  </select>
                </label>
                <NumberField
                  label="Spacing (mm)"
                  name="spacing"
                  value={mark?.kind === "hatch" ? mark.spacingMm : 200}
                  min={25}
                />
              </>
            )}
          </Form>
          {mark && (
            <button
              className="studio-cad-apply"
              type="button"
              onClick={() => remove(mark.id)}
            >
              Remove annotation
            </button>
          )}
        </>
      )}
    </div>
  );
}
