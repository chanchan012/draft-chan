import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Home } from "../components/home";
import { authModalHref, returnPath } from "../lib/auth-navigation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("landing navigation", () => {
  for (const signedIn of [true, false]) {
    it("shows the correct header action for signedIn=" + signedIn, () => {
      const html = renderToStaticMarkup(
        createElement(Home, {
          signedIn,
          authConfigured: false,
          authMode: null,
        }),
      );
      const header = html.match(/<header\b[^>]*>(.*?)<\/header>/)?.[1];
      expect(header).toBeDefined();
      expect(header?.includes("Workspace")).toBe(signedIn);
      expect(header?.includes("Sign in")).toBe(!signedIn);
    });
  }

  it("retains only safe private return paths", () => {
    expect(authModalHref("sign-in", "/studio/plan?unit=in")).toBe(
      "/?auth=sign-in&returnTo=%2Fstudio%2Fplan%3Funit%3Din",
    );
    for (const value of [
      "https://draft.local/dashboard",
      "//example.com/dashboard",
      "/\\example.com/dashboard",
      "/dashboard/../",
      "/dashboard-other",
      "/studio\n/x",
    ]) {
      expect(returnPath(value)).toBeUndefined();
    }
  });
});
