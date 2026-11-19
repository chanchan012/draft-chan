import { Hono } from "hono";
import { z } from "zod";
import { newPlan, renamePlan } from "../plans/geometry";
import { plans } from "./plans";
import { queueThumbnail } from "./thumbnails";
import type { Environment } from "./api";

export function planRoutes(
  repo: typeof plans = plans,
  enqueue: (id: string) => Promise<unknown> = queueThumbnail,
) {
  const app = new Hono<Environment & { Variables: { owner: string } }>();
  app.use("*", async (c, next) => {
    const identity = c.get("identity");
    if (identity.mode !== "member")
      return c.json({ error: "Sign in required" }, 401);
    if (c.req.method !== "GET") {
      const origin = c.req.header("Origin");
      if (origin && origin !== new URL(c.req.url).origin)
        return c.json({ error: "Invalid origin" }, 403);
    }
    c.set("owner", identity.userId);
    await next();
  });
  app.use("/:id", async (c, next) => {
    if (!z.uuid().safeParse(c.req.param("id")).success)
      return c.json({ error: "Invalid plan ID" }, 400);
    await next();
  });
  return app
    .get("/", async (c) => c.json(await repo.list(c.get("owner"))))
    .get("/:id", async (c) => {
      const p = await repo.get(c.get("owner"), c.req.param("id"));
      return p ? c.json(p) : c.json({ error: "Plan unavailable" }, 404);
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
