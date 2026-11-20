import { Hono } from "hono";
import { z } from "zod";
import type { Environment } from "./api";
import { getMcpOAuthConfig } from "./mcp-oauth";
import {
  disableFloorplanOAuth,
  enableFloorplanOAuth,
  floorplanOAuthState,
} from "./oauth-grants";

export function oauthGrantRoutes() {
  const app = new Hono<Environment>();
  app.use("/:id/mcp-oauth", async (c, next) => {
    if (!z.uuid().safeParse(c.req.param("id")).success)
      return c.json({ error: "Invalid plan ID" }, 400);
    if (
      c.req.method !== "GET" &&
      c.req.header("Origin") !== new URL(c.req.url).origin
    )
      return c.json({ error: "Invalid origin" }, 403);
    await next();
  });
  return app
    .get("/:id/mcp-oauth", async (c) => {
      const config = getMcpOAuthConfig(c.req.url);
      if (!config) return c.json({ state: "unavailable" });
      const state = await floorplanOAuthState(
        c.get("identity")!.userId,
        c.req.param("id"),
      );
      return state
        ? c.json({ state })
        : c.json({ error: "Plan unavailable" }, 404);
    })
    .post("/:id/mcp-oauth", async (c) => {
      if (!getMcpOAuthConfig(c.req.url))
        return c.json(
          { error: "MCP OAuth is unavailable at this address." },
          404,
        );
      const state = await enableFloorplanOAuth(
        c.get("identity")!.userId,
        c.req.param("id"),
      );
      if (!state) return c.json({ error: "Plan unavailable" }, 404);
      if (state !== "enabled")
        return c.json(
          {
            error:
              "Disable OAuth access in the other floorplan before enabling it here.",
          },
          409,
        );
      return c.json({ state });
    })
    .delete("/:id/mcp-oauth", async (c) => {
      if (!getMcpOAuthConfig(c.req.url))
        return c.json(
          { error: "MCP OAuth is unavailable at this address." },
          404,
        );
      await disableFloorplanOAuth(c.get("identity")!.userId, c.req.param("id"));
      return c.body(null, 204);
    });
}
