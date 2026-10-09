import blueprint from "../fixtures/blueprints/e2e/copy-selection.schema7.json" with { type: "json" };
import { waitForAppReady, expectCanvasHit } from "./harness/workbench";
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
//   { name: "mobile", width: 764, height: 345, dpr: 3.125 },
//   { name: "tablet", width: 711, height: 665, dpr: 3.125 },
//   { name: "desktop", width: 2552, height: 1315, dpr: 1 },
// ] as const;

// 开发期 playwright-cli 三屏验证后独立编写；正式执行仍需单 worker 串行运行。
// AI-REMOVED 2026-10-05:
// Reason: 独立屏幕或主题用例不应因前项失败而跳过。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: playwright.config.ts 的 workers: 1
// Risk: Low。Human Review: Required
// Original code:
// test.describe.configure({ mode: "serial" });

for (const profile of profiles) {
  test(`复制连续放置后返回原选区，剪切粘贴不继承返回状态 [${profile.name}]`, async ({ browserSession: browser }, testInfo) => {
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
    //       hasTouch: profile.name !== "desktop",
    //       isMobile: profile.name !== "desktop",
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
      //       if (profile.name === "desktop") {
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
      await waitForAppReady(page, profile);
      // AI-REMOVED 2026-10-05:
      // Reason: 用完整版本化场景装载替代逐个构造，选择通过浏览器点击。
      // Trigger: 用户授权基座与用例迁移。
      // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
      // Replacement: window.__test__.loadBlueprint 与 clickEntity
      // Risk: Low。Human Review: Required
      // Original code:
      //       const ids = await page.evaluate(() => {
      //         const editor = window.__industrialPlannerAppHost!.workspace.editor!;
      //         const existing = new Set(editor.document.getSnapshot().entityOrder);
      //         for (const x of [15, 17]) {
      //           editor.actions.createSinglePlacementDraft("belt_straight_1x1", { x, y: 15 });
      //           if (!editor.actions.applyPlacementDraft()) throw new Error("准备复制放置场景失败");
      //         }
      //         const result = editor.document.getSnapshot().entityOrder.filter((id) => !existing.has(id));
      //         editor.actions.focusOnEntity(result[0]!, { duration: 100 });
      //         for (const entityId of result) {
      //           editor.actions.addToCollection({ collectionType: "selection", entityId });
      //         }
      //         return result;
      //       });
      const scene = await page.evaluate(input => window.__test__!.loadBlueprint(input), blueprint);
      const ids = scene.entityIds;
      // AI-REMOVED 2026-10-05:
      // Reason: 选择工具的 Control+click 不会建立多选；应先进入框选工具。
      // Trigger: 用例从直接状态写入改为真实交互。
      // Evidence: hypergryph-select-gesture-module 始终选择单一实体。
      // Replacement: 下方框选工具点击。Risk: Low。Human Review: Required
      // Original code:
      //       await clickEntity(page, ids[0]!);
      //       await page.keyboard.down("Control");
      //       try {
      //         const point = await page.evaluate(id => window.__test__!.entityPoint(id), ids[1]!);
      //         await page.mouse.click(point.x, point.y);
      //       } finally { await page.keyboard.up("Control"); }
      await page.evaluate(id => window.__test__!.focusEntity(id), ids[0]!);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost!.workspace.editor!.state.viewport.center.x,
      )).toBe(15.5);
      await page.evaluate(() => window.__industrialPlannerAppHost!.workspace.editor!.actions.zoom(-12));
      await page.getByRole("button", { name: "批量选择", exact: true }).click();
      for (const id of ids) {
        const point = await page.evaluate(value => window.__test__!.entityPoint(value), id);
        await page.mouse.click(point.x, point.y);
      }
      await expect.poll(() => readSelection(page)).toMatchObject({ tool: "marquee", ids });
      const closeDock = page.getByRole("button", { name: "关闭 右侧", exact: true });
      if (await closeDock.isVisible()) await closeDock.click();
      await testInfo.attach("before.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await page.keyboard.press("Control+c");
      expect(await readSelection(page)).toMatchObject({ tool: "blueprint-placement", ids, continuous: true });
      await page.keyboard.press("Escape");
      expect(await readSelection(page)).toMatchObject({ tool: "marquee", ids, preview: 0 });

      await page.keyboard.press("Control+c");
      const beforeCount = (await readSelection(page)).count;
      for (const x of [22, 27]) {
        await placeAt(page, x, 15);
      }
      expect(await readSelection(page)).toMatchObject({
        tool: "blueprint-placement", ids, count: beforeCount + 4, preview: 2,
      });
      const canvas = await page.locator("canvas").first().boundingBox();
      if (canvas === null) throw new Error("画布不可见");
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { button: "right" });
      expect(await readSelection(page)).toMatchObject({ tool: "marquee", ids, preview: 0 });
      await page.screenshot({ path: testInfo.outputPath("copy-selection-return.png") });
      await testInfo.attach("after.yaml", { body: await page.locator("body").ariaSnapshot(), contentType: "text/yaml" });

      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      await page.keyboard.press("Escape");
      expect(await readSelection(page)).toMatchObject({ tool: "select", ids: [], preview: 0 });
      await page.keyboard.press("x");
      // AI-REMOVED 2026-10-05:
      // Reason: 被测选区通过真实点击建立。
      // Trigger: 用户授权基座与用例迁移。
      // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
      // Replacement: 下方 Control+click
      // Risk: Low。Human Review: Required
      // Original code:
      //       await page.evaluate((selectedIds) => {
      //         const editor = window.__industrialPlannerAppHost!.workspace.editor!;
      //         for (const entityId of selectedIds) editor.actions.addToCollection({ collectionType: "selection", entityId });
      //       }, ids);
      await page.keyboard.down("Control");
      try {
        for (const id of ids) {
          const point = await page.evaluate(value => window.__test__!.entityPoint(value), id);
          await page.mouse.click(point.x, point.y);
        }
      } finally { await page.keyboard.up("Control"); }
      await page.keyboard.press("Control+x");
      expect(await readSelection(page)).toMatchObject({ tool: "blueprint-placement", ids: [], count: beforeCount + 2 });
      await page.keyboard.press("Escape");
      expect(await readSelection(page)).toMatchObject({ tool: "select", ids: [], preview: 0 });
      await page.keyboard.press("x");
      expect((await readSelection(page)).tool).toBe("marquee");
      await page.keyboard.press("x");
      expect((await readSelection(page)).tool).toBe("select");
    } finally {
      await browser.closeContext(context);
    }
  });
}

