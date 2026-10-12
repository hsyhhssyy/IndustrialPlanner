import { defineConfig } from "playwright/test";

// 同一次运行由父进程设置，worker 继承同一路径，失败证据不覆盖历史轮次。
const runDirectory = process.env.E2E_RUN_DIRECTORY ?? `.temp/playwright-test/e2e/${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
process.env.E2E_RUN_DIRECTORY = runDirectory;

export default defineConfig({
  testDir: "./src/tests/e2e",
  outputDir: runDirectory,
  globalSetup: "./scripts/e2e/setup.mjs",
  timeout: 90_000,
  retries: 1,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: `${runDirectory}/report.json` }]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    // 取证随受管 context 关闭；框架自动 tracing 会与 CLI/自建 context 重复启动。
    screenshot: "off",
    trace: "off",
  },
  // AI-REMOVED 2026-10-05:
  // Reason: 套件级服务器改为逐用例资源所有权，确保失败与每轮结束时释放。
  // Trigger: 用户授权统一 E2E 基座。
  // Evidence: 当前用例重复管理相同运行资源。
  // Replacement: src/tests/e2e/harness/fixture.ts
  // Risk: Low。Human Review: Required
  // Original code:
  //   webServer: [
  //     {
  //       command: "npm run dev -- --port 4174",
  //       url: "http://127.0.0.1:4174",
  //       reuseExistingServer: false,
  //       timeout: 120_000,
  //     },
  //     {
  //       command: "node scripts/e2e/start-webdav-e2e-server.mjs",
  //       url: "http://127.0.0.1:4175",
  //       reuseExistingServer: false,
  //       timeout: 120_000,
  //     },
  //   ],
});
