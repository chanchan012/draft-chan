import { handle } from "hono/vercel";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { createApi, type IdentityMiddleware } from "@/lib/server/api";
import { configuredLimiter } from "@/lib/server/rate-limit";
import { clerkEnabled } from "@/lib/server/auth";
const authenticate: IdentityMiddleware = async (c, next) => {
  if (!clerkEnabled()) return next();
  const verify = clerkMiddleware({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
  return verify(c, async () => {
    const auth = getAuth(c);
    if (auth?.userId) {
      c.set("identity", { mode: "member", userId: auth.userId });
      if (typeof auth.sessionClaims?.exp === "number")
        c.set("identityExpiresAt", auth.sessionClaims.exp * 1000);
    }
    await next();
  });
};
const api = createApi(authenticate, configuredLimiter(), {
  presenceLimit: configuredLimiter("presence", 300),
});
export const maxDuration = 60;
export type AppType = typeof api;
export const GET = handle(api);
export const POST = handle(api);
export const PUT = handle(api);
export const PATCH = handle(api);
export const DELETE = handle(api);
