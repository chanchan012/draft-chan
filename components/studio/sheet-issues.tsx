import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { issueSheets } from "@/lib/plans/construction-schedules";
import { blueprintSchema, type Blueprint } from "@/lib/plans/exports";
import type { DraftPlanState } from "@/lib/plans/model";

const issueList = z.array(blueprintSchema);

export function SheetIssues({
  plan,
  planId,
  revision,
  dirty,
}: {
  plan: DraftPlanState;
  planId: string;
  revision: number;
  dirty: boolean;
}) {
  const base = "/api/floorplans/" + planId;
  const [issues, setIssues] = useState<Blueprint[]>();
  const [pending, setPending] = useState<number>();
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const requirement = useMemo(() => {
    try {
      issueSheets(plan);
      return "";
    } catch (cause) {
      return cause instanceof Error
        ? cause.message
        : "The sheet set is incomplete.";
    }
  }, [plan]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const response = await fetch(base + "/issues", {
          signal: abort.signal,
        });
        if (!response.ok) throw new Error("Issue history is unavailable.");
        const result = issueList.parse(await response.json());
        if (abort.signal.aborted) return;
        setIssues(result);
        setStatus("");
        if (result.some((issue) => issue.status === "pending"))
          timer = setTimeout(check, 4000);
      } catch {
        if (abort.signal.aborted) return;
        setStatus("Could not refresh issue history.");
      }
    }
    void check();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [base, refresh]);

  async function publish(source: number) {
    setPending(source);
    setError("");
    try {
      const response = await fetch(base + "/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "pdf", revision: source }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(json?.error ?? "Could not publish the sheet set.");
      const issue = blueprintSchema.parse(json);
      setIssues((prior) =>
        [issue, ...(prior ?? []).filter(({ id }) => id !== issue.id)].sort(
          (a, b) => b.revision - a.revision,
        ),
      );
      setRefresh((attempt) => attempt + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not publish the sheet set.",
      );
    } finally {
      setPending(undefined);
    }
  }
  const existing = issues?.find((issue) => issue.revision === revision);
  const canPublish =
    !dirty && !requirement && pending === undefined && !existing;
  return (
    <>
      <h3>Publish drawing set</h3>
      <p>
        {dirty
          ? "Save your edits before publishing."
          : requirement || "Source revision " + revision}
      </p>
      <button
        type="button"
        className="studio-cad-apply"
        disabled={!canPublish}
        onClick={() => void publish(revision)}
      >
        Publish PDF set
      </button>
      {error && (
        <p role="alert" className="sheets-error">
          {error}
        </p>
      )}
      {status && (
        <p role="status">
          {status}{" "}
          <button
            type="button"
            onClick={() => setRefresh((attempt) => attempt + 1)}
          >
            Refresh
          </button>
        </p>
      )}
      <h3>Issue history</h3>
      {!issues && !status && <p role="status">Checking issues…</p>}
      {issues?.length === 0 && <p>No issued sets</p>}
      {issues?.map((issue) => (
        <div key={issue.id} className="sheet-issue">
          <strong>Revision {issue.revision}</strong>
          {issue.status === "pending" && <p role="status">Rendering PDF…</p>}
          {issue.status === "failed" && (
            <button
              type="button"
              className="studio-cad-apply"
              disabled={pending !== undefined}
              onClick={() => void publish(issue.revision)}
            >
              Retry PDF
            </button>
          )}
          {issue.status === "ready" && (
            <a href={base + "/exports/" + issue.id + "/download"}>
              Download PDF
            </a>
          )}
        </div>
      ))}
    </>
  );
}
