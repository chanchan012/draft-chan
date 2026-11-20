"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";

type Agent = { id: string; name: string; expiresAt: string };
type Issued = Agent & { token: string };
const expiry = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function McpSetup({
  planId,
  onClose,
}: {
  planId: string;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const base = `/api/floorplans/${planId}/agent-tokens`;
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
  }, [base]);

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
      <p>
        Agent tokens grant access to this floorplan and expire after seven days.
      </p>
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
      <details>
        <summary>Client setup</summary>
        <p>
          For HTTP, use the URL above and send the token as an Authorization
          header using Bearer authentication.
        </p>
        <p>
          For stdio, run <code>node scripts/mcp-stdio.mjs</code> from your Draft
          checkout. Set <code>DRAFT_MCP_URL</code> and{" "}
          <code>DRAFT_MCP_TOKEN</code> in the client’s environment.
        </p>
      </details>
      <div className="studio-agent-list">
        <h3>Active tokens</h3>
        {agents.length === 0 && <p>{busy ? "Loading…" : "No active tokens"}</p>}
        {agents.map((agent) => (
          <div key={agent.id}>
            <span>
              <strong>{agent.name}</strong>
              <small>Expires {expiry.format(new Date(agent.expiresAt))}</small>
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
      {status && <p role="status">{status}</p>}
    </dialog>
  );
}
