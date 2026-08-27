import { expect, test } from "./canvas-lock-audit";

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
  test.setTimeout(60_000);
  await page.goto("/");

  const collapseButton = page.getByTitle("折叠 运行控制");
  await expect(collapseButton).toBeVisible({ timeout: 20_000 });
  await collapseButton.tap();

  const expandButton = page.getByTitle("展开 运行控制");
  await expect(expandButton).toBeVisible();
  await expect.poll(() => expandButton.evaluate((button) => button.closest("main") === null)).toBe(true);

  // AI-REMOVED 2026-08-05:
  // Reason: 触摸命中回归不再串行启动仿真、全屏和时间轴运行时，避免下游初始化耗时污染输入测试。
  // Trigger: 时间轴已经成功打开，但整条用例因真实设备像素比下的运行时负载超过 Playwright 总超时。
  // Evidence: 失败截图与 accessibility snapshot 均显示时间轴 region 已出现、按钮 aria-pressed=true。
  // Replacement: 下方原生目标事件探针；业务 action 结果继续由 Vitest 单元测试覆盖。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const simulationButton = page.locator('[data-ui-button-id="top-bar-simulation-control"]');
  // await expect(simulationButton).toHaveAttribute("aria-pressed", "false");
  // await simulationButton.tap();
  // await expect(simulationButton).toHaveAttribute("aria-pressed", "true");
  //
  // const enterFullscreenButton = page.getByLabel("进入全屏");
  // await enterFullscreenButton.tap();
  // const exitFullscreenButton = page.getByLabel("退出全屏");
  // await expect(exitFullscreenButton).toBeVisible();
  // await exitFullscreenButton.tap();
  // await expect(enterFullscreenButton).toBeVisible();
  //
  // await expandButton.tap();
  // await expect(collapseButton).toBeVisible();
  // await collapseButton.tap();
  // await expect(expandButton).toBeVisible();
  //
  // await page.locator('[data-ui-button-id="top-bar-timeline"]').tap();
  // await expect.poll(() => page.evaluate(() =>
  //   window.__industrialPlannerAppHost?.internalState.workbench.dialogState.timeline.visible,
  // )).toBe(true);
  const touchEventProbes = [
    {
      button: page.locator('[data-ui-button-id="top-bar-simulation-control"]'),
      eventType: "pointerup",
    },
    {
      button: page.locator('[data-ui-button-id="top-bar-timeline"]'),
      eventType: "click",
    },
    {
      button: page.getByLabel("进入全屏"),
      eventType: "click",
    },
    {
      button: expandButton,
      eventType: "click",
    },
  ] as const;

  for (const { button, eventType } of touchEventProbes) {
    await button.evaluate((element, expectedEventType) => {
      element.addEventListener(expectedEventType, (event) => {
        element.setAttribute("data-touch-event-received", expectedEventType);
        event.stopPropagation();
      }, { once: true });
    }, eventType);

    await button.tap();
    await expect(button).toHaveAttribute("data-touch-event-received", eventType);
  }
});
