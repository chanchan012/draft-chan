import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { initialGraph } from "../../lib/plans/plan-state";
import type {
  StudioDocument,
  StudioSave,
} from "../../lib/plans/studio-document";
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
      graph: {
        ...current.graph,
        walls: input.walls,
        openings: input.openings,
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

async function frame(page: Page) {
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
  const box = (await page
    .getByRole("region", { name: "Drawing surface" })
    .boundingBox())!;
  expect(box.width).toBeGreaterThan(180);
  expect(box.height).toBeGreaterThan(180);
}

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
