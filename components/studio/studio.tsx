"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Armchair,
  Zap,
  ScanLine,
  DoorOpen,
  Hand,
  LayoutGrid,
  MousePointer2,
  ListChecks,
  Trash2,
  PanelRight,
  Redo2,
  Ruler,
  Save,
  Undo2,
  X,
} from "lucide-react";
import { useStore } from "zustand";
import { gridSteps, unitFactor } from "@/lib/plans/cad";
import {
  utilityCatalog,
  type UtilityKind,
  type UtilityLayer,
} from "@/lib/plans/catalog";
import { checkClearances } from "@/lib/plans/clearance";
import { createDraftPlanStore } from "@/lib/plans/command-store";
import { authModalHref } from "@/lib/auth-navigation";
import type { DraftActor, PlanCommand, Point } from "@/lib/plans/model";
import {
  studioSnapshot,
  type StudioDocument,
} from "@/lib/plans/studio-document";
import {
  isSelected,
  moveSelection,
  removeSelection,
  selectionKey,
  type Selection,
} from "@/lib/plans/editor-selection";
import { Inspector, type DoorSettings, type WallSettings } from "./inspector";
import { Surface, type Tool } from "./surface";
import { AuditPanel } from "./audit-panel";
import {
  FixtureFields,
  UtilityFields,
  Layers,
  fixtureDefaults,
} from "./placement-fields";

const tools = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "wall", label: "Wall", icon: Ruler, shortcut: "W" },
  { id: "door", label: "Door", icon: DoorOpen, shortcut: "D" },
  { id: "fixture", label: "Fixture", icon: Armchair, shortcut: "F" },
  { id: "utility", label: "Utility", icon: Zap, shortcut: "U" },
  { id: "pan", label: "Pan", icon: Hand, shortcut: "H" },
] as const;

