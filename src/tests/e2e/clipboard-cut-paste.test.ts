import blueprint from "../fixtures/blueprints/e2e/clipboard-selection.schema7.json" with { type: "json" };
import { waitForAppReady, clickEntity } from "./harness/workbench";
import { SCREEN_PROFILES } from "./harness/profiles";
import { expect, test } from "./harness/fixture";

// AI-REMOVED 2026-10-05:
// Reason: 屏幕尺寸、DPR 与触控设置收敛到唯一来源。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: harness/profiles.ts
// Risk: Low。Human Review: Required
// Original code:
// const SCREEN_PROFILES = [
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

for (const profile of SCREEN_PROFILES) {
  test(`框选剪切并从其他画布工具粘贴 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
    test.setTimeout(90_000);
    // AI-REMOVED 2026-10-05:
    // Reason: 统一三屏配置与指针设置。
    // Trigger: 用户授权基座与用例迁移。
    // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
    // Replacement: ManagedBrowser.profile
    // Risk: Low。Human Review: Required
    // Original code:
    //     const context = await browser.newContext({
    //       viewport: { width: profile.width, height: profile.height },
    //       deviceScaleFactor: profile.dpr,
    //       hasTouch: profile.isMobile,
    //       isMobile: profile.isMobile,
    //       locale: "zh-CN",
    //     });
    const context = await browser.profile(profile);

    try {
      // AI-REMOVED 2026-10-05:
      // Reason: 统一指针设置。
      // Trigger: 用户授权基座与用例迁移。
      // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
      // Replacement: ManagedBrowser.profile
      // Risk: Low。Human Review: Required
      // Original code:
      //       if (!profile.isMobile) {
      //         await context.addInitScript(() => {
      //           Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 1 });
      //         });
      //       }
      await context.addInitScript(() => {
        localStorage.setItem("v3-app-settings", JSON.stringify({ gameUseInspectorPanel: true }));
      });
      const page = await context.newPage();
      await page.goto("/");
      // AI-REMOVED 2026-10-05:
      // Reason: 等待完整装配、画布挂载和有效视口。
      // Trigger: 用户授权基座与用例迁移。
      // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
      // Replacement: waitForAppReady
      // Risk: Low。Human Review: Required
      // Original code:
      //       await expect(page.locator("canvas").first()).toBeVisible();
      //       await expect.poll(() => page.evaluate(() =>
      //         window.__industrialPlannerAppHost?.workspace.editor?.state.viewport.clientRect.width ?? 0,
      //       )).toBeGreaterThan(0);
      //       expect(await page.evaluate(() => window.__industrialPlannerAppHost?.state.screenProfile)).toMatchObject({
      //         viewportWidth: profile.width,
      //         viewportHeight: profile.height,
      //         devicePixelRatio: profile.dpr,
      //         deviceClass: profile.name,
      //         hasTouch: true,
      //       });
      await waitForAppReady(page, profile);
      // AI-REMOVED 2026-10-05:
      // Reason: 用完整版本化场景装载替代逐个构造，选择通过浏览器点击。
      // Trigger: 用户授权基座与用例迁移。
      // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
      // Replacement: window.__test__.loadBlueprint 与 clickEntity
      // Risk: Low。Human Review: Required
      // Original code:
      //       const entityId = await page.evaluate(() => {
      //         const host = window.__industrialPlannerAppHost!;
      //         const editor = host.workspace.editor!;
      //         const beforeIds = new Set(editor.document.getSnapshot().entityOrder);
      //         editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x: 15, y: 15 });
      //         if (!editor.actions.applyPlacementDraft()) {
      //           throw new Error("无法准备剪切测试建筑");
      //         }
      //         const id = editor.document.getSnapshot().entityOrder.find((candidate) => !beforeIds.has(candidate));
      //         if (id === undefined) {
      //           throw new Error("测试建筑未写入文档");
      //         }
      //         editor.actions.focusOnEntity(id, { duration: 0 });
      //         editor.actions.addToCollection({ collectionType: "selection", entityId: id });
      //         return id;
      //       });
      const scene = await page.evaluate(input => window.__test__!.loadBlueprint(input), blueprint);
      const entityId = scene.entityIds[0]!;
      await clickEntity(page, entityId);

      await testInfo.attach("before.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+x");
      expect(await page.evaluate((id) => ({
        tool: window.__industrialPlannerAppHost!.state.activeTool,
        exists: window.__industrialPlannerAppHost!.workspace.editor!.document.getSnapshot().entities[id] !== undefined,
      }), entityId)).toEqual({ tool: "select", exists: true });

      await page.getByRole("button", { name: "批量选择", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.state.activeTool)).toBe("marquee");
      await page.keyboard.press("Control+x");
      const cut = await page.evaluate((id) => {
        const host = window.__industrialPlannerAppHost!;
        const editor = host.workspace.editor!;
        return {
          tool: host.state.activeTool,
          exists: editor.document.getSnapshot().entities[id] !== undefined,
          previewCount: editor.state.collections.preview.length,
          blueprintId: host.internalState.runtime.blueprintPlacementRecord?.blueprintId ?? null,
          sourceIds: host.internalState.runtime.blueprintPlacementRecord?.entityOrder ?? [],
        };
      }, entityId);
      expect(cut.tool).toBe("blueprint-placement");
      expect(cut.exists).toBe(false);
      expect(cut.previewCount).toBe(1);
      expect(cut.sourceIds).toEqual([entityId]);

      await page.keyboard.press("Control+v");
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.internalState.runtime.blueprintPlacementRecord?.blueprintId))
        .toBe(cut.blueprintId);
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.state.activeTool)).toBe("select");
      await page.keyboard.press("Control+v");
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost!.state.activeTool))
        .toBe("blueprint-placement");
      expect(await page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.state.collections.preview.length))
        .toBe(1);
      await page.screenshot({ path: testInfo.outputPath("cut-paste.png") });
      await testInfo.attach("after.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
    } finally {
      await browser.closeContext(context);
    }
  });
}
