"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { z } from "zod";
import {
  blueprintSchema,
  exportFilename,
  type Blueprint,
  type BlueprintFormat,
} from "@/lib/plans/exports";

const blueprintList = z.array(blueprintSchema);
const formats = [
  { key: "dxf", label: "DXF", detail: "Editable CAD drawing" },
  { key: "svg", label: "SVG", detail: "Scalable vector blueprint" },
] as const;

async function responseError(response: Response, fallback: string) {
  const result = await response.json().catch(() => null);
  return typeof result?.error === "string" ? result.error : fallback;
}

export function ExportPanel({
  id,
  name,
  revision,
  dirty,
  readOnly = false,
}: {
  id: string;
  name: string;
  revision: number;
  dirty: boolean;
  readOnly?: boolean;
}) {
  const base = `/api/floorplans/${id}`;
  const statusUrl = `${base}/exports?revision=${revision}`;
  const [jobs, setJobs] = useState<Blueprint[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [check, setCheck] = useState(0);
  const [sending, setSending] = useState<BlueprintFormat | "csv" | null>(null);
  const [statusError, setStatusError] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    let next: ReturnType<typeof setTimeout>;
    let polling = false;

    async function refresh() {
      let delay = 4_000;
      try {
        const response = await fetch(statusUrl, { signal: abort.signal });
        if (!response.ok) {
          if (response.status === 429)
            delay = Math.max(
              delay,
              (Number(response.headers.get("Retry-After")) || 0) * 1000,
            );
          if (response.status === 401 || response.status === 404)
            polling = false;
          throw new Error(
            await responseError(response, "Export status is unavailable."),
          );
        }
        const rows = blueprintList.parse(await response.json());
        if (abort.signal.aborted) return;
        setJobs(rows);
        setStatusError("");
        polling = rows.some(({ status }) => status === "pending");
      } catch (error) {
        if (abort.signal.aborted) return;
        setStatusError(
          error instanceof Error && error.message === "Sign in required"
            ? "Sign in again to view your exports."
            : "Could not refresh export status.",
        );
      } finally {
        if (!abort.signal.aborted) {
          setLoaded(true);
          if (polling) next = setTimeout(refresh, delay);
        }
      }
    }

    void refresh();
    return () => {
      abort.abort();
      clearTimeout(next);
    };
  }, [statusUrl, check]);

  async function generate(format: BlueprintFormat) {
    setSending(format);
    setActionError("");
    try {
      const response = await fetch(`${base}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, revision }),
      });
      if (!response.ok)
        throw new Error(
          await responseError(response, "Could not queue the blueprint."),
        );
      const job = blueprintSchema.parse(await response.json());
      setJobs((rows) => [
        ...rows.filter((other) => other.format !== format),
        job,
      ]);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not queue the blueprint.",
      );
    } finally {
      setSending(null);
      setCheck((value) => value + 1);
    }
  }

  async function downloadFile(format: BlueprintFormat | "csv", path: string) {
    setSending(format);
    setActionError("");
    try {
      const response = await fetch(path);
      if (!response.ok)
        throw new Error(
          await responseError(response, "Could not download the file."),
        );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      const fileName = /filename="([a-z0-9.-]+)"/i.exec(
        response.headers.get("Content-Disposition") ?? "",
      );
      link.download = fileName?.[1] ?? exportFilename(name, revision, format);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not download the file.",
      );
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="studio-export-content">
      <p className="studio-export-revision">Saved revision {revision}</p>
      {dirty && (
        <p className="studio-export-note">
          Save your changes to export the latest drawing.
        </p>
      )}
      <section className="studio-export-row" aria-label="Bill of materials">
        <div>
          <h3>Bill of materials</h3>
          <p>CSV quantities</p>
        </div>
        <button
          type="button"
          onClick={() =>
            void downloadFile("csv", `${base}/bom?revision=${revision}`)
          }
          disabled={dirty || sending !== null}
        >
          <Download size={15} /> CSV
        </button>
      </section>
      <section className="studio-export-blueprints" aria-label="Blueprints">
        {formats.map(({ key, label, detail }) => {
          const job = jobs.find(({ format }) => format === key);
          return (
            <div className="studio-export-row" key={key}>
              <div>
                <h3>{label}</h3>
                <p aria-live="polite">
                  {job?.status === "pending"
                    ? "Queued or rendering…"
                    : job?.status === "failed"
                      ? "Export failed"
                      : detail}
                </p>
              </div>
              {job?.status === "ready" ? (
                <button
                  type="button"
                  aria-label={`Download ${label}`}
                  disabled={sending !== null}
                  onClick={() =>
                    void downloadFile(key, `${base}/exports/${job.id}/download`)
                  }
                >
                  <Download size={15} /> Download
                </button>
              ) : readOnly ? null : (
                <button
                  type="button"
                  aria-label={`${job?.status === "failed" ? "Retry" : "Generate"} ${label}`}
                  disabled={
                    !loaded ||
                    dirty ||
                    sending !== null ||
                    job?.status === "pending"
                  }
                  onClick={() => void generate(key)}
                >
                  {job?.status === "failed" ? "Retry" : "Generate"}
                </button>
              )}
            </div>
          );
        })}
      </section>
      {!loaded && (
        <p className="studio-export-note" aria-live="polite">
          Checking exports…
        </p>
      )}
      {actionError && (
        <p className="studio-export-error" role="alert">
          {actionError}
        </p>
      )}
      {statusError && (
        <div className="studio-export-error">
          <p role="alert">{statusError}</p>
          <button type="button" onClick={() => setCheck((value) => value + 1)}>
            Refresh status
          </button>
        </div>
      )}
    </div>
  );
}
