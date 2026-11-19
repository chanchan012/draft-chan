import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { floorplans } from "../db/schema";
import { loadDraftPlan } from "../lib/plans/plan-state";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApi } from "../lib/server/api";
import { localWindow } from "../lib/server/rate-limit";
import { areaM2, initialGraph, thumbnailSvg } from "../lib/plans/geometry";
import { queueThumbnail, renderThumbnail } from "../lib/server/thumbnails";

const pg = new PGlite();
const db = drizzle(pg);
vi.mock("../db/client", () => ({ openDatabase: () => db }));
vi.mock("../lib/server/thumbnails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/server/thumbnails")>()),
  queueThumbnail: vi.fn(async () => ({ ids: ["event"] })),
}));
beforeAll(() => migrate(db, { migrationsFolder: "./db/migrations" }), 30000);
afterAll(() => pg.close());
function client(owner?: string) {
  const app = createApi(async (c, next) => {
    if (owner) c.set("identity", { mode: "member", userId: owner });
    await next();
  }, localWindow());
  return (method: string, id = "", body?: unknown) =>
    app.request("/api/floorplans" + (id ? "/" + id : ""), {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}
describe("floorplan persistence", () => {
  it("loads and saves studio geometry under the owner and current revision", async () => {
    const a = client("studio-owner");
    const b = client("other-user");
    const id = crypto.randomUUID();
    const route = id + "/graph";
    await a("POST", "", { id, name: "Studio" });
    expect((await b("GET", route)).status).toBe(404);
    expect((await client()("GET", route)).status).toBe(401);
    expect((await a("GET", "bad/graph")).status).toBe(400);
    expect(await (await a("GET", route)).json()).toMatchObject({ revision: 0, unit: "mm", name: "Studio" });
    await renderThumbnail(id);
    const payload = {
      revision: 0,
      unit: "in",
      walls: [{
        id: "wall", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 },
        thicknessMm: 120, kind: "interior",
      }],
      openings: [{ id: "door", wallId: "wall", offsetMm: 2000, widthMm: 900, hinge: "start", swing: "left" }],
      fixtures: [{ id: "toilet", template: "toilet", widthMm: 405, depthMm: 700, heightMm: 740, rotation: 90, position: { x: 1200, y: 800 } }],
      utilities: [{ id: "drain", template: "drain", position: { x: 1200, y: 800 } }],
    };
    expect((await b("PATCH", route, payload)).status).toBe(409);
    expect((await a("PATCH", route, { ...payload, openings: [{ ...payload.openings[0], wallId: "missing" }] })).status).toBe(400);
    expect((await a("PATCH", route, { ...payload, walls: [{ ...payload.walls[0], createdBy: { kind: "ai", id: "forged" } }] })).status).toBe(400);
    const results = await Promise.all([a("PATCH", route, payload), a("PATCH", route, payload)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = await (await a("GET", route)).json();
    expect(saved).toMatchObject({
      revision: 1, unit: "in", graph: {
        walls: [{ createdBy: { kind: "human", id: "studio-owner" } }],
        openings: [{ id: "door", widthMm: 900, updatedBy: { kind: "human", id: "studio-owner" } }],
        fixtures: [{ id: "toilet", rotation: 90, createdBy: { kind: "human", id: "studio-owner" } }],
        utilities: [{ id: "drain", template: "drain", updatedBy: { kind: "human", id: "studio-owner" } }],
      },
    });
    expect(await (await a("GET", id)).json()).toMatchObject({ thumbnail: null });
    await renderThumbnail(id);
    expect((await (await a("GET", id)).json()).thumbnail).toContain('stroke="#4b5145"');
  });

  it("scopes CRUD and rejects stale updates and deletes", async () => {
    const a = client("member-a"),
      b = client("member-b"),
      id = crypto.randomUUID();
    const input = { id, name: "Study", room: { width: 5000, depth: 4000 } };
    expect((await a("POST", "", input)).status).toBe(201);
    expect((await a("POST", "", input)).status).toBe(201);
    const [stored] = await db.select({ graph: floorplans.graph })
      .from(floorplans)
      .where(eq(floorplans.id, id));
    const plan = loadDraftPlan(stored.graph);
    expect(plan.walls).toHaveLength(4);
    expect(plan.walls[0].createdBy).toEqual({ kind: "human", id: "member-a" });
    expect(areaM2(plan)).toBe(20);
    expect(await (await a("GET")).json()).toHaveLength(1);
    expect(await (await a("GET", id)).json()).toMatchObject({
      id,
      areaM2: 20,
      revision: 0,
    });
    expect(await (await b("GET")).json()).toEqual([]);
    expect((await b("GET", id)).status).toBe(404);
    expect((await b("PATCH", id, { name: "Wrong", revision: 0 })).status).toBe(
      409,
    );
    expect((await b("DELETE", id, { revision: 0 })).status).toBe(409);
    expect((await b("POST", "", input)).status).toBe(409);
    expect(
      await (await a("PATCH", id, { name: "Living room", revision: 0 })).json(),
    ).toMatchObject({ name: "Living room", revision: 1 });
    expect(
      (await a("PATCH", id, { name: "Outdated", revision: 0 })).status,
    ).toBe(409);
    expect((await a("DELETE", id, { revision: 0 })).status).toBe(409);
    expect((await a("DELETE", id, { revision: 1 })).status).toBe(204);
    expect((await a("GET", id)).status).toBe(404);
  });
  it("validates inputs and requires authentication for every operation", async () => {
    const unsigned = client(),
      member = client("member"),
      id = crypto.randomUUID();
    for (const method of ["GET", "POST", "PATCH", "DELETE"])
      expect(
        (await unsigned(method, ["PATCH", "DELETE"].includes(method) ? id : ""))
          .status,
      ).toBe(401);
    expect((await member("POST", "", { id, name: " " })).status).toBe(400);
    expect(
      (await member("POST", "", { id, name: "New", ownerId: "other" })).status,
    ).toBe(400);
    expect((await member("GET", "bad-id")).status).toBe(400);
  });
  it("keeps a recoverable pending plan when event delivery fails", async () => {
    const api = client("retry-test"),
      id = crypto.randomUUID();
    vi.mocked(queueThumbnail).mockRejectedValueOnce(
      new Error("Event delivery interrupted"),
    );
    const response = await api("POST", "", { id, name: "Pending" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id, thumbnail: null });
    expect(await renderThumbnail(id)).toEqual({ written: true });
    expect((await (await api("GET", id)).json()).thumbnail).toContain("<svg");
    await api("DELETE", id, { revision: 0 });
  });
  it("persists a bounded SVG and makes duplicate or late thumbnail events harmless", async () => {
    const api = client("worker-test"),
      id = crypto.randomUUID();
    await api("POST", "", {
      id,
      name: "Rectangle",
      room: { width: 1000, depth: 2000 },
    });
    expect(await renderThumbnail(id)).toEqual({ written: true });
    expect(await renderThumbnail(id)).toEqual({ written: false });
    expect((await (await api("GET", id)).json()).thumbnail).toContain(
      "<polygon",
    );
    await api("DELETE", id, { revision: 0 });
    expect(await renderThumbnail(id)).toEqual({ written: false });
  });
  it("handles empty and legacy graphs, polygon winding and imperial conversion", () => {
    expect(areaM2({ rooms: [{}] })).toBe(0);
    expect(thumbnailSvg(initialGraph())).toContain("<path");
    const graph = initialGraph({ width: 3048, depth: 3048 });
    graph.rooms[0].polygon.reverse();
    expect(areaM2(graph) / 0.09290304).toBeCloseTo(100);
  });
});
