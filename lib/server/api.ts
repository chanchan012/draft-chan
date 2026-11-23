import { planRoutes } from "./plan-routes";
import { agentRoutes } from "./agent-routes";
import { oauthGrantRoutes } from "./oauth-grant-routes";
import { projectRoutes } from "./project-routes";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Limit } from "./rate-limit";
import type { LiveBus } from "./live-bus";
const identitySchema = z.object({
  mode: z.literal("member"),
  userId: z.string().min(1),
});
export type Environment = {
  Variables: {
    identity: z.infer<typeof identitySchema> | undefined;
    identityExpiresAt: number | undefined;
  };
};
export type IdentityMiddleware = MiddlewareHandler<Environment>;
export function createApi(
  authenticate: IdentityMiddleware,
  limit: Limit,
  { presenceLimit = limit, bus }: { presenceLimit?: Limit; bus?: LiveBus } = {},
) {
  const app = new Hono<Environment>().basePath("/api");
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    // Vercel overwrites this header at ingress. Local requests share one bucket.
    const key = process.env.VERCEL
      ? c.req.header("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
    try {
      const presence =
        c.req.method === "POST" &&
        /^\/api\/floorplans\/[^/]+\/presence$/.test(c.req.path);
      const result = await (presence ? presenceLimit : limit)(key || "local");
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
    .route("/floorplans", agentRoutes())
    .route("/floorplans", oauthGrantRoutes())
    .route("/floorplans/:id/project", projectRoutes(bus))
    .route("/floorplans", planRoutes(undefined, undefined, bus))
    .get("/session", (c) => c.json(identitySchema.parse(c.get("identity"))))
    .get("/account", (c) => {
      const { userId } = identitySchema.parse(c.get("identity"));
      return c.json({ userId });
    });
}
