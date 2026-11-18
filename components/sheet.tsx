"use client";
import { useState } from "react";
import {
  Box,
  Layers2,
  Maximize,
  Minus,
  Plus,
  Scan,
  ScanLine,
} from "lucide-react";
import { FloorPlan } from "./floor-plan";
export type View = "iso" | "plan";
export function Sheet({
  expanded = false,
  onExpand,
}: {
  expanded?: boolean;
  onExpand?: () => void;
}) {
  const [view, setView] = useState<View>("iso");
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(true);
  return (
    <section
      className={"sheet" + (expanded ? " expanded-sheet" : "")}
      aria-label="Courtyard House drawing preview"
    >
      <div className="sheet-bar">
        <span className="sheet-label">
          <span className="signal" /> Sample workspace
        </span>
        <div className="switch" aria-label="Drawing view">
          <button
            aria-pressed={view === "plan"}
            onClick={() => setView("plan")}
          >
            <Layers2 size={13} />
            2D Plan
          </button>
          <button aria-pressed={view === "iso"} onClick={() => setView("iso")}>
            <Box size={13} />
            Isometric
          </button>
        </div>
      </div>
      <div className={"sheet-field" + (grid ? " grid-on" : "")}>
        <span className="drawing-label mono">
          FIG. 01 / {view === "iso" ? "AXONOMETRIC" : "FLOOR PLAN"}
        </span>
        {onExpand && (
          <button
            className="expand"
            aria-label="Expand sample drawing"
            onClick={onExpand}
          >
            <Maximize size={15} />
          </button>
        )}
        <i className="cross cross-a" />
        <i className="cross cross-b" />
        <div className="art-wrap" style={{ transform: "scale(" + zoom + ")" }}>
          {view === "iso" ? (
            <img
              className="model"
              src="/isometric.webp"
              width="1448"
              height="1086"
              alt="Cutaway architectural model of a furnished two-bedroom home surrounding a planted courtyard"
              fetchPriority="high"
            />
          ) : (
            <FloorPlan />
          )}
        </div>
        <svg
          className="axes"
          width="39"
          height="37"
          viewBox="0 0 39 37"
          aria-label="Drawing axes"
        >
          <g fill="none" strokeWidth="1.2">
            <path d="M15 24V4" stroke="#747b6d" />
            <path d="m15 24 18 8" stroke="#d36940" />
            <path d="M15 24 3 30" stroke="#747b6d" />
          </g>
          <g fontSize="7" fontFamily="monospace" fill="#676b61">
            <text x="12" y="6">
              Z
            </text>
            <text x="33" y="34">
              X
            </text>
            <text x="1" y="35">
              Y
            </text>
          </g>
        </svg>
        {expanded && (
          <div className="zoom">
            <button
              aria-label="Zoom out"
              disabled={zoom <= 0.75}
              onClick={() => setZoom((v) => v - 0.25)}
            >
              <Minus size={15} />
            </button>
            <span>{zoom * 100}%</span>
            <button
              aria-label="Zoom in"
              disabled={zoom >= 2}
              onClick={() => setZoom((v) => v + 0.25)}
            >
              <Plus size={15} />
            </button>
            <button
              aria-label="Toggle grid"
              aria-pressed={grid}
              onClick={() => setGrid(!grid)}
            >
              <ScanLine size={16} />
            </button>
          </div>
        )}
        {!expanded && <span className="sheet-scale mono">MODEL VIEW</span>}
      </div>
      <div className="sheet-foot">
        <div>
          <span className="project-square">
            <Scan size={18} />
          </span>
          <strong>Courtyard House</strong>
        </div>
        <span className="mono">RESIDENTIAL STUDY</span>
      </div>
    </section>
  );
}
