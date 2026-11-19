import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApi, type IdentityMiddleware } from "../lib/server/api";
import {
  memoryLiveBus,
  planChannel,
  publishPlanPresence,
} from "../lib/server/live-bus";
import { liveStream } from "../lib/server/live-stream";
import { localWindow } from "../lib/server/rate-limit";
import { initialGraph } from "../lib/plans/plan-state";
import {
  studioSnapshot,
  applyStudioSnapshot,
} from "../lib/plans/studio-document";
import { rebaseSnapshot } from "../lib/plans/rebase";
import { createDraftPlanStore } from "../lib/plans/command-store";
import type { LiveFrame } from "../lib/plans/live";

const pg = new PGlite();
const db = drizzle(pg);
vi.mock("../db/client", () => ({ openDatabase: () => db }));
vi.mock("../lib/server/thumbnails", async (load) => ({
  ...(await load<typeof import("../lib/server/thumbnails")>()),
  queueThumbnail: vi.fn(async () => {}),
}));

beforeAll(() => migrate(db, { migrationsFolder: "./db/migrations" }), 30_000);
afterAll(() => pg.close());

const actor = { kind: "human", id: "owner-live" } as const;
const identity =
  (owner: string): IdentityMiddleware =>
  async (c, next) => {
    c.set("identity", { mode: "member", userId: owner });
    await next();
  };

function read(response: Response) {
  const reader = response.body!.getReader();
  const decode = new TextDecoder();
  return {
    async next() {
      const data = await reader.read();
      if (data.done) return null;
      return JSON.parse(
        decode.decode(data.value).trim().slice("data: ".length),
      ) as LiveFrame;
    },
    close: () => reader.cancel(),
  };
}

describe("owner-scoped live sync", () => {
  it("sends published revisions and Human and AI cursors to both clients, then closes on delete", async () => {
    const bus = memoryLiveBus();
    const app = createApi(identity(actor.id), localWindow(), { bus });
    const other = createApi(identity("stranger"), localWindow(), { bus });
    const anonymous = createApi(async (_c, next) => next(), localWindow(), {
      bus,
    });
    const id = crypto.randomUUID();
    const base = "/api/floorplans";
    const plan = base + "/" + id;
    const json = (method: string, body: unknown) => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(
      (await app.request(base, json("POST", { id, name: "Plan live" }))).status,
    ).toBe(201);
    expect((await other.request(plan + "/live")).status).toBe(404);
    expect((await anonymous.request(plan + "/live")).status).toBe(401);
    const post = { clientId: crypto.randomUUID(), cursor: { x: 310, y: 370 } };
    expect(
      (await other.request(plan + "/presence", json("POST", post))).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          plan + "/presence",
          json("POST", { ...post, kind: "ai" }),
        )
      ).status,
    ).toBe(400);

    const response = await app.request(plan + "/live");
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const a = read(response);
    const b = read(await app.request(base + "/" + id.toUpperCase() + "/live"));
    try {
      expect(await a.next()).toEqual({
        type: "snapshot",
        revision: 0,
        peers: [],
      });
      expect(await b.next()).toEqual({
        type: "snapshot",
        revision: 0,
        peers: [],
      });
      expect(
        (await app.request(plan + "/presence", json("POST", post))).status,
      ).toBe(204);
      expect(await a.next()).toMatchObject({
        type: "presence",
        peer: { id: post.clientId, kind: "human", cursor: post.cursor },
      });
      expect(await b.next()).toMatchObject({
        type: "presence",
        peer: { id: post.clientId, kind: "human" },
      });
      await publishPlanPresence(
        actor.id,
        id,
        { kind: "ai", id: "test-agent" },
        post,
        bus,
      );
      expect(await b.next()).toMatchObject({
        type: "presence",
        peer: { kind: "ai", cursor: post.cursor },
      });
      expect(await a.next()).toMatchObject({
        type: "presence",
        peer: { kind: "ai" },
      });

      const graph = studioSnapshot(
        initialGraph({ width: 5000, depth: 4000 }),
        "mm",
      );
      expect(
        (
          await app.request(
            plan + "/graph",
            json("PATCH", { revision: 0, ...graph }),
          )
        ).status,
      ).toBe(200);
      expect(await a.next()).toEqual({ type: "revision", revision: 1 });
      expect(await b.next()).toEqual({ type: "revision", revision: 1 });
      expect(
        (
          await app.request(
            plan + "/graph",
            json("PATCH", { revision: 0, ...graph }),
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await app.request(
            plan,
            json("PATCH", { revision: 1, name: "Renamed" }),
          )
        ).status,
      ).toBe(200);
      expect(await a.next()).toEqual({ type: "revision", revision: 2 });
      expect(await b.next()).toEqual({ type: "revision", revision: 2 });
      const reconnect = read(await app.request(plan + "/live"));
      expect(await reconnect.next()).toMatchObject({
        type: "snapshot",
        revision: 2,
        peers: expect.arrayContaining([
          expect.objectContaining({ id: post.clientId }),
        ]),
      });
      await reconnect.close();
      expect(
        (await app.request(plan, json("DELETE", { revision: 2 }))).status,
      ).toBe(204);
      expect(await a.next()).toEqual({ type: "deleted" });
      expect(await b.next()).toEqual({ type: "deleted" });
      expect(await a.next()).toBeNull();
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("expires leases, repairs missed revisions and closes an expiring request", async () => {
    let now = 100;
    const key = planChannel(actor.id, "plan");
    const bus = memoryLiveBus(() => now);
    await bus.update(key, {
      id: "tab",
      kind: "human",
      cursor: null,
      expiresAt: 101,
    });
    expect(await bus.presence(key)).toHaveLength(1);
    now = 102;
    expect(await bus.presence(key)).toEqual([]);
    let revision: number | null = 3;
    const a = read(
      liveStream({
        key,
        bus,
        revision: 0,
        currentRevision: async () => revision,
        signal: new AbortController().signal,
        heartbeat: 5,
      }),
    );
    try {
      expect(await a.next()).toMatchObject({ type: "snapshot", revision: 0 });
      expect(await a.next()).toMatchObject({ type: "snapshot", revision: 3 });
      revision = null;
      expect(await a.next()).toEqual({ type: "deleted" });
    } finally {
      await a.close();
    }

    const expired = read(
      liveStream({
        key,
        bus,
        revision: 0,
        currentRevision: async () => 0,
        signal: new AbortController().signal,
        expiresAt: Date.now() + 25,
      }),
    );
    try {
      expect(await expired.next()).toMatchObject({
        type: "snapshot",
        revision: 0,
      });
      expect(await expired.next()).toEqual({ type: "auth" });
      expect(await expired.next()).toBeNull();
    } finally {
      await expired.close();
    }
  });

  it("accounts for cursor requests in their own rate-limit bucket", async () => {
    const app = createApi(async (_c, next) => next(), localWindow(1), {
      presenceLimit: localWindow(1),
    });
    const route = "/api/floorplans/" + crypto.randomUUID() + "/presence";
    expect((await app.request(route, { method: "POST" })).status).toBe(401);
    const throttled = await app.request(route, { method: "POST" });
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await app.request("/api/account")).status).toBe(401);
  });
});