async function readSelection(page: Page) {
  // AI-REMOVED 2026-10-05:
  // Reason: 通用只读断言使用稳定快照。
  // Trigger: 用户授权基座与用例迁移。
  // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
  // Replacement: window.__test__.getAppState
  // Risk: Low。Human Review: Required
  // Original code:
  //   return page.evaluate(() => {
  //     const host = window.__industrialPlannerAppHost!;
  //     const editor = host.workspace.editor!;
  //     return {
  //       tool: host.state.activeTool,
  //       ids: [...editor.state.collections.selection],
  //       preview: editor.state.collections.preview.length,
  //       count: editor.document.getSnapshot().entityOrder.length,
  //       continuous: host.internalState.runtime.blueprintPlacementContinuous,
  //     };
  //   });
  return page.evaluate(() => {
    const state = window.__test__!.getAppState();
    return { tool: state.tool, ids: state.selection, preview: state.previewCount,
      count: state.entityCount, continuous: state.continuousPlacement };
  });
}

async function placeAt(page: Page, x: number, y: number) {
  // AI-REMOVED 2026-10-05:
  // Reason: 坐标转换使用基座只读接口。
  // Trigger: 用户授权基座与用例迁移。
  // Evidence: 固定布景必须版本化；测试动作通过真实事件触发。
  // Replacement: window.__test__.gridPoint
  // Risk: Low。Human Review: Required
  // Original code:
  //   const point = await page.evaluate((gridPoint) => {
  //     const rect = window.__industrialPlannerAppHost!.workspace.editor!.queries.findClientRectForGridCell(gridPoint);
  //     if (rect === null) throw new Error("无法定位放置坐标");
  //     return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  //   }, { x, y });
  const point = await page.evaluate(grid => window.__test__!.gridPoint(grid), { x, y });
  await expectCanvasHit(page, point);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
}
