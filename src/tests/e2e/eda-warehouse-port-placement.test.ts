// 业务规则迁到 Vitest；错误颜色并入 eda-task-defaults.test.ts，同一浏览器会话验证。

// AI-REMOVED 2026-10-15:
// Reason: 默认值、联动、请求及按钮状态使用普通 DOM 测试，避免单独启动三屏浏览器。
// Trigger: 用户要求去除 Vitest 已覆盖及与屏幕、外部设施无关的 E2E。
// Evidence: 现有真实主机和新增组件断言覆盖配置、持久化与业务状态。
// Replacement: src/tests/app/blueprint-planner-options.test.tsx；eda-task-defaults.test.ts
// Risk: 仅保留真实浏览器目标，迁移覆盖需人工复核。
// Human Review: Required
//
// Original code:
// import { expect, test, SCREEN_PROFILES } from "./harness/fixture";
// import separator from "../blueprint-planner/fixtures/separator-core.json" with { type: "json" };
//
// // 三屏开发验证后独立编写；原生选项交互与请求状态同时验证。
// for (const profile of SCREEN_PROFILES) {
//   test(`取货口规则默认值、单面联动与非法固体供料 [${profile.name}]`, async ({ baseURL, browserSession }) => {
//     test.setTimeout(120000);
//     const cli = await browserSession.openCli(profile);
//     const result = await cli.runJson(`async page => {
//       await page.addInitScript(() => {
//         const settings = JSON.parse(localStorage.getItem('v3-user-settings-dialog') || '{}');
//         settings.values = {...settings.values, 'other-experimental-features': true};
//         localStorage.setItem('v3-user-settings-dialog', JSON.stringify(settings));
//       });
//       await page.goto(${JSON.stringify(baseURL)});
//       await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.blueprintPlanner != null);
//       await page.evaluate(plan => {
//         const controller = window.__industrialPlannerAppHost.blueprintPlannerDialog;
//         // AI-REMOVED 2026-10-14:
//         // Reason: 自动规划产线（EDA）转为正式功能，不再保留实验性启用开关。
//         // Trigger: 用户要求 EDA 默认可用且不再需要开启。
//         // Evidence: 设置注册、控制器持久化和三处入口均依赖同一实验性开关。
//         // Replacement: 测试直接打开正式 EDA 入口，不再调用已移除的 setEnabled。
//         // Risk: Low；规划任务与业务可用性校验保持原行为。
//         // Human Review: Required
//         //
//         // Original code:
//         //         controller.setEnabled(true); controller.open(plan);
//         controller.open(plan);
//       }, ${JSON.stringify(separator.request.plan)});
//       const dialog = page.getByRole('dialog').filter({has:page.locator('#blueprint-planner-title')});
//       const rule = dialog.getByRole('combobox',{name:'取货口摆放规则',exact:true});
//       const bus = dialog.getByRole('combobox',{name:'存取线形态',exact:true});
//       const initial = await rule.inputValue();
//       await bus.selectOption('corner'); await rule.selectOption('full-side');
//       const linked = {value:await bus.inputValue(),disabled:await bus.isDisabled()};
//       const supply = dialog.locator('select').filter({has:page.locator('option[value="external"]')}).first();
//       await supply.selectOption('external');
//       const invalid = {marked:await supply.getAttribute('aria-invalid'),disabled:await dialog.getByRole('button',{name:'开始规划',exact:true}).isDisabled(),
//         red:await supply.evaluate(element => {
//           const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; element.parentElement.append(probe);
//           const color = getComputedStyle(probe).color; probe.remove();
//           return getComputedStyle(element).color === color && getComputedStyle(element).borderTopColor === color;
//         })};
//       const request = await page.evaluate(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.getRequest());
//       await supply.selectOption('warehouse');
//       const corrected = !await dialog.getByRole('button',{name:'开始规划',exact:true}).isDisabled();
//       await rule.selectOption('continuous');
//       return {initial,linked,invalid,request,corrected,unlocked:!await bus.isDisabled()};
//     }`) as { initial: string; linked: { value: string; disabled: boolean }; invalid: { marked: string; disabled: boolean; red: boolean };
//       request: { options: { warehousePortPlacement: string; warehouseBus: string; itemPolicies: { supply?: string }[] } }; corrected: boolean; unlocked: boolean };
//     expect(result.initial).toBe("continuous");
//     expect(result.linked).toEqual({ value: "straight", disabled: true });
//     expect(result.invalid).toEqual({ marked: "true", disabled: true, red: true });
//     expect(result.request.options).toMatchObject({ warehousePortPlacement: "full-side", warehouseBus: "straight" });
//     expect(result.request.options.itemPolicies.some(policy => policy.supply === "external")).toBe(true);
//     expect(result.corrected).toBe(true);
//     expect(result.unlocked).toBe(true);
//   });
// }
