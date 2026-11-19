"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";

const panelSizes = {
  left: { start: 216, min: 184, max: 298 },
  right: { start: 282, min: 234, max: 360 },
};

export function StudioPanel({
  side,
  id,
  label,
  title = label,
  open,
  onClose,
  children,
}: {
  side: keyof typeof panelSizes;
  id: string;
  label: string;
  title?: string;
  open: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  const { start, min, max } = panelSizes[side];
  const [width, setWidth] = useState(start);
  const drag = useRef<{ pointer: number; x: number; width: number }>(null);
  const direction = side === "left" ? 1 : -1;
  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  return (
    <aside
      id={id}
      className={`studio-panel studio-panel-${side}`}
      aria-label={label}
      hidden={!open}
      style={{ "--studio-panel-width": `${width}px` } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="studio-panel-heading">
        <h2>{title}</h2>
        <button
          type="button"
          aria-label={`Close ${label.toLowerCase()}`}
          title={`Close ${label.toLowerCase()}`}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="studio-panel-body">{children}</div>
      <div
        className="studio-panel-resize"
        role="separator"
        tabIndex={0}
        aria-label={`Resize ${label.toLowerCase()}`}
        aria-orientation="vertical"
        aria-controls={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels`}
        onDoubleClick={() => setWidth(start)}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, x: event.clientX, width };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (active?.pointer === event.pointerId) {
            const delta = direction * (event.clientX - active.x);
            setWidth(clamp(Math.round(active.width + delta)));
          }
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 8;
          switch (event.key) {
            case "ArrowLeft":
              setWidth((value) => clamp(value - direction * step));
              break;
            case "ArrowRight":
              setWidth((value) => clamp(value + direction * step));
              break;
            case "Home":
              setWidth(min);
              break;
            case "End":
              setWidth(max);
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
      />
    </aside>
  );
}
