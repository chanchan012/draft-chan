"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowLeft,
  ArrowUpRight,
  FolderOpen,
  Plus,
  Ruler,
  Search,
  X,
} from "lucide-react";
import { Brand } from "./brand";
import type { PlanCard } from "@/lib/plans/geometry";

const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
function area(value: number) {
  return (
    format.format(value) + " m² · " + format.format(value / 0.09290304) + " ft²"
  );
}
type Editor =
  | { mode: "create"; id: string }
  | { mode: "view" | "rename" | "delete"; plan: PlanCard };
export function Dashboard({ accountsEnabled }: { accountsEnabled: boolean }) {
  const [plans, setPlans] = useState<PlanCard[]>([]);
  const [access, setAccess] = useState<"loading" | "guest" | "member">(
    "loading",
  );
  const [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null),
    [name, setName] = useState(""),
    [shape, setShape] = useState("blank");
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0),
    lock = useRef(false);
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const response = await fetch("/api/floorplans", { cache: "no-store" });
      if (version !== generation.current) return;
      if (response.status === 401) {
        setPlans([]);
        setAccess("guest");
        setEditor(null);
        setError("");
        return;
      }
      if (!response.ok) throw Error();
      const rows = (await response.json()) as PlanCard[];
      if (version === generation.current) {
        setPlans(rows);
        setAccess("member");
        setError("");
      }
    } catch {
      if (version === generation.current)
        setError("Your floorplans could not be loaded.");
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!plans.some((p) => !p.thumbnail)) return;
    const timer = setInterval(() => {
      if (!document.hidden && !lock.current) void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [plans, load]);
  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
    else if (!editor && dialog.current?.open) dialog.current.close();
  }, [editor]);
  function open(next: Editor) {
    setFormError("");
    setName(next.mode === "create" ? "" : next.plan.name);
    setShape("blank");
    setEditor(next);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editor || editor.mode === "view" || lock.current) return;
    const fields = new FormData(e.currentTarget);
    const creation = editor.mode === "create";
    const url = creation
      ? "/api/floorplans"
      : "/api/floorplans/" + editor.plan.id;
    const payload = creation
      ? {
          id: editor.id,
          name,
          ...(shape === "room"
            ? {
                room: {
                  width: Math.round(Number(fields.get("width")) * 1000),
                  depth: Math.round(Number(fields.get("depth")) * 1000),
                },
              }
            : {}),
        }
      : editor.mode === "rename"
        ? { revision: editor.plan.revision, name }
        : { revision: editor.plan.revision };
    lock.current = true;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch(url, {
        method: creation
          ? "POST"
          : editor.mode === "rename"
            ? "PATCH"
            : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (response.status === 401) {
          await load();
          return;
        }
        if (response.status === 409) {
          setEditor(null);
          await load();
          setError("This plan changed. Open its latest version to try again.");
          return;
        }
        const message = await response.json().catch(() => null);
        throw Error(message?.error || "Could not save the change.");
      }
      setEditor(null);
      await load();
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Connection failed. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const results = plans.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selected = editor && editor.mode !== "create" ? editor.plan : null;
  const active =
    editor?.mode === "view"
      ? (plans.find((plan) => plan.id === editor.plan.id) ?? selected)
      : selected;
  return (
    <div className="dash-page">
      <header className="header">
        <div className="header-inner">
          <Brand />
          <Link className="back" href="/">
            <ArrowLeft size={15} />
            Overview
          </Link>
          {accountsEnabled && access === "member" && <UserButton />}
        </div>
      </header>
      <main className="dash-scroll">
        <div className="dash-content">
          <div className="dash-heading">
            <div>
              <span className="eyebrow">
                <i className="orange-rule" /> DESIGN WORKSPACE
              </span>
              <h1>Floorplans</h1>
            </div>
            {access === "member" ? (
              <button
                className="primary"
                onClick={() =>
                  open({ mode: "create", id: crypto.randomUUID() })
                }
              >
                <Plus size={17} />
                New floorplan
              </button>
            ) : access === "guest" ? (
              <Link className="primary" href="/sign-in">
                Sign in to create <ArrowUpRight size={16} />
              </Link>
            ) : null}
          </div>
          {error && (
            <p role="alert" className="dash-error">
              {error} <button onClick={() => void load()}>Refresh</button>
            </p>
          )}
          {access === "loading" && !error && (
            <p role="status">Loading your workspace…</p>
          )}
          {access === "member" && (
            <section aria-label="Saved floorplans">
              <div className="dash-controls">
                <h2>
                  My floorplans <small>{plans.length}</small>
                </h2>
                <label className="dash-search">
                  <Search size={15} />
                  <input
                    aria-label="Search floorplans"
                    placeholder="Search floorplans"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              {results.length ? (
                <div className="dash-grid">
                  {results.map((plan) => (
                    <button
                      key={plan.id}
                      className="dash-card"
                      onClick={() => open({ mode: "view", plan })}
                    >
                      <div className="dash-preview grid-on">
                        {plan.thumbnail ? (
                          <img
                            src={
                              "data:image/svg+xml;charset=utf-8," +
                              encodeURIComponent(plan.thumbnail)
                            }
                            alt=""
                          />
                        ) : (
                          <span className="mono">Preparing preview…</span>
                        )}
                      </div>
                      <div className="dash-card-body">
                        <strong>{plan.name}</strong>
                        <ArrowUpRight size={16} />
                        <span>{area(plan.areaM2)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="dash-empty">
                  <FolderOpen size={26} />
                  <h3>
                    {search
                      ? "No matching floorplans"
                      : "Your library is empty"}
                  </h3>
                  <p>
                    {search
                      ? "Try another plan name."
                      : "Create a blank drawing or start with a rectangular room."}
                  </p>
                </div>
              )}
            </section>
          )}
          {access !== "loading" && (
            <section className="dash-study">
              <div>
                <span className="eyebrow">
                  <i className="orange-rule" /> SAMPLE DRAWING
                </span>
                <h2>Courtyard House</h2>
                <p>
                  Explore a furnished two-bedroom home in plan and isometric
                  views.
                </p>
                <Link className="text-action" href="/?view=sample">
                  Open sample <ArrowUpRight size={16} />
                </Link>
              </div>
              <div className="grid-on study-image">
                <img
                  src="/isometric.webp"
                  alt="Courtyard House architectural cutaway"
                />
              </div>
            </section>
          )}
        </div>
      </main>
      <dialog
        ref={dialog}
        className="modal dash-modal"
        aria-label="Floorplan details"
        onClose={() => setEditor(null)}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="modal-inner">
          <div className="modal-title">
            <span className="eyebrow">
              <Ruler size={15} /> FLOORPLAN
            </span>
            <button
              disabled={busy}
              className="icon-btn"
              aria-label="Close dialog"
              onClick={() => setEditor(null)}
            >
              <X size={18} />
            </button>
          </div>
          {editor && (
            <form key={editor.mode} onSubmit={submit}>
              <h2>
                {editor.mode === "create"
                  ? "New floorplan"
                  : editor.mode === "rename"
                    ? "Rename floorplan"
                    : editor.mode === "delete"
                      ? "Delete floorplan?"
                      : active?.name}
              </h2>
              {(editor.mode === "create" || editor.mode === "rename") && (
                <label>
                  Plan name
                  <input
                    autoFocus
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Courtyard extension"
                  />
                </label>
              )}
              {editor.mode === "create" && (
                <>
                  <label>
                    Starting layout
                    <select
                      value={shape}
                      onChange={(e) => setShape(e.target.value)}
                    >
                      <option value="blank">Blank drawing</option>
                      <option value="room">Rectangular room</option>
                    </select>
                  </label>
                  {shape === "room" && (
                    <div className="dash-dims">
                      {["Width", "Depth"].map((field, i) => (
                        <label key={field}>
                          {field} (m)
                          <input
                            name={field.toLowerCase()}
                            type="number"
                            min=".1"
                            max="100"
                            step=".001"
                            defaultValue={i ? 4 : 6}
                            required
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
              {editor.mode === "delete" && (
                <p>
                  Delete “{active?.name}” from your workspace? This removes its
                  drawing and thumbnail.
                </p>
              )}
              {editor.mode === "view" && active && (
                <>
                  <div className="dash-preview grid-on">
                    {active.thumbnail ? (
                      <img
                        alt="Plan drawing"
                        src={
                          "data:image/svg+xml;charset=utf-8," +
                          encodeURIComponent(active.thumbnail)
                        }
                      />
                    ) : (
                      <span>Preparing preview…</span>
                    )}
                  </div>
                  <p>{area(active.areaM2)}</p>
                  <p>
                    Updated {new Date(active.updatedAt).toLocaleDateString()}
                  </p>
                </>
              )}
              {formError && <p role="alert">{formError}</p>}
              <div className="dash-form-actions">
                {editor.mode === "view" && active ? (
                  <>
                    <button
                      type="button"
                      className="back"
                      onClick={() => open({ mode: "delete", plan: active })}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="dark-btn"
                      onClick={() => open({ mode: "rename", plan: active })}
                    >
                      Rename
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditor(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        ((editor.mode === "create" ||
                          editor.mode === "rename") &&
                          !name.trim())
                      }
                    >
                      {busy
                        ? "Saving…"
                        : editor.mode === "create"
                          ? "Create floorplan"
                          : editor.mode === "delete"
                            ? "Delete floorplan"
                            : "Save name"}
                    </button>
                  </>
                )}
              </div>
            </form>
          )}
        </div>
      </dialog>
    </div>
  );
}
