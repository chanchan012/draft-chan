import { handle } from "hono/vercel";
import { createMcpHttp } from "@/lib/server/mcp-http";
import { clerkMcpOAuth } from "@/lib/server/mcp-oauth";
import { configuredLimiter } from "@/lib/server/rate-limit";

const handler = handle(
  createMcpHttp(
    configuredLimiter("mcp", 120),
    undefined,
    undefined,
    clerkMcpOAuth,
  ),
);
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
