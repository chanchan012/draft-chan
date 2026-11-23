"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";

type Agent = { id: string; name: string; expiresAt: string };
type Issued = Agent & { token: string };
type OAuthState = "enabled" | "disabled" | "other_plan" | "unavailable";
const expiry = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function McpSetup({
  planId,
  alternative = false,
  onClose,
}: {
  planId: string;
  alternative?: boolean;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const base = `/api/floorplans/${planId}/agent-tokens`;
  const oauthPath = `/api/floorplans/${planId}/mcp-oauth`;
  const [oauth, setOauth] = useState<OAuthState>();
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<Issued>();
  const [endpoint, setEndpoint] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [confirm, setConfirm] = useState<string>();

  useEffect(() => {
    dialog.current?.showModal();
    setEndpoint(window.location.origin + "/api/mcp");
    const abort = new AbortController();
    if (!alternative)
      void fetch(oauthPath, { signal: abort.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const result = (await response.json()) as { state: OAuthState };
          setOauth(result.state);
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setOauthError("Could not load OAuth access.");
        });
    void fetch(base, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load agent tokens.");
        setAgents(await response.json());
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Could not load agent tokens.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [base, oauthPath, alternative]);

  async function updateOAuth(enable: boolean) {
    setOauthBusy(true);
    setOauthError("");
    try {
      const response = await fetch(oauthPath, {
        method: enable ? "POST" : "DELETE",
      });
      if (response.status === 409) setOauth("other_plan");
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "Could not update OAuth access.");
      }
      setOauth(enable ? "enabled" : "disabled");
      setStatus(enable ? "OAuth access enabled." : "OAuth access disabled.");
    } catch (error) {
      setOauthError(
        error instanceof Error
          ? error.message
          : "Could not update OAuth access.",
      );
    } finally {
      setOauthBusy(false);
    }
  }

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Could not create a token.");
      const credential = payload as Issued;
      setIssued(credential);
      setAgents((list) =>
        [credential, ...list].map(({ id, name, expiresAt }) => ({
          id,
          name,
          expiresAt,
        })),
      );
      setName("");
      setStatus("Token created.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create a token.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(base + "/" + id, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke the token.");
      setAgents((list) => list.filter((agent) => agent.id !== id));
      setIssued((current) => (current?.id === id ? undefined : current));
      setConfirm(undefined);
      setStatus("Token revoked.");
    } catch {
      setError("Could not revoke the token.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(label + " copied.");
    } catch {
      setStatus("Select the text and copy it manually.");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="studio-agent-dialog"
      aria-labelledby="draft-agent-title"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="studio-agent-heading">
        <h2 id="draft-agent-title">Connect an agent</h2>
        <button
          type="button"
          className="studio-agent-icon"
          aria-label="Close agent setup"
          onClick={() => dialog.current?.close()}
        >
          <X size={17} />
        </button>
      </div>
      <div className="studio-agent-field">
        <label htmlFor="draft-agent-endpoint">MCP endpoint</label>
        <span>
          <input id="draft-agent-endpoint" value={endpoint} readOnly />
          <button
            type="button"
            aria-label="Copy MCP endpoint"
            className="studio-agent-icon"
            onClick={() => void copy(endpoint, "Endpoint")}
          >
            <Copy size={16} />
          </button>
        </span>
      </div>
      <section
        className="studio-agent-oauth"
        aria-labelledby="draft-agent-oauth"
      >
        <h3 id="draft-agent-oauth">Sign in with Clerk</h3>
        {alternative ? (
          <p>
            Assign a Clerk OAuth client under Project → Agent access, then
            connect from the registered Draft address.
          </p>
        ) : oauth === "unavailable" ? (
          <p>Clerk OAuth is available at the registered Draft address.</p>
        ) : oauth === "other_plan" ? (
          <p>
            OAuth is enabled for another floorplan. Disable it there to enable
            access here.
          </p>
        ) : oauth === "enabled" ? (
          <>
            <p>
              Add the MCP endpoint in your client and sign in with Clerk.
              Approved clients can edit this floorplan.
            </p>
            <button
              type="button"
              disabled={oauthBusy}
              onClick={() => void updateOAuth(false)}
            >
              Disable OAuth access
            </button>
          </>
        ) : oauth === "disabled" ? (
          <>
            <p>
              Allow approved OAuth clients to edit this floorplan. Your account
              can enable one floorplan at a time.
            </p>
            <button
              type="button"
              disabled={oauthBusy}
              onClick={() => void updateOAuth(true)}
            >
              Enable OAuth access
            </button>
          </>
        ) : !oauthError ? (
          <p>Checking OAuth access…</p>
        ) : null}
        {oauthError && (
          <p className="studio-agent-error" role="alert">
            {oauthError}
          </p>
        )}
      </section>
      <details>
        <summary>Manual tokens</summary>
        <p>
          Manual tokens let older clients access this floorplan for seven days.
        </p>
        <form
          className="studio-agent-new"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="studio-agent-field">
            Agent name
            <input
              maxLength={48}
              required
              placeholder="Layout assistant"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            Create token
          </button>
        </form>
        {issued && (
          <fieldset className="studio-agent-issued">
            <legend>New token</legend>
            <p>Copy this token now. It appears once.</p>
            <div className="studio-agent-field">
              <label htmlFor="draft-agent-token">Bearer token</label>
              <span>
                <input id="draft-agent-token" value={issued.token} readOnly />
                <button
                  type="button"
                  aria-label="Copy bearer token"
                  className="studio-agent-icon"
                  onClick={() => void copy(issued.token, "Token")}
                >
                  <Copy size={16} />
                </button>
              </span>
            </div>
          </fieldset>
        )}
        <p>
          For HTTP, send the token to this endpoint as a Bearer credential. For
          stdio, run <code>node scripts/mcp-stdio.mjs</code> from your Draft
          checkout with <code>DRAFT_MCP_URL</code> and{" "}
          <code>DRAFT_MCP_TOKEN</code> set.
        </p>
        <div className="studio-agent-list">
          <h3>Active tokens</h3>
          {agents.length === 0 && (
            <p>{busy ? "Loading…" : "No active tokens"}</p>
          )}
          {agents.map((agent) => (
            <div key={agent.id}>
              <span>
                <strong>{agent.name}</strong>
                <small>
                  Expires {expiry.format(new Date(agent.expiresAt))}
                </small>
              </span>
              {confirm === agent.id ? (
                <span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(agent.id)}
                  >
                    Confirm revoke
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm(agent.id)}
                  aria-label={`Revoke ${agent.name}`}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
        {error && (
          <p className="studio-agent-error" role="alert">
            {error}
          </p>
        )}
      </details>
      {status && <p role="status">{status}</p>}
    </dialog>
  );
}
