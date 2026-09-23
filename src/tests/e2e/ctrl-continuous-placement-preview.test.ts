import { expect, test } from "playwright/test";

const SCREEN_PROFILES = [
  { name: "mobile", width: 764, height: 345, dpr: 3.125, isMobile: true },
  { name: "tablet", width: 711, height: 665, dpr: 3.125, isMobile: true },
  { name: "desktop", width: 2552, height: 1315, dpr: 1, isMobile: false },
] as const;

for (const profile of SCREEN_PROFILES) {
  test(`Ctrl 连续放置后，新预览与刚放下的设备位置和方向一致 [${profile.name}]`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      hasTouch: true,
      isMobile: profile.isMobile,
      locale: "zh-CN",
    });

    try {
      if (!profile.isMobile) {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 1 });
        });
      }
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:4174/");
      await expect(page.locator("canvas").first()).toBeVisible();
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost?.workspace.editor?.state.viewport.clientRect.width ?? 0,
      )).toBeGreaterThan(0);

      await page.getByRole("button", { name: "装备原件机", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__industrialPlannerAppHost?.state.activeTool))
        .toBe("single-placement");

      const viewport = await page.evaluate(() =>
        window.__industrialPlannerAppHost!.workspace.editor!.state.viewport.clientRect,
      );
      const firstPoint = {
        x: viewport.left + viewport.width * 0.54,
        y: viewport.top + viewport.height * 0.48,
      };
      const placementPoint = {
        x: viewport.left + viewport.width * 0.72,
        y: viewport.top + viewport.height * 0.63,
      };
      await page.mouse.move(firstPoint.x, firstPoint.y);
      await expect.poll(() => page.evaluate(() =>
        window.__industrialPlannerAppHost!.workspace.editor!.state.collections.preview.length,
      )).toBe(1);
      const firstPosition = await page.evaluate(() => {
        const editor = window.__industrialPlannerAppHost!.workspace.editor!;
        return editor.queries.getEntityById(editor.state.collections.preview[0]!)!.position;
      });
      await page.mouse.move(placementPoint.x, placementPoint.y);
      await expect.poll(() => page.evaluate(() => {
        const editor = window.__industrialPlannerAppHost!.workspace.editor!;
        return editor.queries.getEntityById(editor.state.collections.preview[0]!)?.position;
      })).not.toEqual(firstPosition);

      await page.keyboard.press("r");
      const before = await page.evaluate(() => {
        const host = window.__industrialPlannerAppHost!;
        const editor = host.workspace.editor!;
        const previewId = editor.state.collections.preview[0]!;
        return {
          preview: editor.queries.getEntityById(previewId)!,
          entityOrder: [...editor.document.getSnapshot().entityOrder],
          anchor: host.internalState.runtime.placementAnchor,
        };
      });
      expect(before.preview.rotation).toBe(90);
      expect(before.anchor).toEqual(await page.evaluate((point) =>
        window.__industrialPlannerAppHost!.workspace.editor!.queries.findGridCellForClientPixelPoint(point),
      placementPoint));
      await testInfo.attach("before.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });

      // AI-REMOVED 2026-09-23:
      // Reason: 用户明确选择在创建后立即按鼠标绝对位置移动，创建瞬间为 0° 不再是失败条件。
      // Trigger: 用户纠正「创建后立刻执行一次移动」作为本次修复语义。
      // Evidence: 编辑器单设备草稿只接受中心格点，鼠标路径可复用 moveCollectionCenterPointTo；本用例仍验证同步后的锚点、最终位置和方向。
      // Replacement: 上方 before.anchor 断言及下方 after.preview 的位置、方向断言。
      // Risk: Low；初始草稿姿态不再被本用例单独观测。
      // Human Review: Required
      //
      // Original code:
      // await page.evaluate(() => {
      //   const editor = window.__industrialPlannerAppHost!.workspace.editor!;
      //   const createDraft = editor.actions.createSinglePlacementDraft;
      //   editor.actions.createSinglePlacementDraft = (...args) => {
      //     createDraft(...args);
      //     const draftId = editor.state.collections.preview[0];
      //     const draft = draftId === undefined ? null : editor.queries.getEntityById(draftId);
      //     (window as unknown as { __ctrlPlacementCreatedPose?: unknown }).__ctrlPlacementCreatedPose = draft === null
      //       ? null
      //       : { position: { ...draft.position }, rotation: draft.rotation };
      //   };
      // });

      await page.keyboard.down("Control");
      try {
        await page.mouse.click(placementPoint.x, placementPoint.y);
      } finally {
        await page.keyboard.up("Control");
      }

      const after = await page.evaluate(() => {
        const host = window.__industrialPlannerAppHost!;
        const editor = host.workspace.editor!;
        const snapshot = editor.document.getSnapshot();
        const previewId = editor.state.collections.preview[0];
        return {
          activeTool: host.state.activeTool,
          preview: previewId === undefined ? null : editor.queries.getEntityById(previewId),
          entityOrder: [...snapshot.entityOrder],
          entities: snapshot.entities,
        };
      });
      await testInfo.attach("after.yaml", {
        body: await page.locator("body").ariaSnapshot(),
        contentType: "text/yaml",
      });
      await page.screenshot({ path: testInfo.outputPath(`ctrl-placement-${profile.name}.png`) });

      const placedIds = after.entityOrder.filter((id) => !before.entityOrder.includes(id));
      expect(placedIds).toHaveLength(1);
      const placed = after.entities[placedIds[0]!]!;
      expect(after.activeTool).toBe("single-placement");
      expect(after.preview?.definitionId).toBe("winder_1");
      expect(placed.definitionId).toBe("winder_1");
      expect(placed.position).toEqual(before.preview.position);
      expect(placed.rotation).toBe(90);
      expect(after.preview?.rotation).toBe(90);
      expect(after.preview?.position).toEqual(placed.position);
      // AI-REMOVED 2026-09-23:
      // Reason: 用户明确接受创建后同步按绝对鼠标位置回正，初始 0° 草稿姿态不再是回归判据。
      // Trigger: 单设备连续放置改为复用既有的鼠标绝对定位动作。
      // Evidence: 上方锚点断言及 after.preview 与 placed 的位置、方向断言覆盖实际可见结果。
      // Replacement: expect(before.anchor) 与 expect(after.preview?.position/rotation)。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // expect(await page.evaluate(() =>
      //   (window as unknown as { __ctrlPlacementCreatedPose?: unknown }).__ctrlPlacementCreatedPose,
      // )).toEqual({ position: placed.position, rotation: placed.rotation });
    } finally {
      await context.close();
    }
  });
}
