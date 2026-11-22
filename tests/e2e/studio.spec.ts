import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { dxfFixture } from "../dxf-fixture";
import { readFileSync } from "node:fs";
import {
  Client,
  StreamableHTTPClientTransport,
  isCallToolResult,
} from "@modelcontextprotocol/client";
import { buildSync } from "esbuild";
import { sheetFixture } from "../sheet-fixture";
import { initialGraph } from "../../lib/plans/plan-state";
import {
  applyStudioSnapshot,
  type StudioDocument,
  type StudioSave,
} from "../../lib/plans/studio-document";
import { createMcpHttp } from "../../lib/server/mcp-http";
import { localWindow } from "../../lib/server/rate-limit";
import type { LivePeer, PresenceInput } from "../../lib/plans/live";
import type { Blueprint, BlueprintRequest } from "../../lib/plans/exports";

test.use({ hasTouch: true });

const id = "e4794e0c-00db-4de5-92fe-9fe5638de386";
const path = "/studio/" + id;
const script = buildSync({
  entryPoints: ["tests/e2e/studio.fixture.tsx"],
  jsx: "automatic",
  bundle: true,
  define: { "process.env": '{"NODE_ENV":"production"}' },
  write: false,
}).outputFiles[0].text;
const css = readFileSync("app/studio/[id]/studio.css", "utf8");

function studioWorkspace() {
  return {
    document: {
      id,
      name: "Corner study",
      graph: initialGraph(),
      revision: 0,
      unit: "mm",
    } as StudioDocument,
    edits: [] as StudioSave[],
    peers: new Map<string, LivePeer>(),
    gate: undefined as Promise<void> | undefined,
    signedIn: true,
  };
}

