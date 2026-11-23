"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  mayEdit,
  mayReview,
  projectRoles,
  type ClientGrant,
  type ProjectDetails,
  type ProjectRole,
  type ReviewNote,
  type RevisionEntry,
} from "@/lib/plans/projects";

type Tab = "Options" | "Review" | "History" | "Members" | "Agent access";
type Comparison = {
  before: { areaM2: number };
  after: { areaM2: number };
  changeCounts: { added: number; updated: number; removed: number };
};
type Mutation = { method: "POST" | "PUT" | "DELETE"; data?: object };
const formats = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dates = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

async function request<T>(
  url: string,
  mutation?: Mutation,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    signal,
    method: mutation?.method,
    ...(mutation?.data && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation.data),
    }),
  });
  const result =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(result?.error ?? "The project could not be updated.");
  return result as T;
}

function submit(
  event: FormEvent<HTMLFormElement>,
  action: (data: FormData, form: HTMLFormElement) => void,
) {
  event.preventDefault();
  action(new FormData(event.currentTarget), event.currentTarget);
}

export function ProjectPanel({
  planId,
  userId,
  role,
  revision,
  dirty,
  onRestore,
}: {
  planId: string;
  userId: string;
  role: ProjectRole;
  revision: number;
  dirty: boolean;
  onRestore(revision: number): void;
}) {
  const path = "/api/floorplans/" + planId + "/project";
  const [view, setView] = useState<Tab>("Options");
  const [project, setProject] = useState<ProjectDetails>();
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [history, setHistory] = useState<RevisionEntry[]>([]);
  const [grants, setGrants] = useState<ClientGrant[]>([]);
  const [compare, setCompare] = useState<Comparison>();
  const [restore, setRestore] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const access = project?.role ?? role;
  const editable = mayEdit(access);
  const tabs: Tab[] =
    access === "owner"
      ? ["Options", "Review", "History", "Members", "Agent access"]
      : ["Options", "Review", "History"];

  useEffect(() => {
    const abort = new AbortController();
    const load = <T,>(subpath: string, setter: (data: T) => void) =>
      request<T>(path + subpath, undefined, abort.signal)
        .then(setter)
        .catch((cause: Error) => {
          if (!abort.signal.aborted) setError(cause.message);
        });
    void load("", setProject);
    if (view === "Review") void load("/reviews", setNotes);
    if (view === "History") void load("/revisions", setHistory);
    if (view === "Agent access" && access === "owner")
      void load("/agent-clients", setGrants);
    return () => abort.abort();
  }, [path, view, revision, refresh, access]);

  const run = useCallback(
    async (action: () => Promise<void>, success: string, reload = true) => {
      setError("");
      setNotice("");
      setBusy(true);
      try {
        await action();
        if (success) setNotice(success);
        if (reload) setRefresh((value) => value + 1);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The project could not be updated.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const others =
    project?.options.filter((option) => option.id !== planId) ?? [];
  return (
    <section className="studio-fields studio-project">
      <div
        className="studio-building-tabs"
        role="group"
        aria-label="Project views"
      >
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            disabled={busy}
            aria-pressed={view === tab}
            onClick={() => {
              setView(tab);
              setNotice("");
              setError("");
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      {error && (
        <p className="coordination-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!project && !error && <p>Loading project…</p>}

      {project && view === "Options" && (
        <>
          <p>Project role · {access}</p>
          <ul className="studio-project-list" aria-label="Design options">
            {project.options.map((option) => (
              <li key={option.id}>
                <a
                  href={"/studio/" + option.id}
                  aria-current={option.id === planId ? "page" : undefined}
                >
                  {option.name}
                </a>
                <span>
                  Revision {option.revision}
                  {option.id === project.projectId ? " · Original" : ""}
                </span>
              </li>
            ))}
          </ul>
          {editable && (
            <form
              className="studio-fields"
              onSubmit={(event) =>
                submit(
                  event,
                  (data, form) =>
                    void run(async () => {
                      await request(path + "/options", {
                        method: "POST",
                        data: {
                          id: crypto.randomUUID(),
                          name: String(data.get("name")),
                          sourceRevision: revision,
                        },
                      });
                      form.reset();
                    }, "Option created."),
                )
              }
            >
              <label>
                New option name
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="Kitchen layout B"
                />
              </label>
              <button
                className="studio-cad-apply"
                type="submit"
                disabled={dirty || busy}
              >
                Fork saved revision {revision}
              </button>
            </form>
          )}
          {!!others.length && (
            <form
              className="studio-fields"
              onSubmit={(event) =>
                submit(event, (data) => {
                  const option = others.find(
                    (item) => item.id === data.get("option"),
                  );
                  if (!option) return;
                  const query = new URLSearchParams({
                    optionId: option.id,
                    beforeRevision: String(revision),
                    afterRevision: String(option.revision),
                  });
                  void run(
                    async () => {
                      setCompare(await request(path + "/compare?" + query));
                    },
                    "",
                    false,
                  );
                })
              }
            >
              <label>
                Compare saved geometry
                <select
                  name="option"
                  required
                  onChange={() => setCompare(undefined)}
                >
                  {others.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · r{option.revision}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="interchange-action"
                type="submit"
                disabled={busy}
              >
                Compare options
              </button>
            </form>
          )}
          {compare && (
            <div className="coordination-card">
              <p>
                {formats.format(compare.before.areaM2)} m² →{" "}
                {formats.format(compare.after.areaM2)} m²
              </p>
              <p>
                {compare.changeCounts.added} added ·{" "}
                {compare.changeCounts.updated} changed ·{" "}
                {compare.changeCounts.removed} removed
              </p>
            </div>
          )}
        </>
      )}

      {project && view === "Review" && (
        <>
          {mayReview(access) && (
            <form
              className="studio-fields"
              onSubmit={(event) =>
                submit(
                  event,
                  (data, form) =>
                    void run(async () => {
                      await request(path + "/reviews", {
                        method: "POST",
                        data: {
                          id: crypto.randomUUID(),
                          revision: Number(data.get("revision")),
                          body: String(data.get("note")),
                          kind: data.get("kind"),
                        },
                      });
                      form.reset();
                    }, "Review saved."),
                )
              }
            >
              <label>
                Revision to review
                <input
                  key={revision}
                  name="revision"
                  type="number"
                  min={0}
                  max={revision}
                  required
                  defaultValue={revision}
                />
              </label>
              {editable ? (
                <label>
                  Review action
                  <select name="kind">
                    <option value="comment">Comment</option>
                    <option value="request">Request review</option>
                  </select>
                </label>
              ) : (
                <input type="hidden" name="kind" value="comment" />
              )}
              <label>
                Review note
                <textarea name="note" rows={3} required maxLength={2000} />
              </label>
              <button
                className="studio-cad-apply"
                type="submit"
                disabled={busy}
              >
                Post review
              </button>
            </form>
          )}
          <ul className="studio-project-list" aria-label="Review notes">
            {notes.map((note) => (
              <li key={note.id}>
                <strong>
                  {note.kind === "request" ? "Review request" : "Comment"} · r
                  {note.revision}
                </strong>
                <p>{note.body}</p>
                <small>
                  {note.actorId === userId
                    ? "You"
                    : note.actorKind === "ai"
                      ? "Agent " + note.actorId
                      : note.actorId}{" "}
                  · {dates.format(new Date(note.createdAt))}
                </small>
              </li>
            ))}
          </ul>
          {!notes.length && <p>No review notes yet.</p>}
        </>
      )}

      {project && view === "History" && (
        <>
          {restore !== undefined && (
            <div className="coordination-card">
              <strong>Restore revision {restore}?</strong>
              <p>Draft will save its geometry as a new revision.</p>
              <div className="interchange-choices">
                <button
                  type="button"
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(async () => {
                      const saved = await request<{ revision: number }>(
                        path + "/restore",
                        {
                          method: "POST",
                          data: {
                            expectedRevision: revision,
                            sourceRevision: restore,
                          },
                        },
                      );
                      setRestore(undefined);
                      onRestore(saved.revision);
                    }, "Revision restored.")
                  }
                >
                  Confirm restore
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRestore(undefined)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <ul
            className="studio-project-list"
            aria-label="Saved revision history"
          >
            {history.map((entry) => (
              <li key={entry.revision}>
                <strong>
                  Revision {entry.revision}
                  {entry.revision === revision ? " · Current" : ""}
                </strong>
                {entry.sourceRevision !== null && (
                  <small>
                    Restored from r{entry.sourceRevision} by{" "}
                    {entry.actorId === userId ? "you" : entry.actorId}
                  </small>
                )}
                {editable && entry.revision < revision && (
                  <button
                    className="interchange-action"
                    type="button"
                    disabled={busy || dirty}
                    onClick={() => setRestore(entry.revision)}
                  >
                    Restore r{entry.revision}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {history.length >= 40 && (
            <button
              type="button"
              className="interchange-action"
              disabled={busy}
              onClick={() =>
                void run(
                  async () => {
                    const older = await request<RevisionEntry[]>(
                      path + "/revisions?before=" + history.at(-1)!.revision,
                    );
                    if (older.length)
                      setHistory((current) => [...current, ...older]);
                    else setNotice("All revisions are shown.");
                  },
                  "",
                  false,
                )
              }
            >
              Load earlier revisions
            </button>
          )}
        </>
      )}

      {project && view === "Members" && access === "owner" && (
        <>
          <p>Members can access all options in this project.</p>
          <form
            className="studio-fields"
            onSubmit={(event) =>
              submit(
                event,
                (data, form) =>
                  void run(async () => {
                    await request(path + "/members", {
                      method: "PUT",
                      data: {
                        userId: data.get("member"),
                        role: data.get("role"),
                      },
                    });
                    form.reset();
                  }, "Membership saved."),
              )
            }
          >
            <label>
              Clerk user ID
              <input
                name="member"
                placeholder="user_…"
                required
                maxLength={125}
              />
            </label>
            <label>
              Role
              <select name="role">
                {projectRoles.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button className="studio-cad-apply" type="submit" disabled={busy}>
              Save member
            </button>
          </form>
          <ul className="studio-project-list" aria-label="Project members">
            {(project.members ?? []).map((member) => (
              <li key={member.userId}>
                <strong>{member.userId}</strong>
                <span>{member.role}</span>
                <button
                  type="button"
                  className="interchange-action"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(
                        path + "/members/" + encodeURIComponent(member.userId),
                        { method: "DELETE" },
                      );
                    }, "Member removed.")
                  }
                >
                  Remove access
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {project && view === "Agent access" && access === "owner" && (
        <>
          <p>
            Assign a Clerk OAuth client to this option. An assignment replaces
            its previous option.
          </p>
          <form
            className="studio-fields"
            onSubmit={(event) =>
              submit(
                event,
                (data, form) =>
                  void run(async () => {
                    await request(path + "/agent-clients", {
                      method: "PUT",
                      data: {
                        clientId: data.get("client"),
                        enabled: data.get("grant") === "allow",
                      },
                    });
                    form.reset();
                  }, "Client access saved."),
              )
            }
          >
            <label>
              OAuth client ID
              <input name="client" required maxLength={512} />
            </label>
            <label>
              Access
              <select name="grant">
                <option value="allow">Allow this option</option>
                <option value="block">Block this option</option>
              </select>
            </label>
            <button className="studio-cad-apply" type="submit" disabled={busy}>
              Save client access
            </button>
          </form>
          <ul className="studio-project-list" aria-label="OAuth client grants">
            {grants.map((grant) => (
              <li key={grant.clientId}>
                <strong>{grant.clientId}</strong>
                <span>{grant.enabled ? "Allowed" : "Blocked"}</span>
                <button
                  type="button"
                  className="interchange-action"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request(path + "/agent-clients", {
                        method: "PUT",
                        data: {
                          clientId: grant.clientId,
                          enabled: !grant.enabled,
                        },
                      });
                    }, "Client access saved.")
                  }
                >
                  {grant.enabled ? "Block client" : "Allow client"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
