import { test, expect } from "@playwright/test";

for (const path of ["/", "/sign-in", "/sign-up"]) {
  test(path + " fits the viewport", async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main > :not(dialog) h1")).toBeVisible();
    expect(
      await page.evaluate(() => {
        const node = document.documentElement;
        return (
          node.scrollHeight === innerHeight && node.scrollWidth === innerWidth
        );
      }),
    ).toBe(true);
    if (path === "/") {
      const drawing = await page.locator(".sheet-field").boundingBox();
      expect(drawing?.height).toBeGreaterThan(40);
      await expect(page.getByRole("link", { name: "Create account" })).toBeInViewport();
      await expect(page.getByRole("button", { name: /Spatial checks/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "2D Plan" })).toHaveCount(0);
      return;
    }
    const panel = page.locator(".auth-panel");
    await expect(panel).toBeInViewport();
    if (process.env.PLAYWRIGHT_CHECK_CLERK) {
      await expect(panel.getByRole("textbox", { name: /email/i })).toBeVisible();
      const card = panel.locator(".draft-clerk-card-box");
      await expect(card).toBeVisible();
      expect(await page.locator(".auth-scroll").evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(
        await page.locator(".auth-scroll").evaluate((el) => el.clientWidth),
      );
      const action = panel.getByRole("button", { name: "Continue", exact: true });
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
    }
  });
}

test("landing field guide is accessible without an account", async ({ page }) => {
  await page.goto("/?view=sample");
  const modal = page.getByRole("dialog");
  await expect(modal).toBeHidden();
  await page.getByRole("button", { name: /Spatial checks/ }).click();
  await expect(modal.getByRole("heading", { name: "Spatial checks" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("private page visits reach sign-in", async ({ page }) => {
  for (const path of ["/dashboard", "/studio/example", "/studio/example.draft"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Back to the drawing board." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Floorplans" })).toHaveCount(0);
  }
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
