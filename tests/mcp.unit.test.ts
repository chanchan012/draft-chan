import { createServer } from "node:http";
import { once } from "node:events";
import {
  Client,
  StreamableHTTPClientTransport,
  isCallToolResult,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { createApi, type IdentityMiddleware } from "../lib/server/api";
import { createMcpHttp } from "../lib/server/mcp-http";
import {
  clerkMcpOAuth,
  mcpProtectedResourceMetadata,
} from "../lib/server/mcp-oauth";
import { resolveFloorplanOAuth } from "../lib/server/oauth-grants";
import { localWindow } from "../lib/server/rate-limit";
import { authenticateAgent } from "../lib/server/agent-tokens";
import {
  renderQueuedBlueprint,
  getBlueprintFile,
} from "../lib/server/blueprint-store";
import {
  floorplanAgentTokens,
  floorplanExports,
  floorplanEditBatches,
  floorplanRevisions,
} from "../db/schema";
import { eq } from "drizzle-orm";
import type { StudioDocument } from "../lib/plans/studio-document";

const pg = new PGlite();
const db = drizzle(pg);
vi.mock("../db/client", () => ({ openDatabase: () => db }));
vi.mock("../lib/server/thumbnails", async (load) => ({
  ...(await load<typeof import("../lib/server/thumbnails")>()),
  queueThumbnail: vi.fn(async () => {}),
}));
vi.mock("../lib/server/blueprint-jobs", async (load) => ({
  ...(await load<typeof import("../lib/server/blueprint-jobs")>()),
  queueBlueprint: vi.fn(async () => {}),
}));
beforeAll(() => migrate(db, { migrationsFolder: "./db/migrations" }), 30_000);
afterAll(() => pg.close());

const owner = "mcp-owner";
function member(userId = owner) {
  const identity: IdentityMiddleware = async (c, next) => {
    c.set("identity", { mode: "member", userId });
    await next();
  };
  return createApi(identity, localWindow(120));
}
const payload = (method: string, data: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

async function planWithToken() {
  const api = member();
  const planId = crypto.randomUUID();
  const path = "/api/floorplans/" + planId;
  expect(
    (
      await api.request(
        "/api/floorplans",
        payload("POST", { id: planId, name: "Apartment" }),
      )
    ).status,
  ).toBe(201);
  const issued = await api.request(
    path + "/agent-tokens",
    payload("POST", { name: "Layout agent" }),
  );
  expect(issued.status).toBe(201);
  const credential = (await issued.json()) as { id: string; token: string };
  return { api, planId, path, ...credential };
}

async function connect(app: ReturnType<typeof createMcpHttp>, token: string) {
  const client = new Client({ name: "draft-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      fetch: (input, init) =>
        Promise.resolve(app.fetch(new Request(input, init))),
      requestInit: { headers: { Authorization: "Bearer " + token } },
    }),
  );
  return client;
}

it("issues scoped hashed credentials, rejects unauthorized calls and expires and revokes them", async () => {
  const session = await planWithToken();
  const { token, id, path, api } = session;
  const list = await api.request(path + "/agent-tokens");
  expect(await list.json()).toMatchObject([{ id, name: "Layout agent" }]);
  expect(
    await (await api.request(path + "/agent-tokens")).text(),
  ).not.toContain(token);
  const [stored] = await db
    .select()
    .from(floorplanAgentTokens)
    .where(eq(floorplanAgentTokens.id, id));
  expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored.tokenHash).not.toContain(token);
  expect(
    (await member("other-owner").request(path + "/agent-tokens")).status,
  ).toBe(404);
  expect(
    (
      await member("other-owner").request(path + "/agent-tokens/" + id, {
        method: "DELETE",
      })
    ).status,
  ).toBe(404);

  const app = createMcpHttp(localWindow());
  expect((await app.request("/api/mcp")).status).toBe(401);
  expect(
    (
      await app.request("/api/mcp", {
        headers: { Origin: "https://unrelated.example" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request("/api/mcp", {
        headers: { Authorization: "Bearer bad" },
      })
    ).status,
  ).toBe(401);
  expect(await authenticateAgent(token)).toEqual({
    planId: session.planId,
    owner,
    agentId: id,
  });

  const expired = await (
    await api.request(
      path + "/agent-tokens",
      payload("POST", { name: "Expired" }),
    )
  ).json();
  await db
    .update(floorplanAgentTokens)
    .set({ expiresAt: new Date(0) })
    .where(eq(floorplanAgentTokens.id, expired.id));
  expect(await authenticateAgent(expired.token)).toBeNull();
  expect(
    (await api.request(path + "/agent-tokens/" + id, { method: "DELETE" }))
      .status,
  ).toBe(204);
  expect(await authenticateAgent(token)).toBeNull();
  expect(
    (
      await app.request("/api/mcp", {
        headers: { Authorization: "Bearer " + token },
      })
    ).status,
  ).toBe(401);
});

it("validates Clerk OAuth tokens for Draft and enforces the signed-in owner's floorplan grant", async () => {
  const audience = "http://localhost/api/mcp";
  const metadata =
    "http://localhost/.well-known/oauth-protected-resource/api/mcp";
  const issuer = "https://draft-test.clerk.accounts.dev";
  vi.stubEnv("DRAFT_MCP_OAUTH_RESOURCE_URL", audience);
  vi.stubEnv(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "pk_test_" + Buffer.from(new URL(issuer).hostname + "$").toString("base64"),
  );
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_mock_clerk_secret");
  const oauthOwner = "user_test_draft_oauth";
  const fetchToken = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe(
        "/oauth_applications/access_tokens/verify",
      );
      const { access_token } = (await request.json()) as {
        access_token: string;
      };
      if (access_token === "oat_revoked")
        return Response.json(
          {
            errors: [
              { code: "oauth_token_not_found", message: "Token unavailable" },
            ],
          },
          { status: 404 },
        );
      const now = Math.floor(Date.now() / 1000);
      return Response.json({
        object: "clerk_idp_oauth_access_token",
        id: access_token,
        type: "access_token",
        client_id: "client_test_draft",
        subject: access_token === "oat_other_owner" ? "user_other" : oauthOwner,
        scopes: ["openid"],
        created_at: now,
        updated_at: now,
        expiration: now + 300,
        revoked: false,
        expired: false,
        revocation_reason: null,
        aud:
          access_token === "oat_wrong_audience"
            ? ["https://elsewhere.example/mcp"]
            : access_token === "oat_no_audience"
              ? undefined
              : [audience],
      });
    },
  );
  vi.stubGlobal("fetch", fetchToken);
  const app = createMcpHttp(
    localWindow(200),
    undefined,
    undefined,
    clerkMcpOAuth,
  );
  const call = (token: string) =>
    app.request("/api/mcp", { headers: { Authorization: "Bearer " + token } });
  try {
    const challenge = await app.request("/api/mcp");
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${metadata}"`,
    );
    expect(
      await mcpProtectedResourceMetadata(new Request(metadata)).json(),
    ).toMatchObject({ resource: audience, authorization_servers: [issuer] });
    expect(
      mcpProtectedResourceMetadata(
        new Request(metadata.replace("localhost", "not-draft.example")),
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request("https://not-draft.example/api/mcp", {
          headers: { Authorization: "Bearer oat_valid" },
        })
      ).status,
    ).toBe(401);
    expect(fetchToken).not.toHaveBeenCalled();
    for (const token of [
      "oat_no_audience",
      "oat_wrong_audience",
      "oat_revoked",
    ])
      expect((await call(token)).status).toBe(401);
    expect((await call("oat_valid")).status).toBe(403);

    const api = member(oauthOwner);
    const planId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    for (const id of [planId, otherId]) {
      const response = await api.request(
        "/api/floorplans",
        payload("POST", { id, name: "OAuth test" }),
      );
      expect(response.status).toBe(201);
    }
    const path = `/api/floorplans/${planId}/mcp-oauth`;
    const otherPath = `/api/floorplans/${otherId}/mcp-oauth`;
    const mutate = (
      method: "POST" | "DELETE",
      origin = "http://localhost",
    ) => ({ method, headers: { Origin: origin } });
    expect(await (await api.request(path)).json()).toEqual({
      state: "disabled",
    });
    expect(
      (await member("user_other").request(path, mutate("POST"))).status,
    ).toBe(404);
    expect(
      (await api.request(path, mutate("POST", "https://foreign.example")))
        .status,
    ).toBe(403);
    expect((await api.request(path, mutate("POST"))).status).toBe(200);
    expect(await (await api.request(otherPath)).json()).toEqual({
      state: "other_plan",
    });
    expect((await api.request(otherPath, mutate("POST"))).status).toBe(409);
    expect((await call("oat_other_owner")).status).toBe(403);
    expect(
      (await member("user_other").request(path, mutate("DELETE"))).status,
    ).toBe(204);
    expect((await api.request(otherPath, mutate("DELETE"))).status).toBe(204);

    const client = await connect(app, "oat_valid");
    try {
      const {
        contents: [graph],
      } = await client.readResource({ uri: "draft://floorplan-graph" });
      expect(graph).toMatchObject({ text: expect.stringContaining(planId) });
      const result = await client.callTool({
        name: "draw_wall",
        arguments: {
          expectedRevision: 0,
          start: { x: 0, y: 0 },
          end: { x: 1200, y: 0 },
          kind: "interior",
          thicknessMm: 120,
        },
      });
      expect(result).toMatchObject({
        isError: false,
        structuredContent: { revision: 1 },
      });
      const firstAgent = await resolveFloorplanOAuth(
        oauthOwner,
        "client_test_draft",
      );
      expect(firstAgent?.planId).toBe(planId);
      expect(
        (await resolveFloorplanOAuth(oauthOwner, "client_other"))?.agentId,
      ).not.toBe(firstAgent?.agentId);
      const {
        contents: [edited],
      } = await client.readResource({ uri: "draft://floorplan-graph" });
      expect(edited).toMatchObject({
        text: expect.stringContaining(firstAgent!.agentId),
      });
    } finally {
      await client.close();
    }
    expect((await api.request(path, mutate("DELETE"))).status).toBe(204);
    expect((await call("oat_valid")).status).toBe(403);
    expect(
      await resolveFloorplanOAuth(oauthOwner, "client_test_draft"),
    ).toBeNull();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}, 30_000);

it("lays out a two-bedroom plan using all MCP resources and tools over HTTP", async () => {
  const session = await planWithToken();
  const client = await connect(createMcpHttp(localWindow(200)), session.token);
  const live = await session.api.request(session.path + "/live");
  const stream = live.body!.getReader();
  const read = async () =>
    JSON.parse(
      new TextDecoder()
        .decode((await stream.read()).value)
        .trim()
        .slice(6),
    );
  try {
    expect(
      (await client.listTools()).tools.map(({ name }) => name).sort(),
    ).toEqual([
      "add_constraint",
      "add_dimension_annotation",
      "apply_changes",
      "array_entities",
      "calculate_bom",
      "check_clearance_codes",
      "create_storey",
      "define_block",
      "diff_revisions",
      "draw_arc",
      "draw_circle",
      "draw_construction_line",
      "draw_polyline",
      "draw_wall",
      "edit_block_definition",
      "edit_corner",
      "explain_constraints",
      "furnish_room_preset",
      "insert_block",
      "inspect_entity",
      "manage_layer",
      "measure_geometry",
      "offset_geometry",
      "place_fixture",
      "place_opening",
      "preview_changes",
      "query_entities",
      "query_spaces",
      "remove_constraint",
      "resolve_snap",
      "set_driving_dimension",
      "set_wall_type",
      "split_or_join_wall",
      "transform_entities",
      "trigger_dxf_export",
      "trim_extend",
      "update_storey",
    ]);
    expect(
      (await client.listResources()).resources.map(({ name }) => name).sort(),
    ).toEqual(["catalog", "floorplan-graph", "spatial-audit"]);
    async function resource(name: string) {
      const response = await client.readResource({ uri: "draft://" + name });
      const [item] = response.contents;
      if (!("text" in item)) throw new Error("Expected JSON resource");
      return JSON.parse(item.text);
    }
    expect(await resource("catalog")).toMatchObject({
      roomPresets: { bedroom: ["queenBed", "wardrobe"] },
    });
    const start = (await resource("floorplan-graph")) as StudioDocument;
    expect(start).toMatchObject({ id: session.planId, revision: 0 });
    let revision = start.revision;

    async function call(name: string, args: Record<string, unknown> = {}) {
      const response = await client.callTool({ name, arguments: args });
      if (!isCallToolResult(response))
        throw new Error("Expected a tool result");
      expect(
        response.isError,
        JSON.stringify(response.structuredContent),
      ).not.toBe(true);
      const content = response.structuredContent as Record<string, unknown>;
      if (typeof content.revision === "number") revision = content.revision;
      return content;
    }
    expect(await read()).toMatchObject({ type: "snapshot", revision: 0 });

    const draw = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      kind = "interior",
    ) =>
      call("draw_wall", {
        expectedRevision: revision,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thicknessMm: 120,
        kind,
      });
    const north = await draw(0, 0, 10000, 0, "exterior");
    const events = [await read(), await read()];
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "revision", revision: 1 },
        expect.objectContaining({
          type: "presence",
          peer: expect.objectContaining({ kind: "ai" }),
        }),
      ]),
    );
    // The test above verifies fan-out. Release this stream before publishing the remaining edits.
    await stream.cancel();

    await draw(10000, 0, 10000, 7000, "exterior");
    await draw(10000, 7000, 0, 7000, "exterior");
    await draw(0, 7000, 0, 0, "exterior");
    const partition = await draw(0, 3500, 10000, 3500);
    await draw(5000, 0, 5000, 3500);
    expect(
      await call("query_entities", {
        kind: "wall",
        bounds: { left: 4000, right: 6000, top: -50, bottom: 50 },
        limit: 1,
      }),
    ).toMatchObject({ total: 2, nextOffset: 1, revision });
    expect(
      await call("inspect_entity", { kind: "wall", id: north.wallId }),
    ).toMatchObject({ entity: { thicknessMm: 120 } });
    expect(
      await call("resolve_snap", {
        point: { x: 5000, y: 10 },
        radiusMm: 20,
        modes: ["midpoint"],
      }),
    ).toMatchObject({
      snap: {
        point: { x: 5000, y: 0 },
        references: [{ wallId: north.wallId, edge: "center" }],
      },
    });
    expect(
      await call("measure_geometry", {
        mode: "wall_edges",
        from: { wallId: north.wallId, edge: "positive" },
        to: { wallId: partition.wallId, edge: "negative" },
      }),
    ).toMatchObject({ distanceMm: 3380 });
    const center = { x: 300, y: 300 };
    await call("draw_circle", {
      expectedRevision: revision,
      center,
      radiusMm: 100,
    });
    await call("draw_arc", {
      expectedRevision: revision,
      center,
      radiusMm: 100,
      startDeg: 270,
      sweepDeg: 140,
    });
    await call("draw_construction_line", {
      expectedRevision: revision,
      start: center,
      end: { x: 500, y: 500 },
    });
    await call("draw_polyline", {
      expectedRevision: revision,
      closed: true,
      points: [center, { x: 500, y: 500 }, { x: 600, y: 300 }],
    });
    expect(
      await call("query_entities", { kind: "sketch", layer: "construction" }),
    ).toMatchObject({ total: 1, entities: [{ layer: "construction" }] });
    const door = await call("place_opening", {
      expectedRevision: revision,
      kind: "door",
      wallId: partition.wallId,
      offsetMm: 2500,
      widthMm: 915,
      hinge: "start",
      swing: "right",
    });
    await call("place_opening", {
      expectedRevision: revision,
      kind: "door",
      wallId: partition.wallId,
      offsetMm: 7500,
      widthMm: 915,
      hinge: "end",
      swing: "right",
    });
    await call("place_opening", {
      expectedRevision: revision,
      kind: "window",
      wallId: north.wallId,
      offsetMm: 7200,
      widthMm: 1200,
      heightMm: 950,
      sillMm: 800,
    });
    const split = await call("split_or_join_wall", {
      expectedRevision: revision,
      operation: "split",
      wallId: north.wallId,
      point: { x: 5000, y: 0 },
    });
    expect((await resource("floorplan-graph")).graph.windows[0]).toMatchObject({
      wallId: split.newWallId,
      offsetMm: 2200,
    });
    await call("split_or_join_wall", {
      expectedRevision: revision,
      operation: "join",
      wallId: north.wallId,
      otherWallId: split.newWallId,
    });

    const audit = await resource("spatial-audit");
    expect(audit.rooms).toHaveLength(3);
    expect(audit.adjacency).toContainEqual(
      expect.objectContaining({
        doorwayId: door.openingId,
        first: expect.any(String),
        second: expect.any(String),
      }),
    );
    const bedrooms = audit.rooms.filter(
      (room: { areaM2: number }) => room.areaM2 === 17.5,
    );
    expect(bedrooms).toHaveLength(2);
    for (const room of bedrooms)
      await call("furnish_room_preset", {
        expectedRevision: revision,
        roomId: room.id,
        preset: "bedroom",
      });
    await call("place_fixture", {
      expectedRevision: revision,
      kind: "furniture",
      template: "sofa",
      position: { x: 4000, y: 5800 },
    });
    await call("add_dimension_annotation", {
      expectedRevision: revision,
      start: { x: 0, y: 7500 },
      end: { x: 10000, y: 7500 },
    });
    const stale = await client.callTool({
      name: "draw_wall",
      arguments: {
        expectedRevision: 0,
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        thicknessMm: 120,
        kind: "interior",
      },
    });
    expect(stale).toMatchObject({
      isError: true,
      structuredContent: { code: "revision_conflict" },
    });
    expect(await call("check_clearance_codes")).toHaveProperty("issues");
    expect((await call("calculate_bom")).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "Window", quantity: 1 }),
      ]),
    );
    const graph = await resource("floorplan-graph");
    expect(graph.graph.fixtures).toHaveLength(5);
    expect(graph.graph.windows).toMatchObject([
      { offsetMm: 7200, updatedBy: { kind: "ai", id: session.id } },
    ]);
    expect(graph.graph.annotations).toHaveLength(1);
    expect(
      graph.graph.walls.every(
        (item: { createdBy: { kind: string } }) => item.createdBy.kind === "ai",
      ),
    ).toBe(true);

    const queued = await call("trigger_dxf_export", {
      expectedRevision: revision,
    });
    const job = queued.export as { id: string; status: string };
    const [row] = await db
      .select()
      .from(floorplanExports)
      .where(eq(floorplanExports.id, job.id));
    await renderQueuedBlueprint({ id: job.id, attempt: row.attempt });
    const file = await getBlueprintFile(owner, session.planId, job.id);
    expect(file?.artifact).toContain("WINDOWS");
    expect(file?.artifact).toContain("DIMENSIONS");
  } finally {
    await stream.cancel().catch(() => {});
    await client.close();
  }
}, 30_000);

