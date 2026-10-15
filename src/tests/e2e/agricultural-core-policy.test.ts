// 核心过滤及持久化迁入 Vitest；原生蓝图文件与画布交互复用现有浏览器用例。

// AI-REMOVED 2026-10-15:
// Reason: 核心过滤、位置与链接清理都是 Editor 文档规则，三屏重复执行没有额外覆盖。
// Trigger: 用户要求已由 Vitest 验证及与屏幕、外部设施无关的行为不再重复执行 E2E。
// Evidence: 对照真实主机测试与本文件原断言，业务状态不依赖浏览器布局。
// Replacement: src/tests/editor/agricultural-core-policy.test.ts；clipboard-cut-paste.test.ts；draft-box-protocol-core.test.ts
// Risk: 浏览器特有行为仍由保留用例验证；测试分层变更需人工复核。
// Human Review: Required
//
// Original code:
// import { writeFile } from "node:fs/promises";
// import { resolve } from "node:path";
// import type { WorldDocument } from "@/domain/document/world-document";
// import { expect, test } from "./harness/fixture";
// import { SCREEN_PROFILES } from "./harness/profiles";
//
// interface CorePolicyReport {
//   readonly initialCount: number;
//   readonly previewDefinitions: readonly string[];
//   readonly placed: WorldDocument;
//   readonly reloaded: WorldDocument;
// }
//
// for (const profile of SCREEN_PROFILES) {
//   test(`农牧用地不生成核心，含两种核心的蓝图只放下其他设备 [${profile.name}]`, async ({ browserSession }) => {
//     test.setTimeout(150_000);
//     const cli = await browserSession.openCli(profile);
//     // 被测动作就是摆放蓝图；输入保存版本与两种核心，并在两块区域各保留一台普通设备。
//     const entities = [
//       { id: "primary", definitionId: "sp_hub_1", x: 0, y: 0 },
//       { id: "secondary", definitionId: "sp_sub_hub_1", x: 50, y: 0 },
//       { id: "left", definitionId: "belt_straight_1x1", x: 12, y: 12 },
//       { id: "right", definitionId: "belt_straight_1x1", x: 62, y: 12 },
//     ].map(({ id, definitionId, x, y }) => ({
//       id, definitionId, position: { x, y }, rotation: 0, config: {}, tags: [],
//     }));
//     const blueprint = {
//       schemaVersion: 7, blueprintId: "agricultural-core-policy", version: "1",
//       name: "农牧用地核心禁放回归", description: "", baseId: "wuling_protocol_core",
//       initialGridPoint: { x: 35, y: 10 },
//       entities: Object.fromEntries(entities.map(entity => [entity.id, entity])),
//       entityOrder: entities.map(entity => entity.id),
//       slotLinks: [{
//         id: "core-warehouse-link", linkType: "share-all",
//         source: { entityId: "primary", storageSlotGroupId: "unbuffer_w2", slotId: "output_w2_slot_1" },
//         target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item" },
//       }],
//       regions: [], createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z",
//     };
//     const blueprintPath = resolve(cli.directory, "core-policy.schema7.json");
//     await writeFile(blueprintPath, JSON.stringify(blueprint));
//
//     const report = await cli.runJson(`async page => {
//       await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });
//       const ready = async () => page.waitForFunction(() => {
//         const status = window.__test__?.readiness();
//         return status?.assembled && status.canvasAttached && status.viewportValid;
//       });
//       await ready();
//       const toolbar = page.locator('aside[class*="left-toolbar"]');
//       const baseButton = toolbar.getByRole('button', { name: '基地', exact: true });
//       if (await baseButton.getAttribute('aria-pressed') !== 'true') await baseButton.click();
//       await page.locator('[data-ui-button-id="base-current-select"]').click();
//       const dialog = page.getByRole('dialog', { name: '选择基地', exact: true });
//       await dialog.locator('[data-base-id="wuling_agricultural_land"]').click();
//       await dialog.getByRole('button', { name: '确定', exact: true }).click();
//       await page.waitForFunction(() => window.__test__.getAppState().baseId === 'wuling_agricultural_land');
//       if (await baseButton.getAttribute('aria-pressed') === 'true') await baseButton.click();
//       const initialCount = await page.evaluate(() => window.__test__.document().entityOrder.length);
//
//       // 只准备视口；导入、进入摆放和确认均使用原生浏览器事件。
//       await page.evaluate(() => {
//         const editor = window.__industrialPlannerAppHost.workspace.editor;
//         editor.actions.zoom(-100);
//         const viewport = editor.state.viewport;
//         const startClientPixel = { x: viewport.clientRect.left + viewport.clientRect.width / 2,
//           y: viewport.clientRect.top + viewport.clientRect.height / 2 };
//         editor.actions.moveViewportByClientPixelVector({ startClientPixel, endClientPixel: {
//           x: startClientPixel.x + (viewport.center.x - 35) * viewport.gridCellPixelSize,
//           y: startClientPixel.y + (viewport.center.y - 10) * viewport.gridCellPixelSize } });
//       });
//       await toolbar.getByRole('button', { name: '蓝图模式', exact: true }).click();
//       await page.locator('[data-blueprint-import-file-input]').setInputFiles(${JSON.stringify(blueprintPath)});
//       const save = page.locator('[role="dialog"]').filter({ has: page.locator('button[type="submit"]') });
//       await save.locator('button[type="submit"]').click();
//       await page.locator('[data-blueprint-id]').filter({ hasText: '农牧用地核心禁放回归' }).click();
//       await page.locator('[data-ui-button-id="blueprint-preview-place-button"]').click();
//       await page.waitForFunction(() => window.__test__.getAppState().previewCount === 2);
//       const previewDefinitions = await page.evaluate(() => window.__industrialPlannerAppHost.workspace.editor.internalState.drafts
//         .map(entity => entity.definitionId));
//       const anchor = await page.evaluate(() => window.__test__.gridPoint({ x: 35, y: 10 }));
//       await page.mouse.click(anchor.x, anchor.y);
//       await page.waitForFunction(() => window.__test__.getAppState().entityCount === 2);
//       const placed = await page.evaluate(() => window.__test__.document());
//       await page.keyboard.press('Escape');
//       await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "core-policy-placed.png"))} });
//       await page.reload();
//       await ready();
//       const reloaded = await page.evaluate(() => window.__test__.document());
//       return { initialCount, previewDefinitions, placed, reloaded };
//     }`) as CorePolicyReport;
//
//     expect(report.initialCount).toBe(0);
//     expect(report.previewDefinitions).toEqual(["belt_straight_1x1", "belt_straight_1x1"]);
//     for (const document of [report.placed, report.reloaded]) {
//       expect(document.baseId).toBe("wuling_agricultural_land");
//       expect(document.entityOrder).toHaveLength(2);
//       expect(Object.values(document.entities).map(entity => entity.definitionId))
//         .toEqual(["belt_straight_1x1", "belt_straight_1x1"]);
//       expect(document.slotLinks).toEqual([]);
//       expect(Object.values(document.entities).every(entity => entity.position.x >= 0 && entity.position.x < 20
//         || entity.position.x >= 50 && entity.position.x < 70)).toBe(true);
//     }
//   });
// }
