"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Armchair,
  ChevronLeft,
  FileDown,
  Layers3,
  Zap,
  ScanLine,
  DoorOpen,
  Hand,
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
import type { StudioDocument } from "@/lib/plans/studio-document";
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
import { StudioPanel } from "./studio-panel";
import { ExportPanel } from "./export-panel";
import { usePlanLive } from "./use-plan-live";
import { useStudioSync } from "./use-studio-sync";
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
const overlayPanels = "(max-width: 1000px)";
type RightPanel = "inspector" | "clearance" | "exports";

export function Studio({
  initial,
  actor,
}: {
  initial: StudioDocument;
  actor: DraftActor;
}) {
  const [store] = useState(() => createDraftPlanStore(initial.graph));
  const { plan, past, future, undo, redo, executeBatch } = useStore(store);
  const {
    unit,
    setUnit,
    dirty,
    checkpoint,
    activity,
    block,
    failure,
    save,
    halt,
    observeRevision,
    dismissFailure,
    retryAuth,
  } = useStudioSync(initial, store, actor);
  const live = usePlanLive(
    initial.id,
    block === "auth" || block === "deleted",
    observeRevision,
    halt,
  );
  const [gridIndex, setGridIndex] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [ortho, setOrtho] = useState(true);
  const [iso, setIso] = useState(false);
  const [rightPanel, setRightPanel] = useState<RightPanel | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [zoomSlot, setZoomSlot] = useState<HTMLDivElement | null>(null);
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
  const [finding, setFinding] = useState<string>();
  const showClearance = rightPanel === "clearance" || finding !== undefined;
  const audit = useMemo(
    () => (showClearance ? checkClearances(plan) : undefined),
    [plan, showClearance],
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
  const auditControl = useRef<HTMLButtonElement>(null);
  const inspectorControl = useRef<HTMLButtonElement>(null);
  const exportsControl = useRef<HTMLButtonElement>(null);
  const layerControl = useRef<HTMLButtonElement>(null);

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
    setRightPanel((panel) => (panel === "clearance" ? "inspector" : panel));
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

  useEffect(() => {
    const layout = window.matchMedia(overlayPanels);
    function resize({ matches }: MediaQueryListEvent) {
      if (matches && rightPanel) setLayersOpen(false);
    }
    layout.addEventListener("change", resize);
    return () => layout.removeEventListener("change", resize);
  }, [rightPanel]);

  function closeRightPanel() {
    setRightPanel(null);
    setFinding(undefined);
  }

  function toggleRightPanel(panel: RightPanel) {
    if (rightPanel === panel) {
      closeRightPanel();
      return;
    }
    if (window.matchMedia(overlayPanels).matches) setLayersOpen(false);
    setFinding(undefined);
    setRightPanel(panel);
    if (panel === "clearance") setIso(false);
  }

  const status =
    block === "conflict"
      ? "Revision conflict"
      : block === "auth"
        ? "Sign-in required"
        : block === "deleted"
          ? "Plan unavailable"
          : activity === "save"
            ? "Saving…"
            : activity === "pull"
              ? "Updating…"
              : failure
                ? "Sync interrupted"
                : dirty
                  ? "Unsaved changes"
                  : "Saved";
  const connectionLabel =
    live.connection === "live"
      ? `Live · ${live.peers.length} other ${live.peers.length === 1 ? "editor" : "editors"}`
      : live.connection === "offline"
        ? "Live sync offline"
        : "Connecting to live sync";

  return (
    <div className="studio-page">
      <header className="studio-header">
        <a
          className="studio-library"
          href="/dashboard"
          title="Back to floorplans"
          aria-label="Back to floorplans"
        >
          <ChevronLeft size={21} />
        </a>
        <h1 title={checkpoint.name}>{checkpoint.name}</h1>
        <span role="status" className="studio-save-status" data-dirty={dirty}>
          <i aria-hidden="true" />
          <span>{status}</span>
        </span>
        <div className="studio-header-actions">
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
          <div className="studio-zoom-slot" ref={setZoomSlot} />
          <button
            className="studio-save"
            title="Save"
            aria-label="Save"
            onClick={() => void save()}
            disabled={!dirty || activity !== null || block !== null}
          >
            <Save size={16} /> <span>Save</span>
          </button>
        </div>
      </header>

      <main className="studio-workbench">
        <div
          className="studio-rail studio-rail-left"
          role="group"
          aria-label="Left sidebar"
        >
          <button
            ref={layerControl}
            aria-controls="studio-layers"
            aria-expanded={layersOpen}
            aria-label="Layers"
            title="Layers"
            onClick={() => {
              if (!layersOpen && window.matchMedia(overlayPanels).matches)
                closeRightPanel();
              setLayersOpen(!layersOpen);
            }}
          >
            <Layers3 size={20} />
          </button>
        </div>
        <StudioPanel
          side="left"
          id="studio-layers"
          label="Layers"
          open={layersOpen}
          onClose={() => {
            setLayersOpen(false);
            layerControl.current?.focus();
          }}
        >
          <Layers layers={layers} onToggle={toggleLayer} />
        </StudioPanel>

        <div className="studio-stage">
          <div
            className="studio-floating studio-views"
            role="group"
            aria-label="View"
          >
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
            <button
              className="studio-ortho"
              aria-pressed={ortho}
              onClick={() => setOrtho(!ortho)}
              disabled={iso}
            >
              Ortho
            </button>
          </div>

          <div
            className="studio-floating studio-tools"
            role="group"
            aria-label="Drawing tools"
          >
            {tools.map(({ id, label, icon: Icon, shortcut }) => (
              <button
                key={id}
                aria-label={label}
                aria-pressed={tool === id && (!iso || id === "pan")}
                onClick={() => switchTool(id)}
                aria-keyshortcuts={shortcut}
                title={`${label} (${shortcut})`}
              >
                <Icon size={19} />
              </button>
            ))}
          </div>

          <div
            className="studio-floating studio-selection-actions"
            role="group"
            aria-label="Selection tools"
          >
            <button
              aria-label="Multi-select"
              title="Multi-select (or Shift-click)"
              aria-pressed={tool === "select" && multi && !iso}
              onClick={() => {
                if (iso || tool !== "select") switchTool("select");
                setMulti(tool !== "select" || iso || !multi);
              }}
            >
              <ListChecks size={18} />
            </button>
            <button
              aria-label="Delete selection"
              title="Delete selection (Backspace or Delete)"
              disabled={!selection.length || iso}
              onClick={remove}
            >
              <Trash2 size={17} />
            </button>
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
            zoomSlot={zoomSlot}
            peers={live.peers}
            onPresence={live.moveCursor}
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
        </div>

        <div
          className="studio-rail studio-rail-right"
          role="group"
          aria-label="Right sidebar"
        >
          <button
            ref={inspectorControl}
            aria-expanded={rightPanel === "inspector"}
            aria-controls="studio-inspector"
            aria-label="Inspector"
            title="Inspector"
            onClick={() => toggleRightPanel("inspector")}
          >
            <PanelRight size={20} />
          </button>
          <button
            ref={auditControl}
            aria-expanded={rightPanel === "clearance"}
            aria-controls="studio-inspector"
            aria-label="Check clearances"
            title="Check clearances"
            onClick={() => toggleRightPanel("clearance")}
          >
            <ScanLine size={20} />
          </button>
          <button
            ref={exportsControl}
            aria-expanded={rightPanel === "exports"}
            aria-controls="studio-inspector"
            aria-label="Exports"
            title="Exports"
            onClick={() => toggleRightPanel("exports")}
          >
            <FileDown size={20} />
          </button>
          <span
            className="studio-live-status"
            data-connection={live.connection}
            role="img"
            aria-label={connectionLabel}
            title={connectionLabel}
          >
            <i aria-hidden="true" />
            <span aria-hidden="true">
              {live.connection === "live" ? live.peers.length : "…"}
            </span>
          </span>
        </div>
        <StudioPanel
          side="right"
          id="studio-inspector"
          label={rightPanel === "exports" ? "Exports" : "Inspector"}
          title={rightPanel === "clearance" ? "Clearance check" : undefined}
          open={rightPanel !== null}
          onClose={() => {
            closeRightPanel();
            const trigger =
              rightPanel === "exports"
                ? exportsControl
                : rightPanel === "clearance"
                  ? auditControl
                  : inspectorControl;
            trigger.current?.focus();
          }}
        >
          {rightPanel === "exports" ? (
            <ExportPanel
              key={`${initial.id}:${checkpoint.revision}`}
              id={initial.id}
              name={checkpoint.name}
              revision={checkpoint.revision}
              dirty={dirty}
            />
          ) : rightPanel === "clearance" && audit ? (
            <AuditPanel
              {...audit}
              selected={finding}
              unit={unit}
              onIssue={(id) => {
                setIso(false);
                setFinding(id);
                if (window.matchMedia(overlayPanels).matches) {
                  setRightPanel(null);
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
        </StudioPanel>
        {(message || failure || block) && (
          <div role="alert" className="studio-message">
            {block === "conflict" ? (
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
            ) : block === "auth" ? (
              <>
                Your session expired.{" "}
                <a
                  href={authModalHref("sign-in", `/studio/${initial.id}`)}
                  target="_blank"
                  rel="noopener"
                >
                  Sign in again
                </a>{" "}
                and{" "}
                <button type="button" onClick={retryAuth}>
                  Reconnect
                </button>
                .
              </>
            ) : block === "deleted" ? (
              "This floorplan is no longer available. Keep this tab open to retain your edits."
            ) : (
              message || failure
            )}
            {(message || failure) && !block && (
              <button
                onClick={() => {
                  setMessage("");
                  dismissFailure();
                }}
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
