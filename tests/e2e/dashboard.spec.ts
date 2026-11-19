import { test, expect } from "@playwright/test";
import type { PlanCard } from "../../lib/plans/geometry";
test("guest library opens a sample and stays within the viewport", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("link", { name: "Sign in to create" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight === innerHeight &&
        document.documentElement.scrollWidth === innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Open sample" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("member grid, CRUD dialogs and area units", async ({ page }) => {
  const records: PlanCard[] = Array.from({ length: 16 }, (_, i) => ({
    id: crypto.randomUUID(),
    name: "Drawing " + i,
    revision: 0,
    areaM2: 0,
    thumbnail: null,
    updatedAt: new Date().toISOString(),
  }));
  await page.route("**/api/floorplans**", async (route) => {
    const req = route.request(),
      id = new URL(req.url()).pathname.split("/")[3];
    const plan = records.find((p) => p.id === id);
    switch (req.method()) {
      case "POST": {
        const input = req.postDataJSON();
        const p = {
          id: input.id,
          name: input.name,
          revision: 0,
          areaM2: (input.room.width * input.room.depth) / 1e6,
          thumbnail: null,
          updatedAt: new Date().toISOString(),
        };
        records.unshift(p);
        return route.fulfill({ json: p, status: 201 });
      }
      case "PATCH":
        Object.assign(plan!, { name: req.postDataJSON().name, revision: 1 });
        return route.fulfill({ json: plan });
      case "DELETE":
        records.splice(records.indexOf(plan!), 1);
        return route.fulfill({ status: 204 });
      default:
        return route.fulfill({ json: records });
    }
  });
  await page.goto("/dashboard");
  await expect(page.locator(".dash-card")).toHaveCount(16);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight === innerHeight &&
        document.documentElement.scrollWidth === innerWidth,
    ),
  ).toBe(true);
  const grid = await page
    .locator(".dash-grid")
    .evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
  if (page.viewportSize()!.width < 600) expect(grid).toBe(1);
  else expect(grid).toBeGreaterThan(1);
  await page.getByRole("button", { name: "New floorplan" }).click();
  await page.getByLabel("Plan name").fill("Office");
  await page.getByLabel("Starting layout").selectOption("room");
  await page.getByRole("button", { name: "Create floorplan" }).click();
  await page.getByRole("button", { name: /Office.*24 m².*258.33 ft²/ }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Plan name").fill("Office B");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByLabel("Search floorplans").fill("Office B");
  await page.getByRole("button", { name: /Office B/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete floorplan", exact: true })
    .click();
  await expect(page.getByText("No matching floorplans")).toBeVisible();
});
