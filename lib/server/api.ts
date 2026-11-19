import { planRoutes } from "./plan-routes";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Limit } from "./rate-limit";
const identitySchema = z.object({
  mode: z.literal("member"),
  userId: z.string().min(1),
});
export type Environment = { Variables: { identity: z.infer<typeof identitySchema> | undefined } };
export type IdentityMiddleware = MiddlewareHandler<Environment>;
export function createApi(authenticate: IdentityMiddleware, limit: Limit) {
  const app = new Hono<Environment>().basePath("/api");
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    // Vercel overwrites this header at ingress. Local requests share one bucket.
    const key = process.env.VERCEL
      ? c.req.header("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
    try {
      const result = await limit(key || "local");
      if (!result.success) {
        c.header(
          "Retry-After",
          String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))),
        );
        return c.json({ error: "Too many requests" }, 429);
      }
    } catch {
      return c.json({ error: "Rate limit service unavailable" }, 503);
    }
    await next();
  });
  app.use("*", authenticate);
  app.use("*", async (c, next) => {
    if (!c.get("identity")) return c.json({ error: "Sign in required" }, 401);
    await next();
  });
  return app
    .route("/floorplans", planRoutes())
    .get("/session", (c) => c.json(identitySchema.parse(c.get("identity"))))
    .get("/account", (c) => {
      const { userId } = identitySchema.parse(c.get("identity"));
      return c.json({ userId });
    });
}