async function studio(
  page: Page,
  conflict = false,
  workspace = studioWorkspace(),
) {
  await page.goto("/");
  const styles = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) =>
      links.map((node) => (node as HTMLLinkElement).href),
    );
  await page.route("**/tests/studio.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: script }),
  );
  await page.route("**" + path, (route) => {
    const fixture = JSON.stringify(workspace.document)
      .replaceAll("&", "&amp;")
      .replaceAll("'", "&#39;")
      .replaceAll("<", "&lt;");
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
        ${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}
        <style>${css}</style><div id="root" data-document='${fixture}'></div><script defer src="/tests/studio.js"></script>`,
    });
  });
  const graphEndpoint = "**/api/floorplans/" + id;
  await page.route(graphEndpoint + "/live", (route) => {
    if (!workspace.signedIn) return route.fulfill({ status: 401 });
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify({
          type: "snapshot",
          revision: workspace.document.revision,
          peers: [...workspace.peers.values()],
        }) +
        "\n\n",
    });
  });
  await page.route(graphEndpoint + "/presence", (route) => {
    if (!workspace.signedIn) return route.fulfill({ status: 401 });
    const { clientId, cursor } = route
      .request()
      .postDataJSON() as PresenceInput;
    workspace.peers.set(clientId, {
      id: clientId,
      cursor,
      kind: "human",
      expiresAt: Date.now() + 25_000,
    });
    return route.fulfill({ status: 204 });
  });
  await page.route(graphEndpoint + "/graph", async (route) => {
    if (!workspace.signedIn) return route.fulfill({ status: 401 });
    if (route.request().method() === "GET")
      return route.fulfill({ json: workspace.document });
    const input = route.request().postDataJSON() as StudioSave;
    workspace.edits.push(input);
    await workspace.gate;
    const current = workspace.document;
    if (conflict || input.revision !== current.revision)
      return route.fulfill({ status: 409, json: { error: "Plan changed" } });
    workspace.document = {
      ...current,
      revision: input.revision + 1,
      unit: input.unit,
      agentBatch: undefined,
      graph: {
        ...current.graph,
        walls: input.walls,
        openings: input.openings,
        windows: input.windows ?? current.graph.windows,
        annotations: input.annotations ?? current.graph.annotations,
        sketches: input.sketches ?? current.graph.sketches,
        constraints: input.constraints ?? current.graph.constraints,
        storeys: input.storeys ?? current.graph.storeys,
        buildingElements:
          input.buildingElements ?? current.graph.buildingElements,
        buildingViews: input.buildingViews ?? current.graph.buildingViews,
        documentItems: input.documentItems ?? current.graph.documentItems,
        underlays: input.underlays ?? current.graph.underlays,
        wallTypes: input.wallTypes ?? current.graph.wallTypes,
        drawingLayers: input.drawingLayers ?? current.graph.drawingLayers,
        blocks: input.blocks ?? current.graph.blocks,
        blockInstances: input.blockInstances ?? current.graph.blockInstances,
        fixtures: input.fixtures ?? current.graph.fixtures,
        utilities: input.utilities ?? current.graph.utilities,
      },
    };
    return route.fulfill({ json: { revision: workspace.document.revision } });
  });
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Corner study" }),
  ).toBeVisible();
  return workspace.edits;
}

async function point(page: Page, x: number, y: number) {
  const box = (await page
    .getByRole("region", { name: "Drawing surface" })
    .boundingBox())!;
  const coords = { x: box.x + box.width * x, y: box.y + box.height * y };
  if (page.viewportSize()!.width < 600)
    await page.touchscreen.tap(coords.x, coords.y);
  else await page.mouse.click(coords.x, coords.y);
}

async function saveIfNeeded(page: Page) {
  const save = page.getByRole("button", { name: "Save", exact: true });
  if (await save.isEnabled())
    await save.click({ timeout: 1_000 }).catch(async (error) => {
      if (await save.isEnabled()) throw error;
    });
  await expect(page.getByRole("banner").getByRole("status")).toHaveText(
    "Saved",
    {
      timeout: 10_000,
    },
  );
}

async function viewportFits(page: Page) {
  expect(
    await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      clientWidth: innerWidth,
      clientHeight: innerHeight,
    })),
  ).toEqual({
    ...page.viewportSize(),
    clientWidth: page.viewportSize()!.width,
    clientHeight: page.viewportSize()!.height,
  });
}

async function frame(page: Page) {
  await viewportFits(page);
  const box = (await page
    .getByRole("region", { name: "Drawing surface" })
    .boundingBox())!;
  expect(box.width).toBeGreaterThan(180);
  expect(box.height).toBeGreaterThan(180);
}

test("connects an MCP agent and sees it furnish two bedrooms in an open Studio", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  const token = "draft_mcp_" + "a".repeat(43);
  const agentId = "822fb4a7-180f-4c77-9df7-700386555872";
  await page.route(`**/api/floorplans/${id}/agent-tokens`, async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    return route.fulfill({
      status: 201,
      json: {
        id: agentId,
        token,
        name: route.request().postDataJSON().name,
        expiresAt: new Date(Date.now() + 604_800_000).toISOString(),
      },
    });
  });
  await studio(page, false, workspace);
  const connect = page.getByRole("button", { name: "Connect an agent" });
  await connect.click();
  const dialog = page.getByRole("dialog", { name: "Connect an agent" });
  await expect(
    dialog.getByRole("textbox", { name: "MCP endpoint", exact: true }),
  ).toHaveValue(new URL("/api/mcp", page.url()).href);
  await dialog.getByText("Manual tokens", { exact: true }).click();
  await dialog.getByLabel("Agent name").fill("Layout agent");
  await dialog.getByRole("button", { name: "Create token" }).click();
  await expect(
    dialog.getByRole("textbox", { name: "Bearer token", exact: true }),
  ).toHaveValue(token);
  await viewportFits(page);
  await dialog.getByRole("button", { name: "Close agent setup" }).click();
  await expect(dialog).toBeHidden();

  const mcp = createMcpHttp(
    localWindow(120),
    async (provided) =>
      provided === token ? { owner: "studio-test", planId: id, agentId } : null,
    {
      async get() {
        return workspace.document;
      },
      async save(owner, planId, input, author = { kind: "human", id: owner }) {
        if (planId !== id || input.revision !== workspace.document.revision)
          return { status: "conflict" };
        const graph = applyStudioSnapshot(
          workspace.document.graph,
          input,
          author,
        );
        const revision = input.revision + 1;
        workspace.document = { ...workspace.document, graph, revision };
        return { status: "saved", revision };
      },
      async publish(scope, _revision, cursor) {
        if (cursor)
          workspace.peers.set(scope.agentId, {
            id: scope.agentId,
            cursor,
            kind: "ai",
            expiresAt: Date.now() + 25_000,
          });
      },
      async exportDxf() {
        throw new Error("Export is covered by the MCP integration suite");
      },
    },
  );
  const client = new Client({ name: "draft-playwright", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
        fetch: (input, init) =>
          Promise.resolve(mcp.fetch(new Request(input, init))),
        requestInit: { headers: { Authorization: "Bearer " + token } },
      }),
    );
    let revision = 0;
    async function edit(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({
        name,
        arguments: { ...args, expectedRevision: revision },
      });
      if (!isCallToolResult(result)) throw new Error("Expected a tool result");
      expect(result.isError, JSON.stringify(result.structuredContent)).toBe(
        false,
      );
      const content = result.structuredContent as Record<string, unknown>;
      expect(content.revision).toBe(++revision);
      return content;
    }
    const draw = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      kind = "exterior",
    ) =>
      edit("draw_wall", {
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        kind,
        thicknessMm: 120,
      });
    const north = await draw(0, 0, 10000, 0);
    await expect(page.locator("[data-wall]")).toHaveCount(1);
    await draw(10000, 0, 10000, 7000);
    await draw(10000, 7000, 0, 7000);
    await draw(0, 7000, 0, 0);
    const partition = await draw(0, 3500, 10000, 3500, "interior");
    await draw(5000, 0, 5000, 3500, "interior");
    for (const offsetMm of [2500, 7500]) {
      await edit("place_opening", {
        kind: "door",
        wallId: partition.wallId,
        offsetMm,
        widthMm: 915,
        hinge: "start",
        swing: "right",
      });
    }
    await edit("place_opening", {
      kind: "window",
      wallId: north.wallId,
      offsetMm: 7200,
      widthMm: 1200,
      heightMm: 950,
      sillMm: 800,
    });
    const {
      contents: [audit],
    } = await client.readResource({ uri: "draft://spatial-audit" });
    if (!("text" in audit)) throw new Error("Expected an audit resource");
    const bedrooms = (
      JSON.parse(audit.text).rooms as { id: string; areaM2: number }[]
    ).filter((room) => room.areaM2 === 17.5);
    expect(bedrooms).toHaveLength(2);
    for (const bedroom of bedrooms)
      await edit("furnish_room_preset", {
        roomId: bedroom.id,
        preset: "bedroom",
      });
    await edit("add_dimension_annotation", {
      start: { x: 0, y: 7500 },
      end: { x: 10000, y: 7500 },
    });
    await expect(page.locator("[data-dimension]")).toHaveCount(1);
    await page.getByRole("button", { name: "Fit drawing" }).click();
    await expect(page.locator("[data-fixture]")).toHaveCount(4);
    await expect(page.locator("[data-window]")).toHaveCount(1);
    await expect(page.locator('[data-peer-kind="ai"]')).toBeVisible();
    await expect(page.locator("[data-wall-join]")).toHaveCount(4);
    expect(
      await page
        .locator('[data-wall-join="0,0"]')
        .evaluate((corner) =>
          (corner as SVGPathElement).isPointInFill(new DOMPoint(-42, -42)),
        ),
    ).toBe(true);
    await page.getByRole("button", { name: "Isometric", exact: true }).click();
    await expect(page.locator("[data-iso-slab]")).toHaveCount(1);
    await expect(page.locator('[data-iso-wall="rear"]').first()).toBeVisible();
    await expect(page.locator('[data-iso-wall="front"]').first()).toBeVisible();
    await expect(
      page.locator('[data-iso-fixture][data-template="queenBed"]'),
    ).toHaveCount(2);
    await expect(page.locator("[data-iso-window]")).toHaveCount(1);
    await frame(page);
  } finally {
    await client.close();
  }
});

test("enables and disables Clerk OAuth without revealing a manual token", async ({
  page,
}) => {
  let state: "enabled" | "disabled" = "disabled";
  await page.route(`**/api/floorplans/${id}/agent-tokens`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/floorplans/${id}/mcp-oauth`, (route) => {
    if (route.request().method() === "POST") state = "enabled";
    if (route.request().method() === "DELETE") {
      state = "disabled";
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { state } });
  });
  await studio(page);
  await page.getByRole("button", { name: "Connect an agent" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect an agent" });
  await dialog.getByRole("button", { name: "Enable OAuth access" }).click();
  await expect(dialog.getByRole("status")).toHaveText("OAuth access enabled.");
  await expect(
    dialog.getByRole("button", { name: "Create token" }),
  ).toBeHidden();
  await expect(
    dialog.getByText("Approved clients can edit this floorplan.", {
      exact: false,
    }),
  ).toBeVisible();
  await viewportFits(page);
  await dialog.getByRole("button", { name: "Disable OAuth access" }).click();
  await expect(dialog.getByRole("status")).toHaveText("OAuth access disabled.");
  await expect(
    dialog.getByRole("button", { name: "Enable OAuth access" }),
  ).toBeEnabled();
});

