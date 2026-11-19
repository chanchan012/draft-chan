"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  DoorOpen,
  Hand,
  LayoutGrid,
  MousePointer2,
  PanelRight,
  Redo2,
  Ruler,
  Save,
  Undo2,
  X,
} from "lucide-react";
import { useStore } from "zustand";
import { gridSteps, unitFactor } from "@/lib/plans/cad";
import { createDraftPlanStore } from "@/lib/plans/command-store";
import { authModalHref } from "@/lib/auth-navigation";
import type { DraftActor, PlanCommand, Point } from "@/lib/plans/model";
import {
  studioSnapshot,
  type StudioDocument,
} from "@/lib/plans/studio-document";
import type { Selection } from "./drawing";
import { Inspector, type DoorSettings, type WallSettings } from "./inspector";
import { Surface, type Tool } from "./surface";

const tools = [
  { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: "wall", label: "Wall", icon: Ruler, shortcut: "W" },
  { id: "door", label: "Door", icon: DoorOpen, shortcut: "D" },
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
  const { plan, past, future, undo, redo, execute } = useStore(store);
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "error" | "conflict" | "auth"
  >("idle");
  const saving = useRef(false);
  const revision = useRef(initial.revision);
  const snapshot = useMemo(() => studioSnapshot(plan, unit), [plan, unit]);
  const encoded = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const [saved, setSaved] = useState(encoded);
  const dirty = saved !== encoded;

  const activeWall =
    selection?.kind === "wall"
      ? plan.walls.find((w) => w.id === selection.id)
      : undefined;
  const activeDoor =
    selection?.kind === "door"
      ? plan.openings.find((d) => d.id === selection.id)
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
    setSelection(null);
    setMessage("");
    if (next !== "pan") setIso(false);
  }, []);

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
        event.target instanceof HTMLElement &&
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
      const match = tools.find((item) => item.shortcut.toLowerCase() === key);
      if (match) switchTool(match.id);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [save, redo, undo, switchTool]);

  function command(input: PlanCommand) {
    try {
      const changed = execute(input, actor);
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
  }
  function drawWall(start: Point, end: Point) {
    return command({
      type: "wall.add",
      wall: { id: crypto.randomUUID(), ...wall, start, end },
    });
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
              setSelection(null);
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
          className="studio-inspector-toggle"
          aria-pressed={inspectorOpen}
          aria-controls="studio-inspector"
          aria-label="Inspector"
          title="Inspector"
          onClick={() => setInspectorOpen(!inspectorOpen)}
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
          onSelect={setSelection}
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
            onClick={() => setInspectorOpen(false)}
          >
            <X size={18} />
          </button>
          <Inspector
            plan={plan}
            tool={tool}
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
            onRemove={() => {
              if (activeWall)
                command({ type: "wall.remove", id: activeWall.id });
              if (activeDoor)
                command({ type: "door.remove", id: activeDoor.id });
              setSelection(null);
            }}
          />
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
