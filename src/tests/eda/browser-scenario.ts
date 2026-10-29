import type { Page } from "playwright";

/** CLI 与远端人工入口点击同一个产品按钮，不依赖开发服务器的 window 调试对象。 */
export async function runEdaBrowserScenario(page: Page, options: {
  url: string; id: string; timeoutMs: number; reportPath: string; screenshotPath: string;
}): Promise<void> {
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(120_000);
  // 生产站首次访问会异步询问离线安装；通过真实按钮关闭，避免遮挡规划入口。
  const offlinePrompt = page.getByRole("dialog", { name: "启用离线模式", exact: true });
  await page.addLocatorHandler(offlinePrompt, async prompt => {
    await prompt.getByRole("button", { name: "暂不", exact: true }).click();
  }, { times: 1 });
  const installPrompt = page.getByRole("dialog", { name: "安装到桌面", exact: true });
  await page.addLocatorHandler(installPrompt, async prompt => {
    await prompt.getByRole("button", { name: "以后再说", exact: true }).click();
  }, { times: 1 });
  await page.goto(options.url, { waitUntil: "load" });
  await page.getByRole("button", { name: "规划", exact: true }).waitFor({ timeout: 60_000 });
  const help = page.locator('[data-dialog-key="help"]');
  if (await help.isVisible()) await help.getByRole("button", { name: "关闭", exact: true }).click();
  // 2026-10-29：算法测试入口仅在调试模式下出现；通过真实设置操作开启，部署站同样适用。
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const debugMode = page.locator("#setting-other-debug-mode");
  if (!await debugMode.isChecked()) await page.locator('label[for="setting-other-debug-mode"]').click();
  await page.locator('[data-dialog-key="settings"]').getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "规划", exact: true }).click();
  await page.getByTestId("eda-regression-open").click();
  const card = page.getByTestId(`eda-regression-${options.id}`);
  if (await card.getAttribute("data-eda-status") !== "idle") throw new Error("测试必须从未运行状态开始。");
  await page.getByTestId(`eda-regression-run-${options.id}`).click();
  await page.waitForFunction(id => {
    const status = document.querySelector(`[data-testid="eda-regression-${id}"]`)?.getAttribute("data-eda-status");
    return status === "passed" || status === "failed" || status === "cancelled";
  }, options.id, { timeout: options.timeoutMs + 90_000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId(`eda-regression-download-${options.id}`).click();
  const download = await pending;
  await download.saveAs(options.reportPath);
  if (await download.failure()) throw new Error("测试报告下载失败。");
  await page.screenshot({ path: options.screenshotPath });
}