test("floats controls and collapses and resizes the side panels", async ({
  page,
}) => {
  await studio(page);
  const canvas = page.getByRole("region", { name: "Drawing surface" });
  const layerButton = page.getByRole("button", { name: "Layers", exact: true });
  const inspectorButton = page.getByRole("button", {
    name: "Inspector",
    exact: true,
  });
  const layers = page.getByRole("complementary", { name: "Layers" });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const width = async () => (await canvas.boundingBox())!.width;
  const initialWidth = await width();
  await expect(layers).toBeHidden();
  await expect(inspector).toBeHidden();
  const drawingTools = page.getByRole("group", { name: "Drawing tools" });
  const toolbar = (await drawingTools.boundingBox())!;
  const surface = (await canvas.boundingBox())!;
  expect(toolbar.x).toBeGreaterThan(surface.x);
  expect(toolbar.y).toBeGreaterThan(surface.y);
  expect(toolbar.y + toolbar.height).toBeLessThan(surface.y + surface.height);
  expect(toolbar.x + toolbar.width).toBeLessThan(surface.x + surface.width);
  await expect(
    page.getByRole("banner").getByRole("group", { name: "Zoom controls" }),
  ).toBeVisible();

  await layerButton.click();
  await expect(layerButton).toHaveAttribute("aria-expanded", "true");
  await expect(layers).toBeVisible();
  await inspectorButton.click();
  await expect(inspector).toBeVisible();
  await expect(inspectorButton).toHaveAttribute("aria-expanded", "true");
  if (page.viewportSize()!.width > 1000) {
    await expect(layers).toBeVisible();
    await expect.poll(width).toBeLessThan(initialWidth);
    const handle = page.getByRole("separator", { name: "Resize inspector" });
    const bounds = (await handle.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const before = Number(await handle.getAttribute("aria-valuenow"));
    const beforeDrag = await width();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 48, y, { steps: 5 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", String(before + 48));
    await expect.poll(width).toBeLessThan(beforeDrag);
    await handle.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", String(before + 40));
    const leftHandle = page.getByRole("separator", { name: "Resize layers" });
    const leftWidth = Number(await leftHandle.getAttribute("aria-valuenow"));
    await leftHandle.press("ArrowRight");
    await expect(leftHandle).toHaveAttribute(
      "aria-valuenow",
      String(leftWidth + 8),
    );
    await handle.press("Escape");
    await expect(inspectorButton).toBeFocused();
    await inspectorButton.click();
    await expect(handle).toHaveAttribute("aria-valuenow", String(before + 40));
    await layers.getByRole("button", { name: "Close layers" }).click();
  } else {
    await expect(layers).toBeHidden();
    await expect(
      page.getByRole("separator", { name: "Resize inspector" }),
    ).toBeHidden();
    expect(await width()).toBe(initialWidth);
    if (page.viewportSize()!.width <= 620) {
      const sheet = (await inspector.boundingBox())!;
      expect(sheet.y).toBeGreaterThan(surface.y + surface.height * 0.5);
      expect(sheet.y + sheet.height).toBe(surface.y + surface.height);
    }
  }
  await inspector.getByRole("button", { name: "Close inspector" }).click();
  await expect(inspectorButton).toBeFocused();
  await expect(inspector).toBeHidden();
  await expect.poll(width).toBe(initialWidth);
  await frame(page);
});

test("draws an ortho wall and door, toggles isometric, and saves the graph", async ({
  page,
}) => {
  const edits = await studio(page);
  await frame(page);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  await point(page, 0.17, 0.5);
  if (page.viewportSize()!.width >= 600) {
    const canvas = (await page
      .getByRole("region", { name: "Drawing surface" })
      .boundingBox())!;
    await page.mouse.move(
      canvas.x + canvas.width * 0.83,
      canvas.y + canvas.height * 0.51,
    );
    await expect(page.locator(".cad-measure")).toHaveText(/\d+ mm/);
  }
  await point(page, 0.83, 0.51);
  const wall = page.locator("[data-wall]");
  await expect(wall).toHaveCount(1);
  const line = wall.locator("line");
  expect(await line.getAttribute("y1")).toBe(await line.getAttribute("y2"));
  await page.getByRole("button", { name: "Door", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Inspector", exact: true });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await toggle.click();
  await inspector.getByLabel("Width (mm)").fill("800");
  await inspector.getByRole("button", { name: "Close inspector" }).click();
  await point(page, 0.5, 0.5);
  await expect(page.locator("[data-door]")).toHaveCount(1);
  await expect(wall.locator("line")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("[data-door]")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator("[data-door]")).toHaveCount(1);

  await toggle.click();
  await expect(
    inspector.getByRole("heading", { name: "Plan quantities" }),
  ).toBeVisible();
  await inspector.getByLabel("Units").selectOption("in");
  await expect(inspector.getByLabel("Snap spacing")).toContainText("6 in");
  await inspector.getByRole("button", { name: "Close inspector" }).click();

  await page.getByRole("button", { name: "Isometric", exact: true }).click();
  await expect(page.locator("[data-view=isometric] .cad-top")).toHaveCount(2);
  await frame(page);
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  await expect(page.locator("[data-door]")).toHaveCount(1);

  await saveIfNeeded(page);
  const last = edits.at(-1)!;
  expect(last.unit).toBe("in");
  expect(last.openings[0].wallId).toBe(last.walls[0].id);
  await page.reload();
  await expect(page.locator("[data-door]")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Check clearances" }).click();
  const narrow = page.getByRole("button", { name: /opening is narrow/ });
  await expect(narrow).toContainText("target 32.09 in");
  await narrow.click();
  await expect(
    page.locator('[data-clearance="door-width"] .cad-audit-dimension'),
  ).toBeVisible();
});

test("draws a window and dimension and preserves them after reload", async ({
  page,
}) => {
  const edits = await studio(page);
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  await point(page, 0.17, 0.47);
  await point(page, 0.83, 0.47);
  await expect(page.locator("[data-wall]")).toHaveCount(1);
  await page.getByRole("button", { name: "Door", exact: true }).click();
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector.getByLabel("Opening type").selectOption("window");
  await inspector.getByLabel("Sill height (mm)").fill("750");
  await inspector.getByRole("button", { name: "Close inspector" }).click();
  await point(page, 0.5, 0.47);
  await expect(page.locator("[data-window]")).toHaveCount(1);
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  await point(page, 0.25, 0.65);
  await point(page, 0.75, 0.65);
  await expect(page.locator("[data-dimension]")).toContainText(/\d+ mm/);
  await saveIfNeeded(page);
  expect(edits.at(-1)?.windows?.[0]).toMatchObject({ sillMm: 750 });
  expect(edits.at(-1)?.annotations).toHaveLength(1);
  await page.reload();
  await expect(page.locator("[data-window]")).toHaveCount(1);
  await expect(page.locator("[data-dimension]")).toHaveCount(1);
  await frame(page);
});

test("places precise coordinates using explicit input units", async ({
  page,
}) => {
  const edits = await studio(page);
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  await page.getByRole("button", { name: "Precision input" }).click();
  await page.getByLabel("Input unit").selectOption("ft");
  await page.getByLabel("X", { exact: true }).fill("0");
  await page.getByLabel("Y", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Set first point" }).click();
  await page.getByLabel("X", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Place next point" }).click();
  await expect(page.locator("[data-wall]")).toHaveCount(1);
  await saveIfNeeded(page);
  expect(edits.at(-1)?.walls[0].end).toEqual({ x: 3658, y: 0 });
  await frame(page);
});

test("sketches an exact circle from a local origin and restores it after reload", async ({
  page,
}) => {
  const edits = await studio(page);
  await page.getByRole("button", { name: "Sketch", exact: true }).click();
  await page.getByLabel("Sketch shape").selectOption("circle");
  await page.getByRole("button", { name: "Precision input" }).click();
  await page.getByLabel("X", { exact: true }).fill("350");
  await page.getByLabel("Y", { exact: true }).fill("450");
  await page.getByText("Tracking and origin").click();
  await page.getByRole("button", { name: "Set local origin from X/Y" }).click();
  await expect(page.locator(".cad-local-origin")).toBeVisible();
  await page.getByText("Tracking and origin").click();
  await page.getByLabel("X", { exact: true }).fill("0");
  await page.getByLabel("Y", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Set first point" }).click();
  await page.getByLabel("Point entry").selectOption("polar");
  await page.getByLabel("Distance", { exact: true }).fill("500");
  await page
    .getByRole("spinbutton", { name: "Angle (°)", exact: true })
    .fill("45");
  await page.getByRole("button", { name: "Place next point" }).click();
  const circle = page.locator('[data-sketch][data-kind="circle"]');
  await expect(circle).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(circle).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(circle).toHaveCount(1);
  await saveIfNeeded(page);
  const geometry = edits.at(-1)?.sketches?.[0].geometry;
  expect(geometry).toMatchObject({
    kind: "circle",
    center: { x: 350, y: 450 },
  });
  if (geometry?.kind !== "circle") throw new Error("Expected a circle");
  expect(geometry.radiusMm).toBeCloseTo(500);
  await page.reload();
  await expect(circle).toHaveCount(1);
  await frame(page);
});

test("offsets a selected wall with its hosted door and undoes the edit together", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  const graph = initialGraph({ width: 4000, depth: 3000 });
  graph.openings.push({
    id: "entry",
    wallId: "starter-wall-1",
    hinge: "start",
    swing: "right",
    offsetMm: 2000,
    widthMm: 900,
  });
  workspace.document.graph = graph;
  const edits = await studio(page, false, workspace);
  const canvas = page.getByRole("region", { name: "Drawing surface" });
  const wall = page.locator('[data-wall="starter-wall-1"]');
  const line = await wall.locator("line").first().boundingBox();
  await page.mouse.click(
    line!.x + line!.width * 0.15,
    line!.y + line!.height / 2,
  );
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Edit geometry" }).click();
  const panel = page.getByRole("complementary", { name: "Edit geometry" });
  await panel.getByLabel("Operation").selectOption("offset");
  await panel.getByLabel("Keep original").uncheck();
  await panel.getByLabel("Distance (mm)").fill("300");
  await panel.getByRole("button", { name: "Apply edit" }).click();
  await expect(panel.getByRole("status")).toContainText("1 hosted opening");
  await expect(wall.locator("line").first()).toHaveAttribute("y1", "300");
  await expect(canvas.locator("[data-door]")).toHaveCount(1);
  await saveIfNeeded(page);
  expect(edits.at(-1)?.openings[0]).toMatchObject({
    id: "entry",
    wallId: "starter-wall-1",
    offsetMm: 2000,
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(wall.locator("line").first()).toHaveAttribute("y1", "0");
  await viewportFits(page);
});

test("undoes one adjacent agent transaction in a clean Studio", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  workspace.document.graph = initialGraph({ width: 4200, depth: 3200 });
  await studio(page, false, workspace);
  const north = page.locator('[data-wall="starter-wall-1"] line');
  const east = page.locator('[data-wall="starter-wall-2"] line');
  await expect(north.first()).toHaveAttribute("y1", "0");
  const edited = structuredClone(workspace.document.graph);
  edited.walls[0].start.y = 100;
  edited.walls[0].end.y = 100;
  edited.walls[1].start.x = 4500;
  edited.walls[1].end.x = 4500;
  workspace.document = {
    ...workspace.document,
    graph: edited,
    revision: 1,
    agentBatch: { id: "test-batch", agentId: "test-agent" },
  };
  await expect(north.first()).toHaveAttribute("y1", "100", { timeout: 16000 });
  await expect(east.first()).toHaveAttribute("x1", "4500");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(north.first()).toHaveAttribute("y1", "0");
  await expect(east.first()).toHaveAttribute("x1", "4200");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await frame(page);
});

test("solves a driving distance in Studio and reloads its constrained wall", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  workspace.document.graph = initialGraph({ width: 4000, depth: 3000 });
  await studio(page, false, workspace);
  await page.getByRole("button", { name: "Constraints", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Constraints" });
  await panel.getByRole("button", { name: "Add constraint" }).click();
  await expect(page.locator("[data-driving]")).toContainText("4000 mm");
  await panel.getByLabel("Driving distance (mm)").fill("4600");
  await panel.getByRole("button", { name: "Solve distance" }).click();
  await expect(page.locator("[data-driving]")).toContainText("4600 mm");
  await saveIfNeeded(page);
  await page.reload();
  await expect(page.locator("[data-driving]")).toContainText("4600 mm");
  await viewportFits(page);
});

test("updates a door block and saves its linked drawing layer", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  workspace.document.graph = initialGraph({ width: 6000, depth: 3400 });
  await studio(page, false, workspace);
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Blocks" });
  await panel.getByLabel("New block name").fill("Room doors");
  await panel.getByRole("button", { name: "Create definition" }).click();
  await panel.getByRole("button", { name: "Insert block" }).click();
  await panel.getByLabel("Host offset (mm)").fill("3500");
  await panel.getByLabel("Instance width override (mm)").fill("800");
  await panel.getByRole("button", { name: "Insert block" }).click();
  await panel.getByLabel("Default width (mm)").fill("1050");
  await panel.getByRole("button", { name: "Update definition" }).click();
  await expect(
    panel.getByText("2 linked instances · 1 with overrides"),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Close blocks" }).click();
  await expect(page.locator("[data-door]")).toHaveCount(2);

  await page
    .getByRole("region", { name: "Drawing surface" })
    .press("Control+a");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const layers = page.getByRole("complementary", { name: "Layers" });
  await layers.getByLabel("New layer name").fill("Room plan");
  await layers.getByRole("button", { name: "Create layer" }).click();
  await layers.getByLabel("Line style").selectOption("dashed");
  await layers.getByRole("button", { name: "Save layer style" }).click();
  await layers
    .getByRole("button", { name: "Assign selection", exact: true })
    .click();
  await expect(
    page.locator('[data-drawing-layer="Room plan"][data-door]'),
  ).toHaveCount(2);
  await layers.getByLabel("Lock layer").check();
  await layers.getByLabel("Show layer").uncheck();
  await expect(page.locator("[data-door]")).toHaveCount(0);
  await saveIfNeeded(page);
  expect(
    workspace.document.graph.openings
      .map((item) => item.widthMm)
      .sort((a, b) => a - b),
  ).toEqual([800, 1050]);
  expect(workspace.document.graph.drawingLayers).toMatchObject([
    { name: "Room plan", visible: false, locked: true, lineStyle: "dashed" },
  ]);
  await page.reload();
  await expect(page.locator("[data-door]")).toHaveCount(0);
  await viewportFits(page);
});

test("adds an upper storey and keeps its drawing separate", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  workspace.document.graph = initialGraph({ width: 4000, depth: 3000 });
  await studio(page, false, workspace);
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Building" });
  await panel.getByRole("button", { name: "New storey" }).click();
  await panel.getByLabel("Storey name").fill("Upper floor");
  await panel.getByRole("button", { name: "Create storey" }).click();
  await expect(panel.getByLabel("Active storey")).toContainText("Upper floor");
  await expect(page.locator("[data-wall]")).toHaveCount(0);
  await panel.getByRole("button", { name: "Close building" }).click();
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  await point(page, 0.2, 0.48);
  await point(page, 0.8, 0.48);
  await expect(page.locator("[data-wall]")).toHaveCount(1);
  await saveIfNeeded(page);
  const level = workspace.document.graph.storeys?.find(
    (item) => item.name === "Upper floor",
  );
  expect(level).toBeDefined();
  expect(
    workspace.document.graph.walls.filter(
      (item) => item.storeyId === level?.id,
    ),
  ).toHaveLength(1);
  await page.reload();
  await expect(page.locator("[data-wall]")).toHaveCount(4);
  await frame(page);
});

test("moves a linked stair and sees the section and floor opening update", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  const p = (x: number, y: number) => ({ x, y });
  const footprint = [p(0, 0), p(6000, 0), p(6000, 4000), p(0, 4000)];
  const graph = initialGraph({ width: 6000, depth: 4000 });
  graph.storeys = [
    { id: "ground", name: "Ground floor", elevationMm: 0, wallHeightMm: 2450 },
    { id: "upper", name: "Upper floor", elevationMm: 3000, wallHeightMm: 2600 },
  ];
  graph.buildingElements = [
    {
      id: "deck",
      kind: "slab",
      name: "Upper deck",
      storeyId: "upper",
      footprint,
      thicknessMm: 200,
      offsetMm: 0,
    },
    {
      id: "stair",
      kind: "stair",
      name: "Main stair",
      fromStoreyId: "ground",
      toStoreyId: "upper",
      start: p(1000, 1500),
      end: p(4000, 1500),
      widthMm: 1000,
      risers: 16,
      openingSlabId: "deck",
    },
  ];
  graph.buildingViews = [
    {
      id: "section-a",
      kind: "section",
      name: "Section A",
      start: p(0, 1500),
      end: p(6000, 1500),
    },
  ];
  workspace.document.graph = graph;
  await studio(page, false, workspace);
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Building" });
  await panel.getByRole("button", { name: "Views", exact: true }).click();
  await panel.getByLabel("Building view").selectOption("section-a");
  const drawing = page.getByRole("img", { name: "Section A", exact: true });
  await expect(
    drawing.locator('[data-surface-kind="stair"]').first(),
  ).toHaveAttribute("d", /^M 1000 /);
  await panel.getByRole("button", { name: "Structure", exact: true }).click();
  await panel.getByLabel("Building element").selectOption("stair");
  await panel.getByLabel("Start X (mm)").fill("1600");
  await panel.getByLabel("End X (mm)").fill("4600");
  await panel.getByRole("button", { name: "Update element" }).click();
  await expect(
    drawing.locator('[data-surface-kind="stair"]').first(),
  ).toHaveAttribute("d", /^M 1600 /);
  await panel.getByRole("button", { name: "Storeys", exact: true }).click();
  await panel.getByLabel("Active storey").selectOption("upper");
  await panel.getByRole("button", { name: "Close building" }).click();
  await expect(page.locator('[data-floor-opening="stair"]')).toHaveAttribute(
    "d",
    /^M 1600 /,
  );
  await saveIfNeeded(page);
  await frame(page);
});

test("lays out an A3 drawing at 1:50 and restores its saved viewport", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  workspace.document.graph = initialGraph({ width: 5000, depth: 3000 });
  await studio(page, false, workspace);
  const openSheets = () =>
    page.getByRole("button", { name: "Sheets", exact: true }).first().click();
  const panel = page.getByRole("complementary", { name: "Sheets" });
  await openSheets();
  await panel
    .getByRole("button", { name: "Create sheet", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Create a named view", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Save named view", exact: true })
    .click();
  await panel.getByRole("button", { name: "Sheets", exact: true }).click();
  await panel
    .getByRole("button", { name: "Place viewport", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Close sheets", exact: true })
    .click();
  const drawing = page.getByRole("img", { name: "A101 Floor plan" });
  await expect(drawing).toHaveAttribute("viewBox", "0 0 420 297");
  await expect(drawing.getByText("Ground floor · 1:50")).toBeVisible();
  const d = await drawing
    .locator('[data-source="starter-wall-1"]')
    .getAttribute("d");
  const x = d!.match(/^[ML] ([\d.]+) [\d.]+ L ([\d.]+)/);
  expect(x).not.toBeNull();
  expect(Math.abs(Number(x![1]) - Number(x![2]))).toBe(100);
  await saveIfNeeded(page);
  await page.reload();
  await openSheets();
  await panel
    .getByRole("combobox", { name: "Sheet", exact: true })
    .selectOption({ label: "A101 · Floor plan" });
  await panel
    .getByRole("button", { name: "Close sheets", exact: true })
    .click();
  await expect(drawing.getByText("Ground floor · 1:50")).toBeVisible();
  await viewportFits(page);
  const box = (await drawing.boundingBox())!;
  expect(box.width).toBeGreaterThan(180);
  expect(box.height).toBeGreaterThan(140);
});

test("publishes and downloads the saved PDF issue from Sheets", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  workspace.document.graph = sheetFixture();
  workspace.document.revision = 4;
  const issue: Blueprint = {
    id: crypto.randomUUID(),
    format: "pdf",
    revision: 4,
    status: "pending",
  };
  let requested = false;
  await page.route(`**/api/floorplans/${id}/issues`, (route) =>
    route.fulfill({ json: requested ? [{ ...issue, status: "ready" }] : [] }),
  );
  await page.route(`**/api/floorplans/${id}/exports`, (route) => {
    expect(route.request().postDataJSON()).toEqual({
      format: "pdf",
      revision: 4,
    });
    requested = true;
    return route.fulfill({ status: 202, json: issue });
  });
  await page.route(
    `**/api/floorplans/${id}/exports/${issue.id}/download`,
    (route) =>
      route.fulfill({
        contentType: "application/pdf",
        headers: {
          "Content-Disposition":
            'attachment; filename="oak-house-r4-issued.pdf"',
        },
        body: "%PDF-1.7",
      }),
  );
  await studio(page, false, workspace);
  await page
    .getByRole("group", { name: "Left sidebar" })
    .getByRole("button", { name: "Sheets" })
    .click();
  const panel = page.getByRole("complementary", { name: "Sheets" });
  await panel.getByRole("button", { name: "Schedules", exact: true }).click();
  await panel.getByText("Door schedule", { exact: false }).click();
  await expect(panel.getByText("D-01", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Issues", exact: true }).click();
  await expect(panel.getByText("No issued sets")).toBeVisible();
  await panel.getByRole("button", { name: "Publish PDF set" }).click();
  await expect(panel.getByText("Revision 4", { exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel.getByRole("link", { name: "Download PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("oak-house-r4-issued.pdf");
  await viewportFits(page);
});

test("stages a DXF and restores a calibrated PDF underlay", async ({
  page,
}) => {
  const workspace = studioWorkspace();
  await studio(page, false, workspace);
  await page.getByRole("button", { name: "Interchange", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Interchange" });
  await panel.getByLabel("DXF file").setInputFiles({
    name: "Survey.dxf",
    mimeType: "application/dxf",
    buffer: Buffer.from(dxfFixture),
  });
  await expect(
    panel
      .getByRole("img", { name: "DXF staging preview" })
      .locator("[data-staged-dxf]"),
  ).toHaveCount(4);
  await expect(panel.getByText(/SPLINE · Unsupported entity/)).toBeVisible();
  await expect(page.locator("[data-sketch]")).toHaveCount(0);
  await panel.getByRole("button", { name: "Import 4 entities" }).click();
  await expect(page.locator("[data-sketch]")).toHaveCount(4);
  await saveIfNeeded(page);
  expect(
    workspace.document.graph.drawingLayers?.map(({ name }) => name).sort(),
  ).toEqual(["Reference", "Survey"]);

  const pdf = await PDFDocument.create();
  pdf
    .addPage([120, 80])
    .drawLine({
      start: { x: 10, y: 10 },
      end: { x: 110, y: 30 },
      color: rgb(0, 0, 0),
    });
  await panel.getByRole("button", { name: "Underlays" }).click();
  await panel.getByLabel("Underlay file").setInputFiles({
    name: "Survey.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(
    panel.getByRole("img", { name: "Underlay calibration image" }),
  ).toBeVisible({ timeout: 10_000 });
  const pointB = panel.getByRole("group", { name: "Point B", exact: true });
  await pointB.getByLabel("Plan X (mm)").fill("3200");
  await expect(panel.getByLabel("Calibration scale")).toHaveText(
    "2.0000 mm/px",
  );
  await panel.getByRole("button", { name: "Attach underlay" }).click();
  await expect(page.locator("[data-underlay]")).toHaveAttribute(
    "transform",
    "matrix(2 0 0 2 0 0)",
  );
  await panel.getByRole("button", { name: "Close interchange" }).click();
  await saveIfNeeded(page);
  await page.reload();
  await expect(page.locator("[data-sketch]")).toHaveCount(4);
  await expect(page.locator("[data-underlay]")).toHaveCount(1);
  await frame(page);
});

test("keeps unsaved drawing after a revision conflict", async ({ page }) => {
  await studio(page, true);
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  await point(page, 0.2, 0.47);
  await point(page, 0.8, 0.47);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "A newer revision is saved",
  );
  await expect(page.locator("[data-wall]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
});

test("exports a saved revision and tracks blueprint retries and downloads", async ({
  page,
}) => {
  const edits = await studio(page);
  const jobs = new Map<string, { job: Blueprint; polls: number }>();
  let svgRequests = 0;
  let dxfDownloads = 0;
  await page.route(
    (url) => {
      const path = `/api/floorplans/${id}/exports`;
      return url.pathname === path || url.pathname.startsWith(path + "/");
    },
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/download")) {
        const record = [...jobs.values()].find(({ job }) =>
          url.pathname.includes(job.id),
        );
        const extension = record?.job.format;
        if (!extension) return route.fulfill({ status: 404 });
        if (extension === "dxf" && ++dxfDownloads === 1)
          return route.fulfill({
            status: 401,
            json: { error: "Sign in required" },
          });
        return route.fulfill({
          headers: {
            "Content-Disposition": `attachment; filename="corner-study-r1.${extension}"`,
          },
          body:
            extension === "dxf"
              ? "0\nEOF\n"
              : '<svg xmlns="http://www.w3.org/2000/svg"/>',
        });
      }
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON() as BlueprintRequest;
        expect(input.revision).toBe(1);
        const key = `${input.format}:${input.revision}`;
        const job: Blueprint = {
          ...input,
          id: jobs.get(key)?.job.id ?? crypto.randomUUID(),
          status:
            input.format === "svg" && ++svgRequests === 1
              ? "failed"
              : "pending",
        };
        jobs.set(key, { job, polls: 0 });
        return route.fulfill({ status: 202, json: job });
      }
      const revision = Number(url.searchParams.get("revision"));
      const list = [...jobs.values()].filter(
        ({ job }) => job.revision === revision,
      );
      for (const entry of list) {
        if (entry.job.status === "pending" && ++entry.polls === 2)
          entry.job.status = "ready";
      }
      return route.fulfill({ json: list.map(({ job }) => job) });
    },
  );
  await page.route(`**/api/floorplans/${id}/bom?revision=1`, (route) =>
    route.fulfill({
      contentType: "text/csv",
      body: "Category,Item,Dimensions (mm),Unit,Quantity\r\n",
    }),
  );

  await page.getByRole("button", { name: "Wall", exact: true }).click();
  await point(page, 0.2, 0.47);
  await point(page, 0.8, 0.47);
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  const exports = page.getByRole("complementary", { name: "Exports" });
  await saveIfNeeded(page);
  await expect(exports.getByText("Saved revision 1")).toBeVisible();
  expect(edits).toHaveLength(1);
  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    exports.getByRole("button", { name: "CSV" }).click(),
  ]);
  expect(csv.suggestedFilename()).toBe("corner-study-r1-bom.csv");

  await exports.getByRole("button", { name: "Generate DXF" }).click();
  await expect(exports.getByText("Queued or rendering…")).toBeVisible();
  const dxfDownload = exports.getByRole("button", { name: "Download DXF" });
  await expect(dxfDownload).toBeVisible({ timeout: 10_000 });
  await dxfDownload.click();
  await expect(exports.getByRole("alert")).toHaveText("Sign in required");
  const [dxf] = await Promise.all([
    page.waitForEvent("download"),
    dxfDownload.click(),
  ]);
  expect(dxf.suggestedFilename()).toBe("corner-study-r1.dxf");

  await exports.getByRole("button", { name: "Generate SVG" }).click();
  await expect(exports.getByText("Export failed")).toBeVisible();
  await exports.getByRole("button", { name: "Retry SVG" }).click();
  const svgDownload = exports.getByRole("button", { name: "Download SVG" });
  await expect(svgDownload).toBeVisible({ timeout: 10_000 });
  const [svg] = await Promise.all([
    page.waitForEvent("download"),
    svgDownload.click(),
  ]);
  expect(svg.suggestedFilename()).toBe("corner-study-r1.svg");
  await frame(page);
  await exports.getByRole("button", { name: "Close exports" }).click();
  await expect(
    page.getByRole("button", { name: "Exports", exact: true }),
  ).toBeFocused();
});

test("places, edits, audits and reloads catalog items and utility layers", async ({
  page,
}) => {
  const edits = await studio(page);
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const toggle = page.getByRole("button", { name: "Inspector", exact: true });
  async function openInspector() {
    if (!(await inspector.isVisible())) await toggle.click();
  }
  async function closeInspector() {
    const close = inspector.getByRole("button", { name: "Close inspector" });
    if (await close.isVisible()) await close.click();
  }

  await page.getByRole("button", { name: "Fixture", exact: true }).click();
  await openInspector();
  await inspector.getByLabel("Fixture template").selectOption("queenBed");
  await inspector.getByLabel("Width (mm)").fill("1600");
  await closeInspector();
  await point(page, 0.48, 0.52);
  await expect(page.locator("[data-fixture]")).toHaveCount(1);
  await openInspector();
  const selectedWidth = inspector.getByLabel("Width (mm)");
  await selectedWidth.fill("1700");
  await expect(page.locator("[data-fixture] > rect")).toHaveAttribute(
    "width",
    "1700",
  );
  await selectedWidth.press("Backspace");
  await expect(page.locator("[data-fixture]")).toHaveCount(1);
  await selectedWidth.fill("1600");
  await inspector.getByLabel("Rotation").selectOption("90");
  await expect(page.locator("[data-fixture]")).toHaveAttribute(
    "transform",
    /rotate\(90\)/,
  );
  await closeInspector();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("[data-fixture]")).toHaveAttribute(
    "transform",
    /rotate\(0\)/,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();

  await page.getByRole("button", { name: "Utility", exact: true }).click();
  await point(page, 0.25, 0.35);
  await expect(page.locator('[data-layer="electrical"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Utility", exact: true }).click();
  await openInspector();
  await inspector.getByLabel("Utility symbol").selectOption("drain");
  await closeInspector();
  await point(page, 0.75, 0.35);
  await expect(page.locator('[data-layer="plumbing"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const layers = page.getByRole("complementary", { name: "Layers" });
  await layers.getByRole("checkbox", { name: "Electrical" }).uncheck();
  await expect(page.locator('[data-layer="electrical"]')).toHaveCount(0);
  await expect(page.locator('[data-layer="plumbing"]')).toHaveCount(1);
  await layers.getByRole("button", { name: "Close layers" }).click();

  await page.getByRole("button", { name: "Fixture", exact: true }).click();
  await point(page, 0.48, 0.52);
  await expect(page.locator("[data-fixture]")).toHaveCount(2);
  await page.getByRole("button", { name: "Check clearances" }).click();
  const finding = page
    .getByRole("button", { name: /Footprints overlap/ })
    .first();
  await expect(finding).toBeVisible();
  await finding.click();
  await expect(page.locator('[data-clearance="collision"]')).toBeVisible();
  await frame(page);
  await page.getByRole("button", { name: "Isometric", exact: true }).click();
  await expect(page.locator("[data-iso-fixture]")).toHaveCount(2);

  await saveIfNeeded(page);
  const last = edits.at(-1)!;
  expect(last.fixtures).toHaveLength(2);
  expect(last.utilities).toHaveLength(2);
  expect(last.fixtures).toContainEqual(
    expect.objectContaining({
      template: "queenBed",
      rotation: 90,
      widthMm: 1600,
    }),
  );
  await page.reload();
  await expect(page.locator("[data-fixture]")).toHaveCount(2);
  await expect(page.locator("[data-utility]")).toHaveCount(2);
});

test("pinches both ways, multi-selects, moves and deletes a group in one undo step", async ({
  page,
  context,
}) => {
  await studio(page);
  const canvas = page.getByRole("region", { name: "Drawing surface" });
  const box = (await canvas.boundingBox())!;
  const scale = async () => {
    const transform = await page
      .locator(".studio-canvas > g[transform]")
      .getAttribute("transform");
    return Number(/scale\(([^)]+)\)/.exec(transform ?? "")?.[1]);
  };
  const session = await context.newCDPSession(page);
  const y = box.y + box.height * 0.48;
  const x = box.x + box.width * 0.5;
  const finger = (delta: number, id: number) => ({ x: x + delta, y, id });
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  const before = await scale();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [finger(-25, 0)],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [finger(-25, 0), finger(25, 1)],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [finger(-45, 0), finger(45, 1)],
  });
  await expect.poll(scale).toBeGreaterThan(before * 1.5);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [finger(-17, 0), finger(17, 1)],
  });
  await expect.poll(scale).toBeLessThan(before);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator("[data-wall]")).toHaveCount(0);
  await page.getByRole("button", { name: "Fit drawing" }).click();

  const utility = page.getByRole("button", { name: "Utility", exact: true });
  await utility.click();
  await point(page, 0.36, 0.52);
  await utility.click();
  await point(page, 0.65, 0.52);
  const markers = page.locator("[data-utility]");
  await expect(markers).toHaveCount(2);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const screenPoint = (rx: number, ry: number) =>
    [box.x + box.width * rx, box.y + box.height * ry] as const;
  await page.mouse.move(...screenPoint(0.22, 0.38));
  await page.mouse.down();
  await page.mouse.move(...screenPoint(0.8, 0.67), { steps: 6 });
  await expect(page.locator(".cad-marquee")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator("[data-utility].is-selected")).toHaveCount(2);
  const initial = await markers.first().getAttribute("transform");
  const anchor = (await markers.first().boundingBox())!;
  await page.mouse.move(
    anchor.x + anchor.width / 2,
    anchor.y + anchor.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    anchor.x + anchor.width / 2,
    anchor.y + anchor.height / 2 + 32,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(markers.first()).not.toHaveAttribute("transform", initial!);
  await page.keyboard.press("Backspace");
  await expect(markers).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(markers).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(markers.first()).toHaveAttribute("transform", initial!);
  await page.getByRole("button", { name: "Multi-select" }).click();
  await point(page, 0.36, 0.52);
  await point(page, 0.65, 0.52);
  await expect(page.locator("[data-utility].is-selected")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete selection" }).click();
  await expect(markers).toHaveCount(0);
  await frame(page);
});

test("two tabs show cursors and autosave concurrent independent edits", async ({
  page,
  context,
}) => {
  const workspace = studioWorkspace();
  const other = await context.newPage();
  let release = () => {};
  try {
    await studio(page, false, workspace);
    await studio(other, false, workspace);
    await page.bringToFront();
    const canvas = (await page
      .getByRole("region", { name: "Drawing surface" })
      .boundingBox())!;
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await expect
      .poll(() =>
        [...workspace.peers.values()].some(({ cursor }) => cursor !== null),
      )
      .toBe(true);
    await expect(other.locator('[data-peer-kind="human"]')).toBeVisible({
      timeout: 10_000,
    });
    workspace.peers.set("ai-release-check", {
      id: "ai-release-check",
      kind: "ai",
      cursor: { x: 0, y: 0 },
      expiresAt: Date.now() + 25_000,
    });
    await expect(other.locator('[data-peer-kind="ai"]')).toBeVisible({
      timeout: 10_000,
    });

    workspace.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await Promise.all(
      [page, other].map(async (tab, index) => {
        await tab.getByRole("button", { name: "Wall", exact: true }).click();
        await point(tab, 0.24, 0.4 + index * 0.14);
        await point(tab, 0.76, 0.4 + index * 0.14);
      }),
    );
    await expect
      .poll(() => workspace.edits.length, { timeout: 10_000 })
      .toBe(2);
    expect(workspace.edits.map(({ revision }) => revision)).toEqual([0, 0]);
    release();
    await expect
      .poll(() => workspace.document.revision, { timeout: 10_000 })
      .toBe(2);
    await expect(page.locator("[data-wall]")).toHaveCount(2);
    await expect(other.locator("[data-wall]")).toHaveCount(2);
    await expect(other.getByRole("status")).toHaveText("Saved");
    await frame(other);

    workspace.signedIn = false;
    await expect(other.getByRole("status")).toHaveText("Sign-in required");
    await expect(other.locator("[data-wall]")).toHaveCount(2);
  } finally {
    release();
    await other.close();
  }
});