describe("rebasing open drafts", () => {
  it("combines edits to different objects and undo keeps the remote changes", () => {
    const initial = initialGraph({ width: 5000, depth: 4000 });
    const base = studioSnapshot(initial, "mm");
    const draft = {
      ...base,
      walls: base.walls.map((wall, i) =>
        i === 0 ? { ...wall, thicknessMm: 150 } : wall,
      ),
    };
    const saved = {
      ...base,
      unit: "in" as const,
      walls: base.walls.map((wall, i) =>
        i === 1 ? { ...wall, thicknessMm: 240 } : wall,
      ),
    };
    const merged = rebaseSnapshot(base, draft, saved);
    expect(merged.unit).toBe("in");
    expect(
      merged.walls.slice(0, 2).map(({ thicknessMm }) => thicknessMm),
    ).toEqual([150, 240]);
    const store = createDraftPlanStore(initial);
    const remote = applyStudioSnapshot(
      initial,
      { ...saved, revision: 1 },
      { kind: "ai", id: "design-agent" },
    );
    store
      .getState()
      .adoptRemote(
        remote,
        actor,
        applyStudioSnapshot(remote, { ...merged, revision: 1 }, actor),
      );
    expect(store.getState().plan.walls[0].updatedBy).toEqual(actor);
    expect(store.getState().plan.walls[1].updatedBy).toEqual({
      kind: "ai",
      id: "design-agent",
    });
    expect(store.getState().undo()).toBe(true);
    expect(store.getState().plan).toEqual(remote);
    expect(store.getState().redo()).toBe(true);
    expect(store.getState().plan.walls[0].thicknessMm).toBe(150);
  });

  it("stops for overlapping updates and lets geometry validation catch cross-element conflicts", () => {
    const initial = initialGraph({ width: 5000, depth: 4000 });
    const base = studioSnapshot(initial, "mm");
    const edited = (thicknessMm: number) => ({
      ...base,
      walls: base.walls.map((wall, i) =>
        i === 0 ? { ...wall, thicknessMm } : wall,
      ),
    });
    expect(() => rebaseSnapshot(base, edited(150), edited(190))).toThrow(
      /same element/,
    );
    const door = {
      id: "new-door",
      wallId: base.walls[0].id,
      widthMm: 900,
      offsetMm: 2500,
      hinge: "start",
      swing: "left",
    } as const;
    const removed = { ...base, walls: base.walls.slice(1) };
    const merged = rebaseSnapshot(base, { ...base, openings: [door] }, removed);
    expect(() =>
      applyStudioSnapshot(initial, { ...merged, revision: 1 }, actor),
    ).toThrow(/existing wall/);
  });
});
