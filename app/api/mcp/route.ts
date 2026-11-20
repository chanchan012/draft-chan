import { handle } from "hono/vercel";
import { createMcpHttp } from "@/lib/server/mcp-http";
import { configuredLimiter } from "@/lib/server/rate-limit";

const handler = handle(createMcpHttp(configuredLimiter("mcp", 120)));
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
