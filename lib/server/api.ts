import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Limit } from "./rate-limit";
export const identitySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("guest") }),
  z.object({ mode: z.literal("member"), userId: z.string().min(1) }),
]);
type Environment = { Variables: { identity: z.infer<typeof identitySchema> } };
export type IdentityMiddleware = MiddlewareHandler<Environment>;
export function createApi(authenticate: IdentityMiddleware, limit: Limit) {
  const app = new Hono<Environment>().basePath("/api");
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    // Vercel overwrites this header at ingress. Local demos share one bucket.
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
  return app
    .get("/session", (c) => c.json(identitySchema.parse(c.get("identity"))))
    .get("/account", (c) => {
      const identity = c.get("identity");
      if (identity.mode === "guest")
        return c.json({ error: "Sign in required" }, 401);
      return c.json({ userId: identity.userId });
    });
}
