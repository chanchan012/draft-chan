import { describe, expect, it, vi } from "vitest";
import { createApi, type IdentityMiddleware } from "../lib/server/api";
import { localWindow } from "../lib/server/rate-limit";
import { clerkEnabled } from "../lib/server/auth";
const unsigned: IdentityMiddleware = async (_c, next) => next();
describe("Hono RPC", () => {
  it("rejects unsigned requests and ignores user-supplied identity headers", async () => {
    const app = createApi(unsigned, localWindow());
    const session = await app.request("/api/session", {
      headers: { "x-user-id": "impersonated" },
    });
    expect(session.status).toBe(401);
    expect(await session.json()).toEqual({ error: "Sign in required" });
    expect(session.headers.get("cache-control")).toContain("no-store");
    expect((await app.request("/api/account")).status).toBe(401);
  });
  it("accepts the member identity supplied by the auth adapter", async () => {
    const app = createApi(async (c, next) => {
      c.set("identity", { mode: "member", userId: "user_demo" });
      await next();
    }, localWindow());
    expect(await (await app.request("/api/account")).json()).toEqual({
      userId: "user_demo",
    });
  });
  it("requires a complete Clerk key pair", () => {
    try {
      vi.stubEnv("CLERK_SECRET_KEY", "");
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "test-public");
      expect(clerkEnabled()).toBe(false);
      vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
      expect(clerkEnabled()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("returns Retry-After when throttled", async () => {
    const app = createApi(unsigned, localWindow(1));
    await app.request("/api/session");
    const response = await app.request("/api/session");
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("fails closed when the configured limiter is unavailable", async () => {
    const app = createApi(unsigned, async () => {
      throw new Error("offline");
    });
    expect((await app.request("/api/session")).status).toBe(503);
  });
  it("expires previous hits and isolates buckets", async () => {
    let now = 0;
    const limit = localWindow(1, 1000, () => now);
    expect((await limit("a")).success).toBe(true);
    expect((await limit("a")).success).toBe(false);
    expect((await limit("b")).success).toBe(true);
    now = 1000;
    expect((await limit("a")).success).toBe(true);
  });
});
