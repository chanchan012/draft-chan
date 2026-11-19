import { handle } from "hono/vercel";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { createApi, type IdentityMiddleware } from "@/lib/server/api";
import { configuredLimiter } from "@/lib/server/rate-limit";
import { clerkEnabled } from "@/lib/server/auth";
const authenticate: IdentityMiddleware = async (c, next) => {
  if (!clerkEnabled()) {
    c.set("identity", { mode: "guest" });
    return next();
  }
  const verify = clerkMiddleware({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  return verify(c, async () => {
    const userId = getAuth(c)?.userId;
    c.set("identity", userId ? { mode: "member", userId } : { mode: "guest" });
    await next();
  });
};
const api = createApi(authenticate, configuredLimiter());
export type AppType = typeof api;
export const GET = handle(api);
export const POST = handle(api);
export const PATCH = handle(api);
export const DELETE = handle(api);
