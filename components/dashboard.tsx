"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  FolderOpen,
  Plus,
  Ruler,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { authModalHref } from "@/lib/auth-navigation";
import { Brand } from "./brand";
import { Sheet } from "./sheet";
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
export function Dashboard({ account }: { account: ReactNode }) {
  const [plans, setPlans] = useState<PlanCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null),
    [name, setName] = useState(""),
    [shape, setShape] = useState("blank");
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    sampleDialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0),
    lock = useRef(false);
  const endSession = useCallback(() => {
    generation.current++;
    setPlans([]);
    setLoaded(false);
    setEditor(null);
    location.replace(authModalHref("sign-in", "/dashboard"));
  }, []);
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const response = await fetch("/api/floorplans", { cache: "no-store" });
      if (version !== generation.current) return;
      if (response.status === 401) {
        endSession();
        return;
      }
      if (!response.ok) throw Error();
      const rows = (await response.json()) as PlanCard[];
      if (version === generation.current) {
        setPlans(rows);
        setLoaded(true);
        setError("");
      }
    } catch {
      if (version === generation.current)
        setError("Your floorplans could not be loaded.");
    }
  }, [endSession]);
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
          endSession();
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
          <div className="dash-account">{account}</div>
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
            {loaded && (
              <button
                className="primary"
                onClick={() =>
                  open({ mode: "create", id: crypto.randomUUID() })
                }
              >
                <Plus size={17} />
                New floorplan
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="dash-error">
              {error} <button onClick={() => void load()}>Refresh</button>
            </p>
          )}
          {!loaded && !error && (
            <p role="status">Loading your workspace…</p>
          )}
          {loaded && (
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
          {loaded && (
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
                <button
                  className="text-action"
                  onClick={() => sampleDialog.current?.showModal()}
                >
                  Open sample <ArrowUpRight size={16} />
                </button>
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
        ref={sampleDialog}
        className="modal sample-modal"
        aria-labelledby="sample-title"
      >
        <div className="modal-inner">
          <div className="modal-title">
            <h2 id="sample-title">Sample plan</h2>
            <button
              className="icon-btn"
              aria-label="Close sample"
              onClick={() => sampleDialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <Sheet expanded />
        </div>
      </dialog>
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
                      <Link className="primary" href={`/studio/${active.id}`}>
                      Open Studio <ArrowUpRight size={15} />
                    </Link>
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
