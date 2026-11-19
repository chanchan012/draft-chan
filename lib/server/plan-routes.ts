import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { saveStudioSchema } from "../plans/studio-document";
import { newPlan, renamePlan } from "../plans/geometry";
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
  listBlueprints,
  requestBlueprint,
} from "./blueprint-store";
import { queueBlueprint } from "./blueprint-jobs";
import type { Environment } from "./api";

type PlanEnvironment = Environment & { Variables: { owner: string } };
const revisionQuery = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,9})$/)
  .transform(Number)
  .pipe(exportRevision);

function attachment(body: string, type: string, filename: string) {
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
) {
  const app = new Hono<PlanEnvironment>();
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
  app.use("/:id/bom", validateId);
  app.use("/:id/exports", validateId);
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
      await enqueue(id).catch(() =>
        console.warn("Thumbnail queued for scheduled recovery"),
      );
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
      return ok
        ? c.body(null, 204)
        : c.json(
            { error: "Plan changed or is unavailable. Refresh and try again." },
            409,
          );
    });
}
