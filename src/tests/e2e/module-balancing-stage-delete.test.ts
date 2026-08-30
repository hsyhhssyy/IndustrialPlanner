import type { Locator } from "playwright/test";

import { expect, test } from "./canvas-lock-audit";

const APP_URL = "http://127.0.0.1:4174/";

const SCREEN_PROFILES = [
  {
    name: "mobile-landscape",
    viewport: { width: 764, height: 345 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    coarsePointer: true,
    isMobile: true,
    deviceClass: "mobile",
    screenShape: "landscape",
  },
  {
    name: "tablet-square",
    viewport: { width: 711, height: 665 },
    deviceScaleFactor: 3.125,
    hasTouch: true,
    coarsePointer: true,
    isMobile: true,
    deviceClass: "tablet",
    screenShape: "square",
  },
  {
    name: "desktop-landscape",
    viewport: { width: 2552, height: 1315 },
    deviceScaleFactor: 1,
    hasTouch: true,
    coarsePointer: false,
    isMobile: false,
    deviceClass: "desktop",
    screenShape: "landscape",
  },
] as const;

// AI-REMOVED 2026-08-30:
// Reason: 单个 Playwright 用例串行执行三种 Screen Profile，共享 90 秒总超时，导致前两种配置完成后第三种配置被提前终止。
// Trigger: full-check 中该用例以 Test timeout of 90000ms exceeded 失败，日志仅生成 mobile-landscape 与 tablet-square 的完成快照。
// Evidence: .temp/full-check/runs/20260829-150117-854748/e2e.log；三种配置之间没有共享状态依赖。
// Replacement: 下方按 SCREEN_PROFILES 注册三个独立 Playwright 用例，每个用例单独设置 90 秒超时。
// Risk: Low；测试总执行时长仍包含三种配置，但单个慢配置不再消耗其他配置的超时预算。
// Human Review: Required
//
// Original code:
// test("stage action clears content before exposing the red delete action", async ({ browser }) => {
//   test.setTimeout(90_000);
//
//   for (const profile of SCREEN_PROFILES) {
for (const profile of SCREEN_PROFILES) {
  test(`stage action clears content before exposing the red delete action [${profile.name}]`, async ({ browser }) => {
    test.setTimeout(90_000);

    const context = await browser.newContext({
      deviceScaleFactor: profile.deviceScaleFactor,
      hasTouch: profile.coarsePointer,
      isMobile: profile.isMobile,
      viewport: profile.viewport,
    });
    const page = await context.newPage();

    try {
      if (profile.hasTouch && !profile.coarsePointer) {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "maxTouchPoints", {
            configurable: true,
            get: () => 1,
          });
          const nativeMatchMedia = window.matchMedia.bind(window);
          window.matchMedia = (query) => {
            const result = nativeMatchMedia(query);
            if (query !== "(pointer: coarse)" && query !== "(hover: none)") {
              return result;
            }
            return new Proxy(result, {
              get(target, property) {
                if (property === "matches") {
                  return false;
                }
                const value = Reflect.get(target, property, target) as unknown;
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
          };
        });
      }

      await page.goto(APP_URL);
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost !== undefined)).toBe(true);
      // AI-REMOVED 2026-08-28:
      // Reason: 直接写入 observable 会触发 MobX strict-mode 警告，UI 回归测试应通过真实交互构造阶段内容。
      // Trigger: 三种 Screen Profile 的开发期浏览器验证捕获到 observable 非 action 写入警告。
      // Evidence: Vite 浏览器日志明确报告 canvases[..].stages 与 activeCanvasId 在 action 外被修改。
      // Replacement: 下方模块卡添加、新建阶段、清空及删除的真实浏览器交互。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // await page.evaluate(() => {
      //   const appHost = window.__industrialPlannerAppHost;
      //   const balancingState = appHost?.internalState.workbench.toolbox.moduleBalancing;
      //   const canvas = balancingState?.canvases[0];
      //   if (appHost === undefined || balancingState === undefined || canvas === undefined) {
      //     throw new Error("Module balancing state unavailable");
      //   }
      //
      //   canvas.stages = [
      //     {
      //       id: "e2e-stage-with-content",
      //       name: "有内容阶段",
      //       entries: [{ moduleId: "e2e-unresolved-module", quantity: 1 }],
      //     },
      //     {
      //       id: "e2e-empty-stage",
      //       name: "空阶段",
      //       entries: [],
      //     },
      //   ];
      //   balancingState.activeCanvasId = canvas.id;
      // });

      const initialStage = await page.evaluate(() => {
        const stage = window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages[0];
        return stage === undefined ? null : {
          entryCount: stage.entries.length,
          id: stage.id,
          name: stage.name,
        };
      });
      expect(initialStage, profile.name).not.toBeNull();
      expect(initialStage?.entryCount, profile.name).toBe(0);
      if (initialStage === null) {
        throw new Error(`${profile.name}: initial stage unavailable`);
      }
      await page.evaluate(() => {
        const appHost = window.__industrialPlannerAppHost;
        if (appHost === undefined) {
          throw new Error("AppHost unavailable");
        }

        appHost.internalActions.setToolboxDockPreference("floating");
        appHost.internalActions.setDialogTab("toolbox", "module-balancing");
        if (!appHost.internalState.workbench.dialogState.toolbox.maximized) {
          appHost.internalActions.toggleDialogMaximized("toolbox");
        }
        appHost.internalActions.openDialog("toolbox");
      });

      const actualProfile = await page.evaluate(() =>
        window.__industrialPlannerAppHost?.state.screenProfile,
      );
      expect(actualProfile, profile.name).toMatchObject({
        viewportWidth: profile.viewport.width,
        viewportHeight: profile.viewport.height,
        devicePixelRatio: profile.deviceScaleFactor,
        deviceClass: profile.deviceClass,
        screenShape: profile.screenShape,
        hasTouch: profile.hasTouch,
      });

      const wizard = page.getByRole("navigation", { name: "模块配平" });
      await expect(wizard, profile.name).toBeVisible();
      await press(
        wizard.getByRole("button", { name: initialStage.name, exact: true }),
        profile.coarsePointer,
      );

      const clearButton = page.getByRole("button", { name: "清空阶段", exact: true });
      const deleteButton = page.getByRole("button", { name: "删除阶段", exact: true });
      await expect(deleteButton, profile.name).toBeVisible();
      await expect(clearButton, profile.name).toBeHidden();

      const libraryHeading = page.getByRole("heading", { name: "模块库", exact: true });
      if (!await libraryHeading.isVisible()) {
        await press(
          wizard.getByRole("button", { name: "模块库", exact: true }),
          profile.coarsePointer,
        );
      }
      await expect(libraryHeading, profile.name).toBeVisible();
      const libraryPanel = libraryHeading.locator("..").locator("..");
      const firstModuleCard = libraryPanel.locator('[role="button"][draggable]').first();
      await expect(firstModuleCard, profile.name).toBeVisible();
      await press(firstModuleCard, profile.coarsePointer);
      await expect(page.getByRole("heading", { name: "添加到阶段", exact: true }), profile.name)
        .toBeVisible();
      await press(
        page.getByRole("button", { name: "确认添加", exact: true }),
        profile.coarsePointer,
      );

      const drawerCloseButton = libraryHeading.locator("..")
        .getByRole("button", { name: "关闭", exact: true });
      if (await drawerCloseButton.isVisible()) {
        await press(drawerCloseButton, profile.coarsePointer);
      }
      await expect(clearButton, profile.name).toBeVisible();
      await expect(deleteButton, profile.name).toBeHidden();

      await press(
        wizard.getByRole("button", { name: "新建阶段", exact: true }),
        profile.coarsePointer,
      );
      const stagesBeforeClear = await page.evaluate(() =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.map((stage) => ({ id: stage.id, name: stage.name })),
      );
      expect(stagesBeforeClear, profile.name).toHaveLength(2);
      const adjacentStage = stagesBeforeClear?.find((stage) => stage.id !== initialStage.id);
      expect(adjacentStage, profile.name).toBeDefined();
      if (adjacentStage === undefined) {
        throw new Error(`${profile.name}: adjacent stage unavailable`);
      }
      await press(
        wizard.getByRole("button", { name: initialStage.name, exact: true }),
        profile.coarsePointer,
      );
      await test.info().attach(`${profile.name}-before-clear.yaml`, {
        body: await wizard.ariaSnapshot(),
        contentType: "text/yaml",
      });

      await press(clearButton, profile.coarsePointer);
      await expect(clearButton, profile.name).toBeHidden();
      await expect(deleteButton, profile.name).toBeVisible();
      await expect.poll(() => page.evaluate((stageId) =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.find((stage) => stage.id === stageId)?.entries.length,
        initialStage.id,
      ), { message: profile.name }).toBe(0);

      const deleteColor = await deleteButton.evaluate((button) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--danger)";
        document.body.append(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        return {
          actual: getComputedStyle(button).color,
          danger,
        };
      });
      expect(deleteColor.actual, profile.name).toBe(deleteColor.danger);

      await press(deleteButton, profile.coarsePointer);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.map((stage) => stage.id),
      ), { message: profile.name }).toEqual([adjacentStage.id]);
      await expect(wizard.getByRole("button", { name: adjacentStage.name, exact: true }), profile.name)
        .toHaveClass(/is-active/);

      await press(page.getByRole("button", { name: "删除阶段", exact: true }), profile.coarsePointer);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost?.internalState.workbench.toolbox.moduleBalancing
          .canvases[0]?.stages.length,
      ), { message: profile.name }).toBe(0);
      await expect(wizard.getByRole("button", { name: "画布", exact: true }), profile.name)
        .toHaveClass(/is-active/);
      await test.info().attach(`${profile.name}-after-delete.yaml`, {
        body: await wizard.ariaSnapshot(),
        contentType: "text/yaml",
      });
    } finally {
      await context.close();
    }
    // AI-REMOVED 2026-08-30:
    // Reason: 原结束符关闭单个测试内的 profile 循环与外层测试；拆分后结束符改为关闭当前 profile 测试与注册循环。
    // Trigger: 三种 Screen Profile 必须拥有独立 Playwright 超时预算。
    // Evidence: .temp/full-check/runs/20260829-150117-854748/e2e.log 显示原测试在 90 秒总超时后终止。
    // Replacement: 紧随其后的 `});` 与 `}`。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    //   }
    // });
  });
}

async function press(button: Locator, coarsePointer: boolean): Promise<void> {
  if (coarsePointer) {
    await button.tap();
    return;
  }

  await button.click();
}
