import { expect, test } from "playwright/test";

test.use({
  viewport: {
    width: 764,
    height: 345,
  },
  deviceScaleFactor: 3.125,
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
});

test("collapsed top-bar controls remain outside canvas input and accept touch taps", async ({
  page,
}) => {
  await page.goto("/");

  const collapseButton = page.getByTitle("折叠 运行控制");
  await expect(collapseButton).toBeVisible({ timeout: 20_000 });
  await collapseButton.tap();

  const expandButton = page.getByTitle("展开 运行控制");
  await expect(expandButton).toBeVisible();
  await expect.poll(() => expandButton.evaluate((button) => button.closest("main") === null)).toBe(true);

  const simulationButton = page.locator('[data-ui-button-id="top-bar-simulation-control"]');
  await expect(simulationButton).toHaveAttribute("aria-pressed", "false");
  await simulationButton.tap();
  await expect(simulationButton).toHaveAttribute("aria-pressed", "true");

  const enterFullscreenButton = page.getByLabel("进入全屏");
  await enterFullscreenButton.tap();
  const exitFullscreenButton = page.getByLabel("退出全屏");
  await expect(exitFullscreenButton).toBeVisible();
  await exitFullscreenButton.tap();
  await expect(enterFullscreenButton).toBeVisible();

  await expandButton.tap();
  await expect(collapseButton).toBeVisible();
  await collapseButton.tap();
  await expect(expandButton).toBeVisible();

  await page.locator('[data-ui-button-id="top-bar-timeline"]').tap();
  await expect.poll(() => page.evaluate(() =>
    window.__industrialPlannerAppHost?.internalState.workbench.dialogState.timeline.visible,
  )).toBe(true);
});
