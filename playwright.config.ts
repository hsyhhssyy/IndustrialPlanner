import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./src/tests/e2e",
  outputDir: ".temp/playwright-test/results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