it("previews corridor geometry, commits a concurrent retry once, and compares saved revisions", async () => {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_draft_preview_test");
  const session = await planWithToken();
  const other = await planWithToken();
  const app = createMcpHttp(localWindow(120));
  const client = await connect(app, session.token);
  const retryClient = await connect(app, session.token);
  const otherClient = await connect(app, other.token);
  async function call(
    name: string,
    args: Record<string, unknown>,
    clientInstance = client,
  ) {
    const result = await clientInstance.callTool({ name, arguments: args });
    if (!isCallToolResult(result)) throw new Error("Expected MCP call result");
    return result;
  }
  const wall = { kind: "wall", id: "hall" };
  const operations = [
    { operation: "offset", entity: wall, distanceMm: 300, copy: false },
    {
      operation: "transform",
      entities: [wall],
      transform: { mode: "move", delta: { x: 100, y: 0 } },
    },
  ];
  try {
    const base = await session.api.request(
      session.path + "/graph",
      payload("PATCH", {
        revision: 0,
        unit: "mm",
        walls: [
          {
            id: "hall",
            start: { x: 0, y: 0 },
            end: { x: 4000, y: 0 },
            kind: "interior",
            thicknessMm: 120,
          },
          {
            id: "boundary",
            start: { x: 1100, y: -100 },
            end: { x: 1100, y: 1000 },
            kind: "interior",
            thicknessMm: 120,
          },
        ],
        openings: [
          {
            id: "entry",
            wallId: "hall",
            offsetMm: 1000,
            widthMm: 900,
            swing: "right",
            hinge: "start",
          },
        ],
      }),
    );
    expect(base.status).toBe(200);
    const invalid = await call("preview_changes", {
      expectedRevision: 1,
      operations: [
        operations[0],
        {
          operation: "trim_extend",
          entity: wall,
          boundary: { kind: "wall", id: "boundary" },
          mode: "trim",
          endpoint: "start",
        },
      ],
    });
    expect(invalid).toMatchObject({
      isError: true,
      structuredContent: {
        code: "invalid_geometry",
        message: expect.stringContaining("opening entry"),
      },
    });
    const preview = await call("preview_changes", {
      expectedRevision: 1,
      operations,
    });
    expect(preview).toMatchObject({
      isError: false,
      structuredContent: {
        revision: 1,
        affectedOpenings: [{ id: "entry", wallId: "hall" }],
        changes: [
          {
            kind: "wall",
            id: "hall",
            before: { start: { x: 0, y: 0 } },
            after: { start: { x: 100, y: 300 } },
          },
        ],
      },
    });
    expect(
      (
        await db
          .select()
          .from(floorplanEditBatches)
          .where(eq(floorplanEditBatches.floorplanId, session.planId))
      ).length,
    ).toBe(0);
    const args = {
      previewToken: (preview.structuredContent as { previewToken: string })
        .previewToken,
      operations,
    };
    expect(await call("apply_changes", args, otherClient)).toMatchObject({
      isError: true,
      structuredContent: { code: "invalid_preview" },
    });
    expect(
      await call("apply_changes", {
        ...args,
        operations: operations.slice(0, 1),
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { code: "invalid_preview" },
    });
    const alternate = await call("preview_changes", {
      expectedRevision: 1,
      operations,
    });
    const [first, duplicate] = await Promise.all([
      call("apply_changes", args),
      call("apply_changes", args, retryClient),
    ]);
    expect(first).toMatchObject({
      isError: false,
      structuredContent: { revision: 2, baseRevision: 1 },
    });
    expect(duplicate.structuredContent).toEqual(first.structuredContent);
    expect(
      await call("apply_changes", {
        ...args,
        previewToken: (alternate.structuredContent as { previewToken: string })
          .previewToken,
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { code: "revision_conflict" },
    });
    expect(
      (
        await db
          .select()
          .from(floorplanEditBatches)
          .where(eq(floorplanEditBatches.floorplanId, session.planId))
      ).length,
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(floorplanRevisions)
          .where(eq(floorplanRevisions.floorplanId, session.planId))
      )
        .map((x) => x.revision)
        .sort(),
    ).toEqual([0, 1]);
    const saved = (await (
      await session.api.request(session.path + "/graph")
    ).json()) as StudioDocument;
    expect(saved.revision).toBe(2);
    expect(saved.agentBatch).toMatchObject({
      agentId: session.id,
      id: (first.structuredContent as { batchId: string }).batchId,
    });
    expect(saved.graph.openings).toMatchObject([
      { id: "entry", offsetMm: 1000, wallId: "hall" },
    ]);
    expect(
      await call("diff_revisions", { fromRevision: 1, toRevision: 2 }),
    ).toMatchObject({
      isError: false,
      structuredContent: {
        total: 1,
        affectedOpenings: [{ id: "entry" }],
        changes: [
          {
            kind: "wall",
            id: "hall",
            action: "updated",
            after: { start: { x: 100, y: 300 } },
          },
        ],
      },
    });
  } finally {
    await Promise.all([
      client.close(),
      retryClient.close(),
      otherClient.close(),
    ]);
    vi.unstubAllEnvs();
  }
}, 30_000);

it("drives wall distances and returns structured conflict IDs over MCP", async () => {
  const session = await planWithToken();
  const client = await connect(createMcpHttp(localWindow(50)), session.token);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  try {
    await call("draw_wall", {
      expectedRevision: 0,
      start: { x: 0, y: 0 },
      end: { x: 4000, y: 0 },
      thicknessMm: 100,
      kind: "interior",
    });
    const response = await call("query_entities", { kind: "wall" });
    if (!isCallToolResult(response)) throw new Error("Expected the new wall");
    const wallId = (
      response.structuredContent as { entities: { id: string }[] }
    ).entities[0].id;
    const constraint = {
      kind: "fixed_distance",
      id: "width",
      distanceMm: 4000,
      first: { wallId, endpoint: "start" },
      second: { wallId, endpoint: "end" },
    };
    expect(
      await call("add_constraint", { expectedRevision: 1, constraint }),
    ).toMatchObject({ isError: false, structuredContent: { revision: 2 } });
    expect(
      await call("set_driving_dimension", {
        expectedRevision: 2,
        constraintId: "width",
        distanceMm: 4800,
      }),
    ).toMatchObject({ isError: false, structuredContent: { revision: 3 } });
    expect(
      await call("add_constraint", {
        expectedRevision: 3,
        constraint: { ...constraint, id: "other-width", distanceMm: 100 },
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: {
        code: "constraint_conflict",
        constraintIds: ["other-width", "width"],
      },
    });
    expect(await call("explain_constraints", {})).toMatchObject({
      isError: false,
      structuredContent: {
        revision: 3,
        degreesOfFreedom: 3,
        constraintCount: 1,
        conflictingConstraintIds: [],
      },
    });
  } finally {
    await client.close();
  }
});
it("updates native block instances and rejects locked changes through MCP and graph RPC", async () => {
  const session = await planWithToken();
  const client = await connect(createMcpHttp(localWindow(60)), session.token);
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    if (!isCallToolResult(result)) throw new Error("Expected tool result");
    return result;
  }
  const base = {
    revision: 0,
    unit: "mm",
    walls: [
      {
        id: "wall",
        start: { x: 0, y: 0 },
        end: { x: 6000, y: 0 },
        thicknessMm: 120,
        kind: "interior",
      },
    ],
    openings: [],
  };
  const definition = {
    id: "door-type",
    kind: "door",
    name: "Office door",
    parameters: { widthMm: 900, hinge: "start", swing: "right" },
  };
  try {
    expect(
      (
        await session.api.request(
          session.path + "/graph",
          payload("PATCH", base),
        )
      ).status,
    ).toBe(200);
    expect(
      await call("define_block", { expectedRevision: 1, definition }),
    ).toMatchObject({ isError: false });
    const instance = await call("insert_block", {
      expectedRevision: 2,
      blockId: definition.id,
      placement: { kind: "door", wallId: "wall", offsetMm: 1600 },
    });
    const instanceId = (instance.structuredContent as { instanceId: string })
      .instanceId;
    expect(instanceId).toBeTruthy();
    expect(
      await call("insert_block", {
        expectedRevision: 3,
        blockId: definition.id,
        placement: {
          kind: "door",
          wallId: "wall",
          offsetMm: 4000,
          overrides: { widthMm: 850 },
        },
      }),
    ).toMatchObject({ isError: false });
    expect(
      await call("edit_block_definition", {
        expectedRevision: 4,
        definition: {
          ...definition,
          parameters: { ...definition.parameters, widthMm: 1000 },
        },
      }),
    ).toMatchObject({ isError: false });
    const graph = (await (
      await session.api.request(session.path + "/graph")
    ).json()) as StudioDocument;
    expect(
      graph.graph.openings.find((item) => item.id === instanceId)?.widthMm,
    ).toBe(1000);
    expect(
      graph.graph.openings.find((item) => item.id !== instanceId)?.widthMm,
    ).toBe(850);
    expect(
      graph.graph.blockInstances?.find((item) => item.id === instanceId)
        ?.overrides,
    ).toEqual({});
    expect(
      await call("manage_layer", {
        expectedRevision: 5,
        action: "put",
        layer: {
          id: "protected",
          name: "Protected",
          visible: true,
          locked: true,
          color: "#334455",
          lineStyle: "dashed",
          members: [{ kind: "door", id: instanceId }],
        },
      }),
    ).toMatchObject({ isError: false });
    expect(
      await call("edit_block_definition", {
        expectedRevision: 6,
        definition: {
          ...definition,
          parameters: { ...definition.parameters, widthMm: 1100 },
        },
      }),
    ).toMatchObject({
      isError: true,
      structuredContent: { message: expect.stringContaining("locked") },
    });
    expect(
      await call("query_entities", { kind: "door", layer: "Protected" }),
    ).toMatchObject({
      isError: false,
      structuredContent: {
        revision: 6,
        entities: [{ id: instanceId, locked: true }],
      },
    });
    const attempt = await session.api.request(
      session.path + "/graph",
      payload("PATCH", {
        ...base,
        revision: 6,
        walls: [
          {
            ...base.walls[0],
            start: { x: 0, y: 100 },
            end: { x: 6000, y: 100 },
          },
        ],
        openings: graph.graph.openings.map(
          ({ createdBy: _, updatedBy: __, ...opening }) => opening,
        ),
      }),
    );
    expect(attempt.status).toBe(400);
    expect((await attempt.json()).error).toContain("locked");
  } finally {
    await client.close();
  }
});
it("creates an upper storey and applies an assembly over MCP", async () => {
  const session = await planWithToken();
  const client = await connect(createMcpHttp(localWindow(40)), session.token);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  try {
    expect(await call("query_spaces", {})).toMatchObject({
      isError: false,
      structuredContent: { storeys: [{ id: "ground" }] },
    });
    await call("create_storey", {
      expectedRevision: 0,
      storey: {
        id: "upper",
        name: "Upper floor",
        elevationMm: 3000,
        wallHeightMm: 2700,
      },
    });
    const drawn = await call("draw_wall", {
      expectedRevision: 1,
      storeyId: "upper",
      start: { x: 0, y: 0 },
      end: { x: 4000, y: 0 },
      thicknessMm: 120,
      kind: "exterior",
    });
    if (!isCallToolResult(drawn)) throw new Error("Expected wall response");
    const { wallId } = drawn.structuredContent as { wallId: string };
    expect(
      await call("set_wall_type", {
        expectedRevision: 2,
        wallIds: [wallId],
        referenceLine: "negative",
        wallType: {
          id: "outer",
          name: "Exterior",
          layers: [{ material: "Core", thicknessMm: 250 }],
        },
      }),
    ).toMatchObject({ isError: false, structuredContent: { revision: 3 } });
    expect(
      await call("query_entities", { storeyId: "ground", kind: "wall" }),
    ).toMatchObject({ structuredContent: { total: 0 } });
    expect(
      await call("inspect_entity", { kind: "wall", id: wallId }),
    ).toMatchObject({
      structuredContent: {
        entity: { storeyId: "upper", thicknessMm: 250, start: { x: 0, y: 0 } },
      },
    });
  } finally {
    await client.close();
  }
});
it("bridges stdio to the authenticated HTTP tools without sharing the database connection", async () => {
  const session = await planWithToken();
  const app = createMcpHttp(localWindow());
  const listener = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await app.fetch(
        new Request("http://localhost" + req.url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500).end();
    }
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local port");
  const client = new Client({ name: "stdio-test", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["scripts/mcp-stdio.mjs"],
        env: {
          DRAFT_MCP_URL: `http://127.0.0.1:${address.port}/api/mcp`,
          DRAFT_MCP_TOKEN: session.token,
        },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(37);
    expect((await client.listResources()).resources).toHaveLength(3);
    expect(
      (await client.readResource({ uri: "draft://floorplan-graph" })).contents,
    ).toMatchObject([{ text: expect.stringContaining(session.planId) }]);
  } finally {
    await client.close();
    const closed = once(listener, "close");
    listener.close();
    listener.closeAllConnections();
    await closed;
  }
}, 15_000);
