import { test, expect, type Page } from "@playwright/test";

async function expectNoPageScroll(page: Page) {
  expect(
    await page.evaluate(() => {
      const root = document.documentElement;
      return (
        root.scrollHeight === innerHeight && root.scrollWidth === innerWidth
      );
    }),
  ).toBe(true);
}

test("landing fits the viewport with signed-out navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoPageScroll(page);
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Workspace" })).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Create account" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: /Spatial checks/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "2D Plan" })).toHaveCount(0);
  expect(
    (await page.locator(".sheet-field").boundingBox())?.height,
  ).toBeGreaterThan(40);
});

for (const action of ["Sign in", "Create account"]) {
  test(action + " opens a responsive landing modal", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("link", { name: action, exact: true });
    await trigger.click();
    const modal = page.getByRole("dialog", { name: action, exact: true });
    await expect(modal).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    await expectNoPageScroll(page);
    const box = (await modal.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeLessThanOrEqual(viewport.height);

    if (process.env.PLAYWRIGHT_CHECK_CLERK) {
      await expect(
        modal.getByRole("textbox", { name: /email/i }),
      ).toBeVisible();
      const continueButton = modal.getByRole("button", {
        name: "Continue",
        exact: true,
      });
      await continueButton.scrollIntoViewIfNeeded();
      await expect(continueButton).toBeInViewport();
      await expect(
        modal.locator(".cl-footer").filter({ visible: true }),
      ).toHaveCount(0);
    }
    const alternate = action === "Sign in" ? "Create account" : "Sign in";
    await modal.getByRole("link", { name: alternate, exact: true }).click();
    const switched = page.getByRole("dialog", { name: alternate, exact: true });
    await expect(switched).toBeVisible();
    if (process.env.PLAYWRIGHT_CHECK_CLERK) {
      await expect(
        switched.getByRole("textbox", { name: /email/i }),
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(switched).toBeHidden();
    await expect(page).toHaveURL("/");
    await expect(trigger).toBeFocused();
  });
}

test("landing field guide is accessible without an account", async ({
  page,
}) => {
  await page.goto("/?view=sample");
  const modal = page.getByRole("dialog");
  await expect(modal).toBeHidden();
  await page.getByRole("button", { name: /Spatial checks/ }).click();
  await expect(
    modal.getByRole("heading", { name: "Spatial checks" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("private and legacy auth routes open landing dialogs", async ({
  page,
}) => {
  for (const path of [
    "/dashboard",
    "/studio/example",
    "/studio/example.draft?unit=in",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("dialog", { name: "Sign in", exact: true }),
    ).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("returnTo")).toBe(path);
    await expect(page.getByRole("heading", { name: "Floorplans" })).toHaveCount(
      0,
    );
  }
  await page.goto("/sign-up");
  await expect(
    page.getByRole("dialog", { name: "Create account", exact: true }),
  ).toBeVisible();
  await page.goto("/sign-in?redirect_url=https%3A%2F%2Fexample.com%2Fstudio");
  await expect(
    page.getByRole("dialog", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has("returnTo")).toBe(false);
});

test("unsigned RPC requests require sign-in", async ({ request }) => {
  for (const route of ["session", "account", "floorplans"]) {
    const response = await request.get("/api/" + route, {
      headers: { "x-user-id": "untrusted" },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in required" });
  }
});
