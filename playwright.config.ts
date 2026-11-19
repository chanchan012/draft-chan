import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 2,
  timeout: 90_000,
  use: {
    baseURL,
    ...(process.env.PLAYWRIGHT_PROXY_SERVER
      ? { proxy: { server: process.env.PLAYWRIGHT_PROXY_SERVER } }
      : {}),
    ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === "1",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 768, height: 1024 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
    { name: "compact", use: { viewport: { width: 320, height: 568 } } },
    { name: "landscape", use: { viewport: { width: 844, height: 390 } } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
});
