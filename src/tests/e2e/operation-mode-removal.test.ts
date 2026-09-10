import { expect, test } from "./canvas-lock-audit";

const SCREEN_PROFILES = [
  { deviceClass: "mobile", width: 764, height: 345, dpr: 3.125, screenShape: "landscape" },
  { deviceClass: "tablet", width: 711, height: 665, dpr: 3.125, screenShape: "square" },
  { deviceClass: "desktop", width: 2552, height: 1315, dpr: 1, screenShape: "landscape" },
] as const;

// 开发期 playwright-cli 验证完成后独立编写；由单 worker 的正式 E2E 入口串行执行。
test.describe.configure({ mode: "serial" });

for (const profile of SCREEN_PROFILES) {
  test(`历史关闭设置不再禁用当前操作 [${profile.deviceClass}]`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      hasTouch: profile.deviceClass !== "desktop",
      isMobile: profile.deviceClass !== "desktop",
    });
    try {
      await context.addInitScript((desktop) => {
        // 桌面配置具有触控能力，但保留鼠标细指针；避免被识别成平板。
        if (desktop) {
          Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 1 });
        }
        if (localStorage.getItem("v3-app-settings") === null) {
          localStorage.setItem("v3-app-settings", JSON.stringify({
            locale: "zh-CN",
            themeId: "ayu-light",
            hypergryphOperationMode: false,
            hypergryphImmediateMove: false,
            hypergryphImmediateMarquee: false,
          }));
        }
      }, profile.deviceClass === "desktop");
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:4174/");
      await expect.poll(() => page.evaluate(() => (
        window.__industrialPlannerAppHost?.workspace.editor !== null
        && window.__industrialPlannerAppHost?.workspace.editor !== undefined
      ))).toBe(true);
      await expect(page.locator("canvas").first()).toBeVisible();
      expect(await page.evaluate(() => window.__industrialPlannerAppHost?.state.screenProfile)).toMatchObject({
        deviceClass: profile.deviceClass,
        viewportWidth: profile.width,
        viewportHeight: profile.height,
        devicePixelRatio: profile.dpr,
        hasTouch: true,
        screenShape: profile.screenShape,
      });
      const settings = await page.evaluate(() => ({ ...window.__industrialPlannerAppHost?.state.settings }));
      expect(settings).not.toHaveProperty("hypergryphOperationMode");
      expect(settings.hypergryphImmediateMove).toBe(false);
      await testInfo.attach("before.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await page.getByRole("button", { name: "批量选择", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost?.state.activeTool)).toBe("marquee");
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost?.state.activeTool)).toBe("select");
      await page.keyboard.press("x");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost?.state.activeTool)).toBe("marquee");
      await page.keyboard.press("Escape");

      const canvasRect = await page.locator("canvas").first().boundingBox();
      if (canvasRect === null) throw new Error("画布不可见");
      const gridSize = await page.evaluate(() => window.__industrialPlannerAppHost?.workspace.editor?.state.viewport.gridSize);
      if (gridSize === undefined) throw new Error("视口未初始化");
      await page.mouse.move(canvasRect.x + canvasRect.width * 0.65, canvasRect.y + canvasRect.height * 0.6);
      await page.mouse.wheel(0, -120);
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost?.workspace.editor?.state.viewport.gridSize))
        .toBeGreaterThan(gridSize);

      await page.getByRole("button", { name: "设置", exact: true }).click();
      const settingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
      await expect(settingsDialog.locator('input[name="game-arknights-operation-mode"]')).toHaveCount(0);
      await settingsDialog.locator('select[name="system-theme"]').selectOption("ayu-dark");
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("v3-app-settings") ?? "null"));
      expect(saved).not.toHaveProperty("hypergryphOperationMode");
      expect(saved).toMatchObject({ themeId: "ayu-dark", hypergryphImmediateMove: false, hypergryphImmediateMarquee: false });
      await settingsDialog.getByRole("button", { name: "关闭", exact: true }).click();

      await page.getByRole("button", { name: "帮助", exact: true }).click();
      await page.getByRole("tab", { name: "操作说明", exact: true }).click();
      const moveRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "移动已选中设备", exact: true }) });
      await expect(moveRow.getByRole("cell").nth(1)).toHaveText("长按已选中设备后拖拽");
      await moveRow.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("operation-guide.png") });
      await testInfo.attach("after.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      // AI-REMOVED 2026-09-10:
      // Reason: context 关闭必须进入 finally，覆盖断言失败、异常与超时路径。
      // Trigger: 完整 E2E 检查暴露了测试资源生命周期未覆盖失败路径的问题。
      // Evidence: 成功路径尾部的关闭动作无法满足项目 Playwright 异常路径清理规范。
      // Replacement: 本测试 finally 中的 await context.close()
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // await context.close();
    } finally {
      // 包括断言失败与超时路径，关闭本用例全部页面、上下文和浏览器进程。
      // AI-CORRECTION 2026-09-10: browser 是 Playwright worker 级 fixture；本用例只关闭自行创建的 context，browser 由 runner 统一关闭。
      await context.close();

      // AI-REMOVED 2026-09-10:
      // Reason: 测试不得关闭 Playwright runner 管理的 worker 级 browser fixture。
      // Trigger: mobile 用例关闭共享 browser 后，tablet 在 browser.newContext() 处失败，desktop 未执行。
      // Evidence: Playwright browser fixture 为 worker 作用域，同一 worker 内的串行用例共享该 fixture。
      // Replacement: 本 finally 关闭测试自行创建的 context；browser 由 Playwright runner teardown 关闭。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // await browser.close();
      // expect(browser.isConnected()).toBe(false);
    }
  });
}
