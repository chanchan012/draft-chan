import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { saveStudioSchema } from "../plans/studio-document";
import { newPlan, renamePlan } from "../plans/geometry";
import { interchangeFormats } from "../plans/interchange-export";
import { interchangeFile } from "./interchange-export";
import { reproduceCoordinationIssue } from "../plans/review-rules";
import { revisionStore } from "./revision-store";
import { bomCsv } from "../plans/bom";
import {
  exportFilename,
  exportRevision,
  requestBlueprintSchema,
} from "../plans/exports";
import { plans } from "./plans";
import { queueThumbnail } from "./thumbnails";
import {
  getBlueprintFile,
  listSheetIssues,
  listBlueprints,
  requestBlueprint,
} from "./blueprint-store";
import { queueBlueprint } from "./blueprint-jobs";
import { presenceInput, type LiveChange } from "../plans/live";
import {
  liveBus,
  publishPlanPresence,
  planChannel,
  type LiveBus,
} from "./live-bus";
import { liveStream } from "./live-stream";
import type { Environment } from "./api";

type PlanEnvironment = Environment & { Variables: { owner: string } };
const revisionQuery = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,9})$/)
  .transform(Number)
  .pipe(exportRevision);

function attachment(body: BodyInit, type: string, filename: string) {
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function planRoutes(
  repo: typeof plans = plans,
  enqueue: (id: string) => Promise<unknown> = queueThumbnail,
  bus: LiveBus = liveBus,
) {
  const app = new Hono<PlanEnvironment>();
  async function notify(owner: string, id: string, change: LiveChange) {
    await bus
      .publish(planChannel(owner, id), change)
      .catch(() => console.warn("Live update deferred to revision refresh"));
  }
  app.use("*", async (c, next) => {
    const identity = c.get("identity");
    if (!identity) return c.json({ error: "Sign in required" }, 401);
    if (c.req.method !== "GET") {
      const origin = c.req.header("Origin");
      if (origin && origin !== new URL(c.req.url).origin)
        return c.json({ error: "Invalid origin" }, 403);
    }
    c.set("owner", identity.userId);
    await next();
  });
  const validateId: MiddlewareHandler<PlanEnvironment> = async (c, next) => {
    if (!z.uuid().safeParse(c.req.param("id")).success)
      return c.json({ error: "Invalid plan ID" }, 400);
    await next();
  };
  app.use("/:id", validateId);
  app.use("/:id/graph", validateId);
  app.use("/:id/live", validateId);
  app.use("/:id/presence", validateId);
  app.use("/:id/bom", validateId);
  app.use("/:id/interchange", validateId);
  app.use("/:id/coordination-issues/:issueId", validateId);
  app.use("/:id/exports", validateId);
  app.use("/:id/issues", validateId);
  app.use("/:id/exports/:exportId/download", validateId);
  return app
    .get("/", async (c) => c.json(await repo.list(c.get("owner"))))
    .get("/:id", async (c) => {
      const p = await repo.get(c.get("owner"), c.req.param("id"));
      return p ? c.json(p) : c.json({ error: "Plan unavailable" }, 404);
    })
    .get("/:id/graph", async (c) => {
      const document = await repo.getStudio(c.get("owner"), c.req.param("id"));
      return document
        ? c.json(document)
        : c.json({ error: "Plan unavailable" }, 404);
    })
    .get("/:id/live", async (c) => {
      const owner = c.get("owner");
      const id = c.req.param("id");
      const revision = await repo.revision(owner, id);
      if (revision === null) return c.json({ error: "Plan unavailable" }, 404);
      return liveStream({
        bus,
        key: planChannel(owner, id),
        revision,
        currentRevision: () => repo.revision(owner, id),
        expiresAt: c.get("identityExpiresAt"),
        signal: c.req.raw.signal,
      });
    })
    .post("/:id/presence", async (c) => {
      const parsed = presenceInput.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return c.json({ error: "Invalid cursor or device ID" }, 400);
      const owner = c.get("owner");
      const id = c.req.param("id");
      if ((await repo.revision(owner, id)) === null)
        return c.json({ error: "Plan unavailable" }, 404);
      try {
        await publishPlanPresence(
          owner,
          id,
          { kind: "human", id: owner },
          parsed.data,
          bus,
        );
      } catch {
        return c.json(
          { error: "Live presence is temporarily unavailable" },
          503,
        );
      }
      return c.body(null, 204);
    })
    .get("/:id/bom", async (c) => {
      const revision = revisionQuery.safeParse(c.req.query("revision"));
      if (!revision.success) return c.json({ error: "Invalid revision" }, 400);
      const plan = await repo.getStudio(c.get("owner"), c.req.param("id"));
      if (!plan) return c.json({ error: "Plan unavailable" }, 404);
      if (plan.revision !== revision.data)
        return c.json(
          {
            error:
              "The saved plan changed. Reopen Studio for the latest revision.",
          },
          409,
        );
      return attachment(
        bomCsv(plan.graph),
        "text/csv; charset=utf-8",
        exportFilename(plan.name, plan.revision, "csv"),
      );
    })
    .get("/:id/exports", async (c) => {
      const revision = revisionQuery.safeParse(c.req.query("revision"));
      if (!revision.success) return c.json({ error: "Invalid revision" }, 400);
      const jobs = await listBlueprints(
        c.get("owner"),
        c.req.param("id"),
        revision.data,
      );
      return jobs ? c.json(jobs) : c.json({ error: "Plan unavailable" }, 404);
    })
    .get("/:id/coordination-issues/:issueId", async (c) => {
      const owner = c.get("owner");
      const planId = c.req.param("id");
      const document = await repo.getStudio(owner, planId);
      const id = c.req.param("issueId");
      const issue = document?.graph.coordination?.find(
        (item) => item.id === id,
      );
      if (!issue || issue.kind !== "issue")
        return c.json({ error: "Coordination issue unavailable." }, 404);
      const source =
        issue.sourceRevision === document?.revision
          ? document
          : (
              await revisionStore.revisions(
                { owner, planId },
                issue.sourceRevision,
                issue.sourceRevision,
              )
            )[0];
      if (!source)
        return c.json({ error: "The source revision is unavailable." }, 404);
      return c.json({
        sourceRevision: source.revision,
        reproduced: reproduceCoordinationIssue(source.graph, issue),
      });
    })
    .get("/:id/interchange", async (c) => {
      const revision = revisionQuery.safeParse(c.req.query("revision"));
      const format = z
        .enum(interchangeFormats)
        .safeParse(c.req.query("format"));
      const storeyId = z
        .string()
        .trim()
        .min(1)
        .max(128)
        .optional()
        .safeParse(c.req.query("storeyId"));
      if (!revision.success || !format.success || !storeyId.success)
        return c.json(
          { error: "Invalid exchange format, revision, or storey." },
          400,
        );
      const planId = c.req.param("id");
      const [document] = await revisionStore.revisions(
        { owner: c.get("owner"), planId },
        revision.data,
        revision.data,
      );
      if (!document)
        return c.json({ error: "Drawing revision unavailable." }, 404);
      if (
        format.data === "typed-dxf" &&
        storeyId.data &&
        !document.graph.storeys?.some((item) => item.id === storeyId.data) &&
        storeyId.data !== "ground"
      )
        return c.json({ error: "The selected storey is unavailable." }, 400);
      const file = interchangeFile(document, format.data, storeyId.data);
      return attachment(file.content, file.type, file.filename);
    })
    .get("/:id/issues", async (c) => {
      const issues = await listSheetIssues(c.get("owner"), c.req.param("id"));
      return issues
        ? c.json(issues)
        : c.json({ error: "Plan unavailable" }, 404);
    })
    .post("/:id/exports", async (c) => {
      const input = requestBlueprintSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success)
        return c.json({ error: "Invalid export format or revision" }, 400);
      const pending = await requestBlueprint(
        c.get("owner"),
        c.req.param("id"),
        input.data,
      );
      if (pending.status === "missing")
        return c.json({ error: "Plan unavailable" }, 404);
      if (pending.status === "invalid")
        return c.json({ error: pending.error }, 400);
      if (pending.status === "stale")
        return c.json(
          {
            error:
              "The saved plan changed. Reopen Studio for the latest revision.",
          },
          409,
        );
      if (pending.queue)
        await queueBlueprint(pending.queue).catch(() =>
          console.warn("Blueprint queued for scheduled recovery"),
        );
      return c.json(
        pending.blueprint,
        pending.blueprint.status === "pending" ? 202 : 200,
      );
    })
    .get("/:id/exports/:exportId/download", async (c) => {
      const id = z.uuid().safeParse(c.req.param("exportId"));
      if (!id.success) return c.json({ error: "Invalid export ID" }, 400);
      const file = await getBlueprintFile(
        c.get("owner"),
        c.req.param("id"),
        id.data,
      );
      if (!file) return c.json({ error: "Export unavailable" }, 404);
      if (file.artifact === null)
        return c.json({ error: "Export is not ready" }, 409);
      if (file.format === "pdf")
        return attachment(
          Uint8Array.from(Buffer.from(file.artifact, "base64")),
          "application/pdf",
          exportFilename(file.name, file.revision, "pdf"),
        );
      return attachment(
        file.artifact,
        file.format === "svg"
          ? "image/svg+xml; charset=utf-8"
          : "application/dxf",
        exportFilename(file.name, file.revision, file.format),
      );
    })
    .patch("/:id/graph", async (c) => {
      const parsed = saveStudioSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return c.json({ error: "Invalid plan geometry or revision" }, 400);
      const id = c.req.param("id");
      const result = await repo.saveStudio(c.get("owner"), id, parsed.data);
      if (result.status === "invalid")
        return c.json({ error: result.error }, 400);
      if (result.status === "conflict")
        return c.json({ error: "Plan changed or is unavailable." }, 409);
      await Promise.all([
        notify(c.get("owner"), id, {
          type: "revision",
          revision: result.revision,
        }),
        enqueue(id).catch(() =>
          console.warn("Thumbnail queued for scheduled recovery"),
        ),
      ]);
      return c.json({ revision: result.revision });
    })
    .post("/", async (c) => {
      const parsed = newPlan.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return c.json(
          { error: "Enter a name and valid room dimensions." },
          400,
        );
      const plan = await repo.create(c.get("owner"), parsed.data);
      if (!plan) return c.json({ error: "Plan ID unavailable" }, 409);
      if (!plan.thumbnail)
        await enqueue(plan.id).catch(() =>
          console.warn("Thumbnail queued for scheduled recovery"),
        );
      return c.json(plan, 201);
    })
    .patch("/:id", async (c) => {
      const parsed = renamePlan.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return c.json({ error: "Invalid name or revision" }, 400);
      const p = await repo.rename(
        c.get("owner"),
        c.req.param("id"),
        parsed.data.revision,
        parsed.data.name,
      );
      if (p)
        await notify(c.get("owner"), p.id, {
          type: "revision",
          revision: p.revision,
        });
      return p
        ? c.json(p)
        : c.json(
            { error: "Plan changed or is unavailable. Refresh and try again." },
            409,
          );
    })
    .delete("/:id", async (c) => {
      const parsed = z
        .object({ revision: z.number().int().nonnegative() })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid revision" }, 400);
      const ok = await repo.remove(
        c.get("owner"),
        c.req.param("id"),
        parsed.data.revision,
      );
      if (ok)
        await notify(c.get("owner"), c.req.param("id"), { type: "deleted" });
      return ok
        ? c.body(null, 204)
        : c.json(
            { error: "Plan changed or is unavailable. Refresh and try again." },
            409,
          );
    });
}
