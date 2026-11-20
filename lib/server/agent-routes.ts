import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Environment } from "./api";
import {
  agentName,
  issueAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from "./agent-tokens";

export function agentRoutes() {
  const app = new Hono<Environment>();
  const createInput = z.strictObject({ name: agentName });

  app.use("/:id/agent-tokens", guard);
  app.use("/:id/agent-tokens/:tokenId", guard);
  return app
    .get("/:id/agent-tokens", async (c) => {
      const list = await listAgentTokens(
        c.get("identity")!.userId,
        c.req.param("id"),
      );
      return list ? c.json(list) : c.json({ error: "Plan unavailable" }, 404);
    })
    .post("/:id/agent-tokens", async (c) => {
      const input = createInput.safeParse(await c.req.json().catch(() => null));
      if (!input.success)
        return c.json(
          { error: "Enter an agent name from 1 to 48 characters." },
          400,
        );
      const result = await issueAgentToken(
        c.get("identity")!.userId,
        c.req.param("id"),
        input.data.name,
      );
      if (result.status === "created") return c.json(result.credential, 201);
      return result.status === "missing"
        ? c.json({ error: "Plan unavailable" }, 404)
        : c.json(
            { error: "Revoke an active token before creating another." },
            409,
          );
    })
    .delete("/:id/agent-tokens/:tokenId", async (c) => {
      const id = z.uuid().safeParse(c.req.param("tokenId"));
      if (!id.success) return c.json({ error: "Invalid token ID" }, 400);
      const revoked = await revokeAgentToken(
        c.get("identity")!.userId,
        c.req.param("id"),
        id.data,
      );
      return revoked
        ? c.body(null, 204)
        : c.json({ error: "Token unavailable" }, 404);
    });
}

const guard: MiddlewareHandler<Environment> = async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (!c.get("identity")) return c.json({ error: "Sign in required" }, 401);
  if (!z.uuid().safeParse(c.req.param("id")).success)
    return c.json({ error: "Invalid plan ID" }, 400);
  const origin = c.req.header("Origin");
  if (c.req.method !== "GET" && origin && origin !== new URL(c.req.url).origin)
    return c.json({ error: "Invalid origin" }, 403);
  await next();
};
