import { SCREEN_PROFILES as profiles } from "./harness/profiles";
import { expect, test, type Page } from "./harness/fixture";

// AI-REMOVED 2026-10-05:
// Reason: 屏幕尺寸、DPR 与触控设置收敛到唯一来源。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: harness/profiles.ts
// Risk: Low。Human Review: Required
// Original code:
// const profiles = [
//   { name: "mobile", width: 764, height: 345, dpr: 3.125, isMobile: true },
//   { name: "tablet", width: 711, height: 665, dpr: 3.125, isMobile: true },
//   { name: "desktop", width: 2552, height: 1315, dpr: 1, isMobile: false },
// ] as const;

// AI-REMOVED 2026-10-05:
// Reason: 独立屏幕或主题用例不应因前项失败而跳过。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: playwright.config.ts 的 workers: 1
// Risk: Low。Human Review: Required
// Original code:
// test.describe.configure({ mode: "serial" });

for (const profile of profiles) {
  test(`物流提示：画布鼠标、触控与双语提示显示 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
    test.setTimeout(90_000);
    // AI-REMOVED 2026-10-05:
    // Reason: 配置与主指针模拟收敛到公共入口。
    // Trigger: E2E 基座迁移。Evidence: 每个用例曾重复配置同一 Screen Profile。
    // Replacement: ManagedBrowser.profile 与 harness/profiles.ts。
    // Risk: Low。Human Review: Required
    // Original code:
    //     const context = await browser.newContext({
    //       viewport: { width: profile.width, height: profile.height },
    //       deviceScaleFactor: profile.dpr,
    //       isMobile: profile.isMobile,
    //       hasTouch: true,
    //       locale: "zh-CN",
    //     });
    const context = await browser.profile(profile);
    try {
      await context.addInitScript(() => {
        localStorage.setItem("v3-app-settings", JSON.stringify({
          locale: "zh-CN",
          hypergryphAllowEmptyLogisticsEndpoints: false,
          gamePlayDeviceAudio: false,
        }));
        // 桌面支持触控，但主指针仍是鼠标；不把 coarse 模拟误认成平板。
        // AI-REMOVED 2026-10-05:
        // Reason: 桌面触控与主指针设置只保留一个实现。
        // Trigger: E2E 基座迁移。Evidence: ManagedBrowser.profile 已安装统一 Screen Profile。
        // Replacement: harness/profiles.ts installDesktopPointer。Risk: Low。Human Review: Required
        // Original code:
        // if (desktop) {
        //   const nativeMatchMedia = window.matchMedia.bind(window);
        //   window.matchMedia = (query) => {
        //     const result = nativeMatchMedia(query);
        //     if (query !== "(pointer: coarse)" && query !== "(hover: none)") return result;
        //     return new Proxy(result, {
        //       get(target, property) {
        //         if (property === "matches") return false;
        //         const value = Reflect.get(target, property, target) as unknown;
        //         return typeof value === "function" ? value.bind(target) : value;
        //       },
        //     });
        //   };
        // }
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto("/");
      await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.render);
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.state.screenProfile)).toMatchObject({
        deviceClass: profile.name,
        viewportWidth: profile.width,
        viewportHeight: profile.height,
        devicePixelRatio: profile.dpr,
        hasTouch: true,
      });
      const canvas = page.getByRole("main");
      await canvas.click({ position: { x: 250, y: 150 } });
      await page.keyboard.press("e");
      await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.beltStart", toast: null });
      const rect = await canvas.boundingBox();
      if (rect === null) throw new Error("画布未布局");
      const point = { x: rect.x + rect.width * 0.55, y: rect.y + rect.height * 0.55 };
      await page.mouse.move(point.x, point.y);
      expect((await readNotices(page)).toast).toBeNull();
      await page.mouse.click(point.x, point.y);
      await expect(page.locator(".canvas-toast")).toContainText("请从设备出口");
      await expect(page.locator(".canvas-mode-alert")).toContainText("传送带需从");
      await page.screenshot({ path: testInfo.outputPath(`${profile.name}-notices.png`) });

      await page.touchscreen.tap(point.x, point.y);
      await expect.poll(() => readNotices(page)).toMatchObject({ toast: "canvas.toast.beltStart" });
      await page.keyboard.press("q");
      await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.pipeStart" });
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => readNotices(page)).toMatchObject({ toast: "canvas.toast.pipeStart" });
      await page.keyboard.press("Escape");
      expect(await readNotices(page)).toMatchObject({ alert: null, toast: "canvas.toast.pipeStart" });

      await page.keyboard.press("e");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog.locator('label[for="setting-game-arknights-allow-empty-logistics-endpoints"]').click();
      await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.beltStartWithEmpty" });
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(page.locator(".canvas-mode-alert strong")).toContainText(["设备与物流出口", "空地", "其他传送带"]);
      await page.mouse.click(point.x, point.y);
      await expect.poll(() => readNotices(page)).toMatchObject({ phase: "drawing", alert: null, toast: null });
      await page.mouse.click(point.x, point.y, { button: "right" });
      await expect.poll(() => readNotices(page)).toMatchObject({ phase: "idle", alert: "canvas.alert.beltStartWithEmpty" });
      await page.evaluate(() => window.__industrialPlannerAppHost!.internalActions.setLocale("en-US"));
      await expect(page.locator(".canvas-mode-alert")).toContainText("empty ground");
      await page.screenshot({ path: testInfo.outputPath(`${profile.name}-english.png`) });

      expect(pageErrors).toEqual([]);
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function readNotices(page: Page) {
  return page.evaluate(() => {
    const runtime = window.__industrialPlannerAppHost!.internalState.runtime;
    return { toast: runtime.canvasToastKey, alert: runtime.canvasAlertKey, phase: runtime.logisticsPlacement.phase };
  });
}

// AI-REMOVED 2026-10-15:
// Reason: 三秒计时、同消息续时、异消息覆盖和销毁使用 fake timers；每屏不再人为等待 9.7 秒及额外轮询。
// Trigger: 用户要求已由 Vitest 验证及与屏幕、外部设施无关的行为不再重复执行 E2E。
// Evidence: 对照真实主机测试与本文件原断言，业务状态不依赖浏览器布局。
// Replacement: src/tests/app/canvas-notices.test.ts；本文件保留画布原生事件
// Risk: 浏览器特有行为仍由保留用例验证；测试分层变更需人工复核。
// Human Review: Required
//
// Original code:
// import { SCREEN_PROFILES as profiles } from "./harness/profiles";
// import { expect, test, type Page } from "./harness/fixture";
//
// // AI-REMOVED 2026-10-05:
// // Reason: 屏幕尺寸、DPR 与触控设置收敛到唯一来源。
// // Trigger: 用户授权统一 E2E 基座。
// // Evidence: 当前用例重复管理相同运行资源。
// // Replacement: harness/profiles.ts
// // Risk: Low。Human Review: Required
// // Original code:
// // const profiles = [
// //   { name: "mobile", width: 764, height: 345, dpr: 3.125, isMobile: true },
// //   { name: "tablet", width: 711, height: 665, dpr: 3.125, isMobile: true },
// //   { name: "desktop", width: 2552, height: 1315, dpr: 1, isMobile: false },
// // ] as const;
//
// // AI-REMOVED 2026-10-05:
// // Reason: 独立屏幕或主题用例不应因前项失败而跳过。
// // Trigger: 用户授权统一 E2E 基座。
// // Evidence: 当前用例重复管理相同运行资源。
// // Replacement: playwright.config.ts 的 workers: 1
// // Risk: Low。Human Review: Required
// // Original code:
// // test.describe.configure({ mode: "serial" });
//
// for (const profile of profiles) {
//   test(`物流提示：事件续时、模式状态与空地设置 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
//     test.setTimeout(90_000);
//     // AI-REMOVED 2026-10-05:
//     // Reason: 配置与主指针模拟收敛到公共入口。
//     // Trigger: E2E 基座迁移。Evidence: 每个用例曾重复配置同一 Screen Profile。
//     // Replacement: ManagedBrowser.profile 与 harness/profiles.ts。
//     // Risk: Low。Human Review: Required
//     // Original code:
//     //     const context = await browser.newContext({
//     //       viewport: { width: profile.width, height: profile.height },
//     //       deviceScaleFactor: profile.dpr,
//     //       isMobile: profile.isMobile,
//     //       hasTouch: true,
//     //       locale: "zh-CN",
//     //     });
//     const context = await browser.profile(profile);
//     try {
//       await context.addInitScript(() => {
//         localStorage.setItem("v3-app-settings", JSON.stringify({
//           locale: "zh-CN",
//           hypergryphAllowEmptyLogisticsEndpoints: false,
//           gamePlayDeviceAudio: false,
//         }));
//         // 桌面支持触控，但主指针仍是鼠标；不把 coarse 模拟误认成平板。
//         // AI-REMOVED 2026-10-05:
//         // Reason: 桌面触控与主指针设置只保留一个实现。
//         // Trigger: E2E 基座迁移。Evidence: ManagedBrowser.profile 已安装统一 Screen Profile。
//         // Replacement: harness/profiles.ts installDesktopPointer。Risk: Low。Human Review: Required
//         // Original code:
//         // if (desktop) {
//         //   const nativeMatchMedia = window.matchMedia.bind(window);
//         //   window.matchMedia = (query) => {
//         //     const result = nativeMatchMedia(query);
//         //     if (query !== "(pointer: coarse)" && query !== "(hover: none)") return result;
//         //     return new Proxy(result, {
//         //       get(target, property) {
//         //         if (property === "matches") return false;
//         //         const value = Reflect.get(target, property, target) as unknown;
//         //         return typeof value === "function" ? value.bind(target) : value;
//         //       },
//         //     });
//         //   };
//         // }
//       });
//       const page = await context.newPage();
//       const pageErrors: string[] = [];
//       page.on("pageerror", (error) => pageErrors.push(error.message));
//       await page.goto("/");
//       await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.render);
//       expect(await page.evaluate(() => window.__industrialPlannerAppHost!.state.screenProfile)).toMatchObject({
//         deviceClass: profile.name,
//         viewportWidth: profile.width,
//         viewportHeight: profile.height,
//         devicePixelRatio: profile.dpr,
//         hasTouch: true,
//       });
//       const canvas = page.getByRole("main");
//       await canvas.click({ position: { x: 250, y: 150 } });
//       await page.keyboard.press("e");
//       await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.beltStart", toast: null });
//       const rect = await canvas.boundingBox();
//       if (rect === null) throw new Error("画布未布局");
//       const point = { x: rect.x + rect.width * 0.55, y: rect.y + rect.height * 0.55 };
//       await page.mouse.move(point.x, point.y);
//       expect((await readNotices(page)).toast).toBeNull();
//       await page.mouse.click(point.x, point.y);
//       await expect(page.locator(".canvas-toast")).toContainText("请从设备出口");
//       await expect(page.locator(".canvas-mode-alert")).toContainText("传送带需从");
//       await page.screenshot({ path: testInfo.outputPath(`${profile.name}-notices.png`) });
//
//       // 第一次计时到期后，第二次相同消息仍应存在。
//       await page.mouse.click(point.x, point.y);
//       await page.waitForTimeout(1200);
//       await page.mouse.click(point.x, point.y);
//       await page.waitForTimeout(2100);
//       expect((await readNotices(page)).toast).toBe("canvas.toast.beltStart");
//       await expect.poll(() => readNotices(page)).toMatchObject({ toast: null, alert: "canvas.alert.beltStart" });
//
//       await page.touchscreen.tap(point.x, point.y);
//       await expect.poll(() => readNotices(page)).toMatchObject({ toast: "canvas.toast.beltStart" });
//       await page.keyboard.press("q");
//       await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.pipeStart" });
//       await page.mouse.click(point.x, point.y);
//       await expect.poll(() => readNotices(page)).toMatchObject({ toast: "canvas.toast.pipeStart" });
//       await page.keyboard.press("Escape");
//       expect(await readNotices(page)).toMatchObject({ alert: null, toast: "canvas.toast.pipeStart" });
//
//       await page.keyboard.press("e");
//       await page.getByRole("button", { name: "设置", exact: true }).click();
//       const dialog = page.getByRole("dialog", { name: "设置", exact: true });
//       await dialog.locator('label[for="setting-game-arknights-allow-empty-logistics-endpoints"]').click();
//       await expect.poll(() => readNotices(page)).toMatchObject({ alert: "canvas.alert.beltStartWithEmpty" });
//       await dialog.getByRole("button", { name: "关闭", exact: true }).click();
//       await expect(page.locator(".canvas-mode-alert strong")).toContainText(["设备与物流出口", "空地", "其他传送带"]);
//       await expect.poll(() => readNotices(page)).toMatchObject({ toast: null });
//       await page.mouse.click(point.x, point.y);
//       await expect.poll(() => readNotices(page)).toMatchObject({ phase: "drawing", alert: null, toast: null });
//       await page.mouse.click(point.x, point.y, { button: "right" });
//       await expect.poll(() => readNotices(page)).toMatchObject({ phase: "idle", alert: "canvas.alert.beltStartWithEmpty" });
//       await page.evaluate(() => window.__industrialPlannerAppHost!.internalActions.setLocale("en-US"));
//       await expect(page.locator(".canvas-mode-alert")).toContainText("empty ground");
//       await page.screenshot({ path: testInfo.outputPath(`${profile.name}-english.png`) });
//
//       // 通用 action 的覆盖与销毁契约，使用真实 AppHost，不构造替身。
//       await page.evaluate(() => window.__industrialPlannerAppHost!.internalActions.showCanvasToast("canvas.toast.beltStart"));
//       await page.waitForTimeout(1200);
//       await page.evaluate(() => window.__industrialPlannerAppHost!.internalActions.showCanvasToast("canvas.toast.pipeStart"));
//       await page.waitForTimeout(2100);
//       expect((await readNotices(page)).toast).toBe("canvas.toast.pipeStart");
//       await expect.poll(() => readNotices(page)).toMatchObject({ toast: null });
//       await page.evaluate(() => {
//         const host = window.__industrialPlannerAppHost!;
//         host.internalActions.showCanvasToast("canvas.toast.beltStart");
//         host.dispose();
//         host.internalActions.showCanvasToast("canvas.toast.pipeStart");
//       });
//       await page.waitForTimeout(3100);
//       expect(await readNotices(page)).toMatchObject({ toast: null, alert: null });
//       expect(pageErrors).toEqual([]);
//     } finally {
//       await browser.closeContext(context);
//     }
//   });
// }
//
// async function readNotices(page: Page) {
//   return page.evaluate(() => {
//     const runtime = window.__industrialPlannerAppHost!.internalState.runtime;
//     return { toast: runtime.canvasToastKey, alert: runtime.canvasAlertKey, phase: runtime.logisticsPlacement.phase };
//   });
// }