export function Studio({
  initial,
  actor,
}: {
  initial: StudioDocument;
  actor: DraftActor;
}) {
  const [store] = useState(() => createDraftPlanStore(initial.graph));
  const { plan, past, future, undo, redo, executeBatch } = useStore(store);
  const [unit, setUnit] = useState(initial.unit);
  const [gridIndex, setGridIndex] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [ortho, setOrtho] = useState(true);
  const [iso, setIso] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [wall, setWall] = useState<WallSettings>({
    thicknessMm: 120,
    kind: "interior",
  });
  const [door, setDoor] = useState<DoorSettings>({
    widthMm: 900,
    hinge: "start",
    swing: "left",
  });
  const [fixture, setFixture] = useState(() => fixtureDefaults("sofa"));
  const [utility, setUtility] = useState<UtilityKind>("outlet");
  const [layers, setLayers] = useState({ electrical: true, plumbing: true });
  const [auditOpen, setAuditOpen] = useState(false);
  const [finding, setFinding] = useState<string>();
  const audit = useMemo(
    () => (auditOpen ? checkClearances(plan) : undefined),
    [plan, auditOpen],
  );
  const issue = audit?.issues.find(({ id }) => id === finding);
  const [picked, setSelection] = useState<readonly Selection[]>([]);
  const [multi, setMulti] = useState(false);
  const selection = useMemo(() => {
    const visible = new Set([
      ...plan.walls.map(({ id }) => "wall:" + id),
      ...plan.openings.map(({ id }) => "door:" + id),
      ...plan.fixtures.map(({ id }) => "fixture:" + id),
      ...plan.utilities
        .filter((item) => layers[utilityCatalog[item.template].layer])
        .map(({ id }) => "utility:" + id),
    ]);
    return picked.filter((item) => visible.has(selectionKey(item)));
  }, [picked, plan, layers]);
  const active = selection.length === 1 ? selection[0] : undefined;
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "error" | "conflict" | "auth"
  >("idle");
  const auditControl = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const revision = useRef(initial.revision);
  const snapshot = useMemo(() => studioSnapshot(plan, unit), [plan, unit]);
  const encoded = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const [saved, setSaved] = useState(encoded);
  const dirty = saved !== encoded;

  const activeWall =
    active?.kind === "wall"
      ? plan.walls.find((w) => w.id === active.id)
      : undefined;
  const activeDoor =
    active?.kind === "door"
      ? plan.openings.find((d) => d.id === active.id)
      : undefined;

  const activeFixture =
    active?.kind === "fixture"
      ? plan.fixtures.find(({ id }) => id === active.id)
      : undefined;
  const activeUtility =
    active?.kind === "utility"
      ? plan.utilities.find(({ id }) => id === active.id)
      : undefined;
  const save = useCallback(async () => {
    if (!dirty || saving.current || saveState === "conflict") return;
    saving.current = true;
    setSaveState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/floorplans/${initial.id}/graph`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.current, ...snapshot }),
      });
      if (response.status === 409) {
        // A retry after a dropped response can arrive after the write committed.
        const latest = await fetch(`/api/floorplans/${initial.id}/graph`, {
          cache: "no-store",
        });
        if (latest.ok) {
          const newer: StudioDocument = await latest.json();
          if (
            JSON.stringify(studioSnapshot(newer.graph, newer.unit)) === encoded
          ) {
            revision.current = newer.revision;
            setSaved(encoded);
            setSaveState("idle");
            return;
          }
        }
        setSaveState("conflict");
        return;
      }
      if (response.status === 401) {
        setSaveState("auth");
        return;
      }
      if (!response.ok) {
        setSaveState("error");
        const payload = await response.json().catch(() => null);
        setMessage(
          payload?.error ?? "The drawing could not be saved. Try again.",
        );
        return;
      }
      const updated: { revision: number } = await response.json();
      revision.current = updated.revision;
      setSaved(encoded);
      setSaveState("idle");
      setMessage("");
    } catch {
      setSaveState("error");
      setMessage("Connection interrupted. Try saving again.");
    } finally {
      saving.current = false;
    }
  }, [dirty, encoded, initial.id, saveState, snapshot]);

  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const switchTool = useCallback((next: Tool) => {
    setTool(next);
    if (next !== "select") setMulti(false);
    setAuditOpen(false);
    setFinding(undefined);
    setSelection([]);
    setMessage("");
    if (next !== "pan") setIso(false);
  }, []);

  const edit = useCallback(
    (commands: readonly PlanCommand[]) => {
      try {
        const changed = executeBatch(commands, actor);
        setMessage("");
        return changed;
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "This edit could not be applied.",
        );
        return false;
      }
    },
    [executeBatch, actor],
  );
  function command(input: PlanCommand) {
    return edit([input]);
  }
  const remove = useCallback(() => {
    if (edit(removeSelection(plan, selection))) setSelection([]);
  }, [edit, plan, selection]);

  function choose(items: readonly Selection[], append = false) {
    setSelection(
      append
        ? [
            ...selection,
            ...items.filter((item) => !isSelected(selection, item)),
          ]
        : items,
    );
  }

  useEffect(() => {
    function keydown(event: globalThis.KeyboardEvent) {
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && key === "s") {
        event.preventDefault();
        void save();
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("input, select, textarea, [contenteditable]")
      )
        return;
      if (modifier && (key === "z" || key === "y")) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier || event.altKey) return;
      if (
        (key === "backspace" || key === "delete") &&
        selection.length &&
        !iso
      ) {
        event.preventDefault();
        remove();
        return;
      }
      const match = tools.find((item) => item.shortcut.toLowerCase() === key);
      if (match) switchTool(match.id);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [save, redo, undo, switchTool, selection.length, iso, remove]);

  function drawWall(start: Point, end: Point) {
    return command({
      type: "wall.add",
      wall: { id: crypto.randomUUID(), ...wall, start, end },
    });
  }

  function ensureLayer(template: UtilityKind) {
    const layer = utilityCatalog[template].layer;
    setLayers((visible) =>
      visible[layer] ? visible : { ...visible, [layer]: true },
    );
  }

  function place(kind: "fixture" | "utility", position: Point) {
    const id = crypto.randomUUID();
    if (kind === "utility") ensureLayer(utility);
    const added =
      kind === "fixture"
        ? command({
            type: "fixture.add",
            fixture: { ...fixture, position, id },
          })
        : command({
            type: "utility.add",
            utility: { template: utility, position, id },
          });
    if (added) {
      setSelection([{ kind, id }]);
      setTool("select");
    }
  }
  function toggleLayer(layer: UtilityLayer) {
    setLayers((visible) => ({ ...visible, [layer]: !visible[layer] }));
    if (layers[layer]) {
      const hidden = new Set(
        plan.utilities
          .filter((item) => utilityCatalog[item.template].layer === layer)
          .map(({ id }) => id),
      );
      setSelection((items) =>
        items.filter((item) => item.kind !== "utility" || !hidden.has(item.id)),
      );
    }
  }

  const status =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed"
        : saveState === "conflict"
          ? "Revision conflict"
          : saveState === "auth"
            ? "Sign-in required"
            : dirty
              ? "Unsaved changes"
              : "Saved";

  return (
    <div className="studio-page">
      <header className="studio-header">
        <a
          className="studio-library"
          href="/dashboard"
          aria-label="Back to floorplans"
        >
          <LayoutGrid size={18} />
          <span>Floorplans</span>
        </a>
        <h1 title={initial.name}>{initial.name}</h1>
        <span role="status" className="studio-save-status" data-dirty={dirty}>
          <i />
          {status}
        </span>
        <button
          className="studio-save"
          onClick={() => void save()}
          disabled={
            !dirty || saveState === "saving" || saveState === "conflict"
          }
        >
          <Save size={16} /> Save
        </button>
      </header>

      <div className="studio-controls">
        <div className="studio-segment" role="group" aria-label="View">
          <button aria-pressed={!iso} onClick={() => setIso(false)}>
            2D plan
          </button>
          <button
            aria-pressed={iso}
            onClick={() => {
              setIso(true);
              setSelection([]);
            }}
          >
            <Box size={15} /> Isometric
          </button>
        </div>
        <button
          className="studio-ortho"
          aria-pressed={ortho}
          onClick={() => setOrtho(!ortho)}
          disabled={iso}
        >
          Ortho
        </button>
        <div
          className="studio-history"
          role="group"
          aria-label="Drawing history"
        >
          <button
            title="Undo"
            aria-label="Undo"
            onClick={() => undo()}
            disabled={!past.length}
          >
            <Undo2 size={18} />
          </button>
          <button
            title="Redo"
            aria-label="Redo"
            onClick={() => redo()}
            disabled={!future.length}
          >
            <Redo2 size={18} />
          </button>
        </div>
        <button
          className="studio-audit-toggle"
          ref={auditControl}
          aria-label="Check clearances"
          title="Check clearances"
          aria-pressed={auditOpen}
          onClick={() => {
            const open = !auditOpen || !inspectorOpen;
            setAuditOpen(open);
            setInspectorOpen(open);
            setFinding(undefined);
            if (open) setIso(false);
          }}
        >
          <ScanLine size={17} />
          <span>Clearance</span>
        </button>
        <button
          className="studio-inspector-toggle"
          aria-pressed={inspectorOpen}
          aria-controls="studio-inspector"
          aria-label="Inspector"
          title="Inspector"
          onClick={() => {
            setInspectorOpen(!inspectorOpen || auditOpen);
            setAuditOpen(false);
            setFinding(undefined);
          }}
        >
          <PanelRight size={19} />
        </button>
      </div>

      <main className="studio-workbench">
        <div className="studio-tools" role="group" aria-label="Drawing tools">
          {tools.map(({ id, label, icon: Icon, shortcut }) => (
            <button
              key={id}
              aria-pressed={tool === id && (!iso || id === "pan")}
              onClick={() => switchTool(id)}
              aria-keyshortcuts={shortcut}
              title={`${label} (${shortcut})`}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
          <div className="studio-selection-actions">
            <button
              aria-label="Multi-select"
              title="Multi-select (or Shift-click)"
              aria-pressed={tool === "select" && multi && !iso}
              onClick={() => {
                if (iso || tool !== "select") switchTool("select");
                setMulti(tool !== "select" || iso || !multi);
              }}
            >
              <ListChecks size={17} />
              <span>Multi-select</span>
            </button>
            <button
              aria-label="Delete selection"
              title="Delete selection (Backspace or Delete)"
              disabled={!selection.length || iso}
              onClick={remove}
            >
              <Trash2 size={16} />
              <span>Delete</span>
            </button>
          </div>
          <span className="studio-selection-count" aria-live="polite">
            {selection.length ? selection.length + " selected" : ""}
          </span>
        </div>

        <Surface
          plan={plan}
          tool={tool}
          iso={iso}
          ortho={ortho}
          grid={gridSteps[unit][gridIndex] * unitFactor(unit)}
          unit={unit}
          thicknessMm={wall.thicknessMm}
          selection={selection}
          multi={multi}
          layers={layers}
          issue={issue}
          onPlace={place}
          onSelect={choose}
          onToggle={(item) =>
            setSelection(
              isSelected(selection, item)
                ? selection.filter(
                    (entry) => selectionKey(entry) !== selectionKey(item),
                  )
                : [...selection, item],
            )
          }
          onMove={(items, delta) => edit(moveSelection(plan, items, delta))}
          onWall={drawWall}
          onDoor={(wallId, offsetMm) =>
            command({
              type: "door.add",
              door: { id: crypto.randomUUID(), wallId, offsetMm, ...door },
            })
          }
        />

        <aside
          id="studio-inspector"
          className="studio-inspector"
          data-open={inspectorOpen}
          aria-label="Inspector"
        >
          <button
            className="studio-inspector-close"
            aria-label="Close inspector"
            onClick={() => {
              setInspectorOpen(false);
              setAuditOpen(false);
              setFinding(undefined);
            }}
          >
            <X size={18} />
          </button>
          {audit ? (
            <AuditPanel
              {...audit}
              selected={finding}
              unit={unit}
              onIssue={(id) => {
                setIso(false);
                setFinding(id);
                if (window.matchMedia("(max-width: 900px)").matches) {
                  setInspectorOpen(false);
                  auditControl.current?.focus();
                }
              }}
            />
          ) : (
            <Inspector
              plan={plan}
              tool={tool}
              selectedCount={selection.length}
              unit={unit}
              gridIndex={gridIndex}
              wall={wall}
              door={door}
              activeWall={activeWall}
              activeDoor={activeDoor}
              onUnit={setUnit}
              onGrid={setGridIndex}
              onWall={(changes) =>
                activeWall
                  ? command({ type: "wall.update", id: activeWall.id, changes })
                  : setWall(changes)
              }
              onDoor={(changes) =>
                activeDoor
                  ? command({ type: "door.update", id: activeDoor.id, changes })
                  : setDoor(changes)
              }
              layers={<Layers layers={layers} onToggle={toggleLayer} />}
              placementSelected={
                activeFixture
                  ? "fixture"
                  : activeUtility
                    ? "utility"
                    : undefined
              }
              placementFields={
                activeFixture || tool === "fixture" ? (
                  <FixtureFields
                    key={activeFixture?.id ?? "fixture-defaults"}
                    unit={unit}
                    value={activeFixture ?? fixture}
                    active={activeFixture}
                    onSet={(changes) => {
                      if (activeFixture)
                        command({
                          type: "fixture.update",
                          id: activeFixture.id,
                          changes,
                        });
                      else setFixture((value) => ({ ...value, ...changes }));
                    }}
                  />
                ) : activeUtility || tool === "utility" ? (
                  <UtilityFields
                    key={activeUtility?.id ?? "utility-defaults"}
                    unit={unit}
                    value={activeUtility?.template ?? utility}
                    active={activeUtility}
                    onSet={(changes) => {
                      if (changes.template) ensureLayer(changes.template);
                      if (activeUtility)
                        command({
                          type: "utility.update",
                          id: activeUtility.id,
                          changes,
                        });
                      else if (changes.template) setUtility(changes.template);
                    }}
                  />
                ) : undefined
              }
              onRemove={remove}
            />
          )}
        </aside>
        {(message || saveState === "conflict" || saveState === "auth") && (
          <div role="alert" className="studio-message">
            {saveState === "conflict" ? (
              <>
                A newer revision is saved. Keep this tab open to retain your
                edits.{" "}
                <a
                  href={`/studio/${initial.id}`}
                  target="_blank"
                  rel="noopener"
                >
                  Open saved version
                </a>
              </>
            ) : saveState === "auth" ? (
              <>
                Your session expired.{" "}
                <a
                  href={authModalHref("sign-in", `/studio/${initial.id}`)}
                  target="_blank"
                  rel="noopener"
                >
                  Sign in again
                </a>{" "}
                and retry saving.
              </>
            ) : (
              message
            )}
            {message && saveState !== "conflict" && saveState !== "auth" && (
              <button
                onClick={() => setMessage("")}
                aria-label="Dismiss message"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
