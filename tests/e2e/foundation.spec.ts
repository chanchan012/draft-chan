import { test, expect } from "@playwright/test";
for (const path of ["/", "/sign-in", "/sign-up"]) {
  test(path + " fits the viewport", async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const node = document.documentElement;
        return (
          node.scrollHeight === innerHeight && node.scrollWidth === innerWidth
        );
      }),
    ).toBe(true);
    if (path === "/") {
      const box = await page.locator(".sheet-field").boundingBox();
      expect(box?.height).toBeGreaterThan(40);
      const sheet = await page.locator(".hero .sheet").boundingBox();
      const toolkit = await page.locator(".capabilities").boundingBox();
      expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(toolkit!.y);
      const signIn = await page.getByRole("link", { name: "Sign in", exact: true }).boundingBox();
      expect(signIn!.height).toBeLessThan(30);
      await expect(
        page.getByRole("button", { name: "Explore demo" }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: /Spatial checks/ }),
      ).toBeInViewport();
    }
  });
}
test("guest entry, sample views, zoom, and field guide", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Continue as guest" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "2D Plan" }).click();
  await expect(modal.getByRole("img", { name: /floor plan/ })).toBeVisible();
  await modal.getByRole("button", { name: "Zoom in" }).click();
  await expect(modal.getByText("125%")).toBeVisible();
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: /Spatial checks/ }).click();
  await expect(
    modal.getByRole("heading", { name: "Spatial checks" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});
test("guest RPC enforces the account boundary", async ({ request }) => {
  expect(await (await request.get("/api/session")).json()).toEqual({
    mode: "guest",
  });
  expect((await request.get("/api/account")).status()).toBe(401);
});
