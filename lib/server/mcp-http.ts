import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { authenticateAgent, type AgentScope } from "./agent-tokens";
import { createDraftMcp, type DraftMcpBackend } from "./draft-mcp";
import type { McpOAuth } from "./mcp-oauth";
import type { Limit } from "./rate-limit";

declare module "hono" {
  interface ContextVariableMap {
    draftAgent: AgentScope;
    parsedBody: unknown;
  }
}

export function createMcpHttp(
  limit: Limit,
  authenticate = authenticateAgent,
  backend?: DraftMcpBackend,
  oauth?: McpOAuth,
) {
  const api = new Hono();
  api.use("/api/mcp", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return c.json({ error: "Invalid origin" }, 403);

    try {
      const ip = process.env.VERCEL
        ? c.req.header("x-vercel-forwarded-for")?.split(",")[0]?.trim()
        : undefined;
      const rate = await limit(ip || "local");
      if (!rate.success) {
        c.header(
          "Retry-After",
          String(Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000))),
        );
        return c.json({ error: "Too many requests" }, 429);
      }
      const bearer = /^Bearer ([A-Za-z0-9._~+/=-]{1,8192})$/i.exec(
        c.req.header("Authorization") ?? "",
      )?.[1];
      const config = oauth?.config(c.req.url);
      let agent;
      if (bearer) {
        agent =
          config && oauth && !bearer.startsWith("draft_mcp_")
            ? await oauth.authorize(
                new Request(c.req.url, {
                  headers: { Authorization: `Bearer ${bearer}` },
                }),
                config,
              )
            : await authenticate(bearer);
      }
      if (agent === "plan_not_enabled")
        return c.json(
          {
            error:
              "Open a floorplan in Draft Studio and enable OAuth access in Connect an agent.",
          },
          403,
        );
      if (!agent) {
        const metadata = config
          ? `, resource_metadata="${config.metadata}"`
          : "";
        const invalid = config && bearer ? ', error="invalid_token"' : "";
        c.header(
          "WWW-Authenticate",
          `Bearer realm="Draft MCP"${metadata}${invalid}`,
        );
        return c.json(
          {
            error: config
              ? "Sign in with Clerk to connect to Draft."
              : "A valid floorplan agent token is required.",
          },
          401,
        );
      }
      c.set("draftAgent", agent);
    } catch {
      return c.json({ error: "Draft MCP is temporarily unavailable." }, 503);
    }
    await next();
  });

  const maxRequestBodySize = 64 * 1024;
  const adapter = createMcpHonoApp({ host: "draft", maxRequestBodySize });
  adapter.all("/api/mcp", (c) => {
    const scope = c.get("draftAgent");
    return createMcpHandler(() => createDraftMcp(scope, backend), {
      maxRequestBodySize,
      legacy: "stateless",
    }).fetch(c.req.raw, { parsedBody: c.get("parsedBody") });
  });
  return api.route("/", adapter);
}
