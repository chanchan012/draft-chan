import { afterEach, describe, expect, it, vi } from "vitest";
import type { MiddlewareHandler } from "hono";
import { configuredLimiter } from "../lib/server/rate-limit";

const clerk = vi.hoisted(() => ({
  authenticate: vi.fn(
    (): MiddlewareHandler => async (_c, next) => {
      await next();
    },
  ),
  getAuth: vi.fn(),
}));
vi.mock("@hono/clerk-auth", () => ({
  clerkMiddleware: clerk.authenticate,
  getAuth: clerk.getAuth,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});
describe("production route wiring", () => {
  it("takes the verified user ID from Clerk and forwards the configured keys", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "test-publishable");
    vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
    clerk.getAuth.mockReturnValue({ userId: "verified-member" });
    const { GET } = await import("../app/api/[[...route]]/route");
    const response = await GET(new Request("https://draft.test/api/account"));
    expect(await response.json()).toEqual({ userId: "verified-member" });
    expect(clerk.authenticate).toHaveBeenCalledWith({
      publishableKey: "test-publishable",
      secretKey: "test-secret",
    });
  });
  it("treats an unsigned Clerk request as a guest", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "test-publishable");
    vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
    clerk.getAuth.mockReturnValue({ userId: null });
    const { GET } = await import("../app/api/[[...route]]/route");
    expect(
      (await GET(new Request("https://draft.test/api/account"))).status,
    ).toBe(401);
  });
  it("rejects a partially configured Redis connection", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    await expect(configuredLimiter()("guest")).rejects.toThrow(
      "Incomplete Redis configuration",
    );
  });
});
