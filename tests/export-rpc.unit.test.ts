import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { floorplanExports } from "../db/schema";
import { createApi } from "../lib/server/api";
import { localWindow } from "../lib/server/rate-limit";
import { queueBlueprint } from "../lib/server/blueprint-jobs";
import {
  failBlueprint,
  renderQueuedBlueprint,
  unconfirmedBlueprints,
} from "../lib/server/blueprint-store";

const pg = new PGlite();
const db = drizzle(pg);
vi.mock("../db/client", () => ({ openDatabase: () => db }));
vi.mock("../lib/server/thumbnails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/server/thumbnails")>()),
  queueThumbnail: vi.fn(async () => ({ ids: ["thumbnail"] })),
}));
vi.mock("../lib/server/blueprint-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/server/blueprint-jobs")>()),
  queueBlueprint: vi.fn(async () => ({ ids: ["blueprint"] })),
}));

beforeAll(() => migrate(db, { migrationsFolder: "./db/migrations" }), 30_000);
afterAll(() => pg.close());

function client(owner?: string) {
  const app = createApi(async (c, next) => {
    if (owner) c.set("identity", { mode: "member", userId: owner });
    await next();
  }, localWindow());
  return (method: string, path = "", body?: unknown, origin?: string) =>
    app.request("/api/floorplans" + (path ? "/" + path : ""), {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe("revision-bound exports", () => {
  it("deduplicates simultaneous requests and renders the accepted snapshot after the plan changes", async () => {
    const api = client("export-owner");
    const id = crypto.randomUUID();
    const path = id + "/exports";
    const input = { format: "svg", revision: 0 };
    await api("POST", "", {
      id,
      name: "Living & Dining",
      room: { width: 5000, depth: 4000 },
    });
    expect(await (await api("GET", path + "?revision=0")).json()).toEqual([]);
    const results = await Promise.all([
      api("POST", path, input),
      api("POST", path, input),
    ]);
    expect(results.map((response) => response.status)).toEqual([202, 202]);
    const [first, second] = await Promise.all(
      results.map((response) => response.json()),
    );
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      format: "svg",
      revision: 0,
      status: "pending",
    });
    const attempt = { id: first.id, attempt: 1 };
    expect(
      vi
        .mocked(queueBlueprint)
        .mock.calls.filter(([call]) => call.id === first.id),
    ).toEqual([[attempt]]);
    const download = path + "/" + first.id + "/download";
    expect((await api("GET", download)).status).toBe(409);

    await api("PATCH", id, { revision: 0, name: "Renamed plan" });
    expect((await api("POST", path, input)).status).toBe(409);
    expect((await api("GET", id + "/bom?revision=0")).status).toBe(409);
    const writes = await Promise.all([
      renderQueuedBlueprint(attempt),
      renderQueuedBlueprint(attempt),
    ]);
    expect(writes.filter(({ written }) => written)).toHaveLength(1);
    const attachment = await api("GET", download);
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get("Content-Disposition")).toBe(
      'attachment; filename="living-dining-r0.svg"',
    );
    expect(attachment.headers.get("Content-Security-Policy")).toContain(
      "sandbox",
    );
    expect(await attachment.text()).toContain(
      "<title>Living &amp; Dining · Revision 0</title>",
    );
    const [record] = await db
      .select()
      .from(floorplanExports)
      .where(eq(floorplanExports.id, first.id));
    expect(record.snapshot).toBeNull();

    const csv = await api("GET", id + "/bom?revision=1");
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(csv.headers.get("Content-Disposition")).toContain(
      "renamed-plan-r1-bom.csv",
    );
    expect(await csv.text()).toContain('"Wall","Interior wall","120","m",18');

    expect((await client("other-member")("GET", download)).status).toBe(404);
    expect((await client()("GET", download)).status).toBe(401);
    expect(
      (await client("other-member")("GET", path + "?revision=0")).status,
    ).toBe(404);
    expect(
      (await client("other-member")("POST", path, { ...input, revision: 1 }))
        .status,
    ).toBe(404);
    expect((await api("POST", path, input, "https://example.org")).status).toBe(
      403,
    );
    expect(
      (await api("POST", path, { revision: 1, format: "html" })).status,
    ).toBe(400);
    expect((await api("GET", id + "/bom?revision=")).status).toBe(400);
    expect((await api("GET", "invalid/exports?revision=0")).status).toBe(400);
    expect((await api("DELETE", id, { revision: 1 })).status).toBe(204);
    expect(
      await db
        .select()
        .from(floorplanExports)
        .where(eq(floorplanExports.id, first.id)),
    ).toEqual([]);
    expect(await renderQueuedBlueprint(attempt)).toEqual({ written: false });
  });

  it("recovers missed events and lets owners retry after the worker exhausts its attempts", async () => {
    const api = client("retry-owner");
    const id = crypto.randomUUID();
    await api("POST", "", { id, name: "Retry" });
    const target = id + "/exports";
    vi.mocked(queueBlueprint).mockRejectedValueOnce(
      new Error("Event delivery unavailable"),
    );
    const body = { format: "dxf", revision: 0 };
    const response = await api("POST", target, body);
    expect(response.status).toBe(202);
    const { id: exportId } = await response.json();
    const initial = { id: exportId, attempt: 1 };
    await db
      .update(floorplanExports)
      .set({ requestedAt: new Date(0) })
      .where(eq(floorplanExports.id, exportId));
    expect(await unconfirmedBlueprints()).toContainEqual(initial);
    await failBlueprint(initial);
    expect(await (await api("GET", target + "?revision=0")).json()).toEqual([
      { id: exportId, ...body, status: "failed" },
    ]);
    const retry = await api("POST", target, body);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toEqual({
      id: exportId,
      ...body,
      status: "pending",
    });
    const next = { id: exportId, attempt: 2 };
    expect(queueBlueprint).toHaveBeenLastCalledWith(next);
    await failBlueprint(initial);
    expect(await renderQueuedBlueprint(initial)).toEqual({ written: false });
    expect(await renderQueuedBlueprint(next)).toEqual({ written: true });
    await failBlueprint(next);
    const again = await api("POST", target, body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      id: exportId,
      ...body,
      status: "ready",
    });
    const file = await api("GET", target + "/" + exportId + "/download");
    expect(file.headers.get("Content-Type")).toBe("application/dxf");
    expect(await file.text()).toMatch(/\bEOF\s*$/);
  });
});
