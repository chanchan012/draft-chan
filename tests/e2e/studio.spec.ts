import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { initialGraph } from "../../lib/plans/plan-state";
import type {
  StudioDocument,
  StudioSave,
} from "../../lib/plans/studio-document";

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

async function studio(page: Page, conflict = false) {
  let document: StudioDocument = {
    id,
    name: "Corner study",
    graph: initialGraph(),
    revision: 0,
    unit: "mm",
  };
  const edits: StudioSave[] = [];
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
    const fixture = JSON.stringify(document)
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
  await page.route("**/api/floorplans/" + id + "/graph", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: document });
    const input = route.request().postDataJSON() as StudioSave;
    edits.push(input);
    if (conflict || input.revision !== document.revision)
      return route.fulfill({ status: 409, json: { error: "Plan changed" } });
    document = {
      ...document,
      revision: input.revision + 1,
      unit: input.unit,
      graph: {
        ...document.graph,
        walls: input.walls,
        openings: input.openings,
        fixtures: input.fixtures ?? document.graph.fixtures,
        utilities: input.utilities ?? document.graph.utilities,
      },
    };
    return route.fulfill({ json: { revision: document.revision } });
  });
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Corner study" }),
  ).toBeVisible();
  return edits;
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
  if (await toggle.isVisible()) await toggle.click();
  await inspector.getByLabel("Width (mm)").fill("800");
  await inspector
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  if (await toggle.isVisible())
    await inspector.getByRole("button", { name: "Close inspector" }).click();
  await point(page, 0.5, 0.5);
  await expect(page.locator("[data-door]")).toHaveCount(1);
  await expect(wall.locator("line")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("[data-door]")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator("[data-door]")).toHaveCount(1);

  if (await toggle.isVisible()) await toggle.click();
  await expect(
    inspector.getByRole("heading", { name: "Plan quantities" }),
  ).toBeVisible();
  await inspector.getByLabel("Units").selectOption("in");
  await expect(inspector.getByLabel("Snap spacing")).toContainText("6 in");
  if (await toggle.isVisible())
    await inspector.getByRole("button", { name: "Close inspector" }).click();

  await page.getByRole("button", { name: "Isometric", exact: true }).click();
  await expect(page.locator("[data-view=isometric] .cad-top")).toHaveCount(2);
  await frame(page);
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  await expect(page.locator("[data-door]")).toHaveCount(1);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(edits).toHaveLength(1);
  expect(edits[0]).toMatchObject({ unit: "in", revision: 0 });
  expect(edits[0].openings[0].wallId).toBe(edits[0].walls[0].id);
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
  await inspector
    .getByRole("button", { name: "Apply fixture settings" })
    .click();
  await point(page, 0.48, 0.52);
  await expect(page.locator("[data-fixture]")).toHaveCount(1);
  await openInspector();
  await inspector.getByLabel("Rotation").selectOption("90");
  await inspector.getByRole("button", { name: "Update fixture" }).click();
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
  await inspector
    .getByRole("button", { name: "Apply utility settings" })
    .click();
  await point(page, 0.75, 0.35);
  await expect(page.locator('[data-layer="plumbing"]')).toHaveCount(1);
  await openInspector();
  await inspector.getByRole("checkbox", { name: "Electrical" }).uncheck();
  await expect(page.locator('[data-layer="electrical"]')).toHaveCount(0);
  await expect(page.locator('[data-layer="plumbing"]')).toHaveCount(1);
  await closeInspector();

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

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  expect(edits[0].fixtures).toHaveLength(2);
  expect(edits[0].utilities).toHaveLength(2);
  expect(edits[0].fixtures).toContainEqual(
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
