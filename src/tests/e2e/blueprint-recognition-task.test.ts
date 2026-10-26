import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import blueprint from "../fixtures/blueprints/blueprint-planner/blueprint-optimization/unknown-entry.schema7.json" with { type: "json" };

// 配置与识别业务由 Vitest 覆盖；此处只操作预览命中、实际缩放和短屏滚动。
// 2026-10-25：三屏开发验证后，补充物品选择器搜索框焦点与可见边界检查。
for (const profile of SCREEN_PROFILES) {
  test(`蓝图识别预览定位、缩放与优化选项短屏布局 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      const assert = (value, message) => { if (!value) throw Error(message); };
      await page.addInitScript(() => {
        localStorage.setItem('v3-user-settings-dialog', JSON.stringify({values:{'other-experimental-features':true,'experimental-blueprint-production-planning':true}}));
      });
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(() => window.__test__?.readiness().assembled);
      await page.evaluate(record => window.__industrialPlannerAppHost.blueprintPreview.open({...record,parentFolderId:null}), ${JSON.stringify(blueprint)});
      await page.getByRole('button', {name:'优化此蓝图',exact:true}).click();
      await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId
        && window.__industrialPlannerAppHost.workspace.blueprintPlanner.state.activeTaskId === null);
      const dialog = page.locator('[data-dialog-key="blueprint-planner"]');
      const locate = dialog.locator('[class*="boundaryRow"]').first().getByRole('button').first();
      await locate.click();
      await dialog.locator('[class*="previewSelection"]').waitFor();
      await dialog.locator('button[aria-haspopup="dialog"]').click();
      const picker = page.locator('[data-dialog-key="encyclopedia-picker"]');
      const search = picker.getByRole('textbox');
      await search.waitFor();
      const searchLayout = await search.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return element === document.activeElement && bounds.left >= 0 && bounds.right <= innerWidth
          && bounds.top >= 0 && bounds.bottom <= innerHeight;
      });
      assert(searchLayout, '物品选择器搜索框未获得焦点或超出屏幕');
      const itemName = await page.evaluate(() => {
        const app = window.__industrialPlannerAppHost;
        return app.actions.translate(app.workspace.registry.queries.findItemDefinition('item_iron_ore').nameKey);
      });
      await search.fill(itemName);
      await picker.screenshot({path:${JSON.stringify(resolve(cli.directory, "boundary-picker.png"))}});
      await picker.getByRole('button', {name:itemName,exact:true}).click();
      await picker.waitFor({state:'hidden'});
      const marker = dialog.locator('[class*="boundaryMarker"][data-direction="output"]');
      await marker.click();
      assert(await dialog.locator('[class*="boundaryRow"]').nth(1).getAttribute('data-selected') === 'true', '图上选择未定位列表');
      // 2026-10-08：偏移标签、目标圆点与引线替代覆盖设备的居中按钮。
      const callouts = await dialog.locator('[class*="previewFrame"]').evaluate(frame => {
        const labels = [...frame.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        const dots = [...frame.querySelectorAll('circle')].map(circle => {
          const rect = circle.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        const overlapping = labels.some((a, index) => labels.slice(index + 1).some(b =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
        const covered = dots.some(dot => labels.some(label =>
          dot.x > label.left && dot.x < label.right && dot.y > label.top && dot.y < label.bottom));
        return { labels: labels.length, dots: dots.length, lines: frame.querySelectorAll('line').length, overlapping, covered };
      });
      assert(callouts.labels > 0 && callouts.dots === callouts.labels && callouts.lines === callouts.labels,
        '每个可见标签必须保留目标圆点和引线');
      assert(!callouts.overlapping && !callouts.covered, '标签不能重叠或覆盖目标圆点');
      // 2026-10-08：标签与目标保持固定对应关系，缩放只能整体变换，不重新寻找视口空位。
      const readLabels = () => dialog.locator('[class*="previewFrame"]').evaluate(frame => ({
        labels: [...frame.querySelectorAll('[class*="boundaryMarker"]')].map(button => ({
          position: [button.style.left, button.style.top, button.style.width, button.style.height],
          renderedWidth: button.getBoundingClientRect().width,
        })),
        targets: [...frame.querySelectorAll('circle')].map(circle => [circle.getAttribute('cx'), circle.getAttribute('cy')]),
      }));
      const beforeZoom = await readLabels();
      assert(await dialog.locator('[class*="previewControls"]').getByRole('button').count() === 3, '预览缩放按钮不完整');
      const zoomControls = dialog.locator('[class*="previewControls"]').getByRole('button');
      await zoomControls.nth(2).click();
      await zoomControls.nth(2).click();
      const afterZoom = await readLabels();
      assert(afterZoom.labels.length === beforeZoom.labels.length && afterZoom.labels.every((label, index) =>
        Math.abs(label.renderedWidth / beforeZoom.labels[index].renderedWidth - 1.69) < .01), '标签没有跟随蓝图缩放');
      await zoomControls.nth(1).click();
      await dialog.screenshot({path:${JSON.stringify(resolve(cli.directory, "preview.png"))}});
      // 当前四项权限常驻面板，旧确认弹窗已由产品移除。
      const options = dialog.locator('[aria-labelledby="eda-optimization-options-title"]');
      const merge = options.getByRole('switch', {name:'合并输入、输出设施',exact:true});
      await merge.scrollIntoViewIfNeeded();
      await merge.check();
      const toggle = await merge.boundingBox();
      const frame = await dialog.boundingBox();
      assert(toggle && frame && toggle.y >= frame.y && toggle.y + toggle.height <= frame.y + frame.height,
        '优化选项被短屏裁切');
      const footer = dialog.locator('footer');
      const button = footer.getByRole('button', {name:'识别蓝图',exact:true});
      const bounds = await button.boundingBox();
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= ${profile.height}, '底部按钮被裁切');
      await dialog.screenshot({path:${JSON.stringify(resolve(cli.directory, "optimization-options.png"))}});
      return {passed:true};
    }`);
    expect(result).toEqual({ passed: true });
  });
}

// AI-REMOVED 2026-10-15:
// Reason: 移出业务配置、导出恢复与识别算法重复断言；实际布局按当前常驻权限面板验证，原确认弹窗已移除。
// Trigger: 用户要求去除 Vitest 已覆盖及与屏幕、外部设施无关的 E2E。
// Evidence: 现有真实主机和新增组件断言覆盖配置、持久化与业务状态。
// Replacement: src/tests/blueprint-planner/blueprint-recognition-task.test.ts；src/tests/app/blueprint-optimization-state.test.tsx、blueprint-planner-options.test.tsx、blueprint-identification-marker-layout.test.ts；eda-task-workflow.test.ts 文件通道
// Risk: 仅保留真实浏览器目标，迁移覆盖需人工复核。
// Human Review: Required
//
// Original code:
// import { resolve } from "node:path";
// import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
// import blueprint from "../fixtures/blueprints/blueprint-planner/blueprint-optimization/unknown-entry.schema7.json" with { type: "json" };
// import plant from "../fixtures/blueprints/blueprint-planner/blueprint-optimization/plant-cycle.schema7.json" with { type: "json" };
//
// // 独立于开发脚本编写；通过真实优化入口、定位按钮、下拉框、下载和文件导入操作验证。
// for (const profile of SCREEN_PROFILES) {
//   test(`识别任务部分配置导出恢复与预览定位 [${profile.name}]`, async ({ browserSession, baseURL }) => {
//     test.setTimeout(180_000);
//     const cli = await browserSession.openCli(profile);
//     const result = await cli.runJson(`async page => {
//       const assert = (value, message) => { if (!value) throw Error(message); };
//       await page.addInitScript(() => {
//         localStorage.setItem('industrial-planner.experimental.eda', 'false');
//         localStorage.setItem('v3-user-settings-dialog', JSON.stringify({values:{'other-experimental-features':true,'experimental-blueprint-planner':false,'experimental-blueprint-production-planning':true}}));
//       });
//       await page.goto(${JSON.stringify(baseURL ?? "http://127.0.0.1:4174")});
//       await page.waitForFunction(() => window.__test__?.readiness().assembled);
//       await page.evaluate(record => window.__industrialPlannerAppHost.blueprintPreview.open({...record,parentFolderId:null}), ${JSON.stringify(blueprint)});
//       await page.getByRole('button', {name:'优化此蓝图',exact:true}).click();
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId
//         && window.__industrialPlannerAppHost.workspace.blueprintPlanner.state.activeTaskId === null);
//       const dialog = page.getByRole('dialog').filter({has:page.locator('#blueprint-planner-title')});
//       const id = await page.evaluate(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId);
//       assert(await dialog.locator('[class*="boundaryGroup"]').getByRole('combobox').count() === 1, '仅未知输入应提供选择');
//       const locate = dialog.locator('[class*="boundaryRow"]').first().getByRole('button');
//       await locate.click();
//       await dialog.locator('[class*="previewSelection"]').waitFor();
//       const marker = dialog.locator('[class*="boundaryMarker"][data-direction="output"]');
//       await marker.click();
//       assert(await dialog.locator('[class*="boundaryRow"]').nth(1).getAttribute('data-selected') === 'true', '图上选择未定位列表');
//       // 2026-10-08：偏移标签、目标圆点与引线替代覆盖设备的居中按钮。
//       const callouts = await dialog.locator('[class*="previewFrame"]').evaluate(frame => {
//         const labels = [...frame.querySelectorAll('button')].map(button => button.getBoundingClientRect());
//         const dots = [...frame.querySelectorAll('circle')].map(circle => {
//           const rect = circle.getBoundingClientRect();
//           return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
//         });
//         const overlapping = labels.some((a, index) => labels.slice(index + 1).some(b =>
//           a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
//         const covered = dots.some(dot => labels.some(label =>
//           dot.x > label.left && dot.x < label.right && dot.y > label.top && dot.y < label.bottom));
//         return { labels: labels.length, dots: dots.length, lines: frame.querySelectorAll('line').length, overlapping, covered };
//       });
//       assert(callouts.labels > 0 && callouts.dots === callouts.labels && callouts.lines === callouts.labels,
//         '每个可见标签必须保留目标圆点和引线');
//       assert(!callouts.overlapping && !callouts.covered, '标签不能重叠或覆盖目标圆点');
//       // 2026-10-08：标签与目标保持固定对应关系，缩放只能整体变换，不重新寻找视口空位。
//       const readLabels = () => dialog.locator('[class*="previewFrame"]').evaluate(frame => ({
//         labels: [...frame.querySelectorAll('[class*="boundaryMarker"]')].map(button => ({
//           position: [button.style.left, button.style.top, button.style.width, button.style.height],
//           renderedWidth: button.getBoundingClientRect().width,
//         })),
//         targets: [...frame.querySelectorAll('circle')].map(circle => [circle.getAttribute('cx'), circle.getAttribute('cy')]),
//       }));
//       const beforeZoom = await readLabels();
//       assert(await dialog.locator('[class*="previewControls"]').getByRole('button').count() === 3, '预览缩放按钮不完整');
//       const zoomControls = dialog.locator('[class*="previewControls"]').getByRole('button');
//       await zoomControls.nth(2).click();
//       await zoomControls.nth(2).click();
//       const afterZoom = await readLabels();
//       assert(JSON.stringify(afterZoom.labels.map(label => label.position))
//         === JSON.stringify(beforeZoom.labels.map(label => label.position)), '缩放重新分配了标签位置');
//       assert(JSON.stringify(afterZoom.targets) === JSON.stringify(beforeZoom.targets), '缩放改变了目标坐标');
//       assert(afterZoom.labels.length === beforeZoom.labels.length && afterZoom.labels.every((label, index) =>
//         Math.abs(label.renderedWidth / beforeZoom.labels[index].renderedWidth - 1.69) < .01), '标签没有跟随蓝图缩放');
//       await zoomControls.nth(1).click();
//       const afterFit = await readLabels();
//       assert(JSON.stringify(afterFit.labels.map(label => label.position))
//         === JSON.stringify(beforeZoom.labels.map(label => label.position)), '显示全图改变了标签布局');
//       await dialog.locator('[class*="boundaryGroup"]').getByRole('combobox').selectOption('item_iron_ore');
//       const rule = dialog.getByRole('combobox', {name:'取货口摆放规则',exact:true});
//       const bus = dialog.getByRole('combobox', {name:'存取线形态',exact:true});
//       assert(await rule.inputValue() === 'continuous', '新蓝图默认连续');
//       await bus.selectOption('corner');
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.options.warehouseBus === 'corner');
//       await rule.selectOption('full-side');
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.options.warehousePortPlacement === 'full-side');
//       assert(await bus.inputValue() === 'straight' && await bus.isDisabled(), '单面规则未联动存取线');
//       assert(await dialog.locator('[aria-invalid="true"]').count() === 1, '只能标红非法输入');
//       assert(await dialog.getByRole('button', {name:'识别蓝图',exact:true}).isDisabled(), '非法供料未拦截');
//       const exported = page.waitForEvent('download');
//       await dialog.getByRole('button', {name:'下载任务',exact:true}).click();
//       await (await exported).saveAs(${JSON.stringify(resolve(cli.directory, "partial.eda-task.json"))});
//       await page.reload();
//       await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.blueprintPlanner?.queries.listTasks().length === 1);
//       await page.evaluate(id => {
//         const h = window.__industrialPlannerAppHost;
//         h.blueprintPlannerDialog.selectTask(id, h.workspace.blueprintPlanner.queries.getLastRequest(id)); h.blueprintPlannerDialog.open();
//       }, id);
//       assert(await dialog.locator('[class*="boundaryGroup"]').getByRole('combobox').inputValue() === 'item_iron_ore', '刷新丢失输入配置');
//       assert(await rule.inputValue() === 'full-side' && await bus.isDisabled(), '刷新丢失摆放配置');
//       await dialog.locator('input[type="file"]').setInputFiles(${JSON.stringify(resolve(cli.directory, "partial.eda-task.json"))});
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.workspace.blueprintPlanner.queries.listTasks().length === 2);
//       const restored = await page.evaluate(() => {
//         const h = window.__industrialPlannerAppHost, taskId = h.blueprintPlannerDialog.viewTaskId;
//         return {taskId, request:h.workspace.blueprintPlanner.queries.getLastRequest(taskId)};
//       });
//       assert(restored.taskId !== id && restored.request.kind === 'blueprint-recognition'
//         && restored.request.input.blueprint.blueprintId === ${JSON.stringify(blueprint.blueprintId)}, '导入未携带原图或覆盖了任务');
//       assert(await rule.inputValue() === 'full-side', '导入丢失摆放配置');
//       await rule.selectOption('continuous');
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.options.warehousePortPlacement === 'continuous');
//       assert(!await bus.isDisabled(), '切回连续未解锁');
//       await dialog.getByRole('button', {name:'识别蓝图',exact:true}).click();
//       await dialog.getByRole('alert').waitFor();
//       assert((await dialog.getByRole('alert').innerText()).includes('净产出'), '直接透传不能被当作净产物');
//       await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "restored.png"))}});
//       // 2026-10-11：优化页的只读原图定位并入真实预览场景，基线与保存恢复规则由 Vitest 验证。
//       await page.evaluate(record => window.__industrialPlannerAppHost.blueprintPreview.open({...record,parentFolderId:null}), ${JSON.stringify(plant)});
//       await page.getByRole('button', {name:'优化此蓝图',exact:true}).click();
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId
//         && window.__industrialPlannerAppHost.workspace.blueprintPlanner.state.activeTaskId === null);
//       await rule.selectOption('any');
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.options.warehousePortPlacement === 'any');
//       await dialog.getByRole('button', {name:'识别蓝图',exact:true}).click();
//       await dialog.getByLabel('原图净产率').waitFor({timeout:60000});
//       // 2026-10-11：原图边界识别后只读，摆放规则在首次开始规划时才锁定。
//       assert(!await rule.isDisabled() && !await bus.isDisabled(), '识别完成不能锁定摆放规则');
//       assert(await dialog.getByRole('button', {name:'开始规划',exact:true}).count() === 1, '首次规划前按钮应为开始规划');
//       assert(await dialog.getByRole('button', {name:'继续规划',exact:true}).count() === 0, '识别完成不能提前显示继续规划');
//       assert(await dialog.locator('[class*="boundaryGroup"]').getByRole('combobox').count() === 0, '优化页原图边界必须只读');
//       const baselineLocate = dialog.locator('[class*="boundaryRow"]').first().getByRole('button');
//       await baselineLocate.click();
//       await dialog.locator('[class*="previewSelection"]').waitFor();
//       assert(await baselineLocate.getAttribute('aria-pressed') === 'true', '只读优化页定位失效');
//       await dialog.locator('[class*="boundaryMarker"]').first().click();
//       assert(await dialog.locator('[class*="boundaryRow"]').first().getAttribute('data-selected') === 'true', '优化页标记未联动列表');
//       await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "optimization-preview.png"))}});
//       // 2026-10-12：开发验证完成后补充回归，实际滚动与点击确认弹窗，验证短屏可操作区域。
//       await dialog.getByRole('button', {name:'开始规划',exact:true}).click();
//       const optimizations = page.getByRole('dialog', {name:'除了重新调整设备位置尝试紧凑布局外，是否可以尝试：',exact:true});
//       await optimizations.waitFor();
//       assert(await optimizations.getByRole('switch').count() === 4, '必须只有四个优化项目');
//       assert(!(await optimizations.innerText()).includes('供电'), '供电不能作为用户开关');
//       for (const control of await optimizations.getByRole('switch').all()) assert(!await control.isChecked(), '新任务优化项目默认关闭');
//       const merge = optimizations.getByRole('switch', {name:'合并输入、输出设施',exact:true});
//       await merge.scrollIntoViewIfNeeded();
//       await merge.check();
//       await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.options.blueprintOptimizations.mergeBoundaryFacilities);
//       const frame = await optimizations.boundingBox(), toggle = await merge.boundingBox();
//       const confirm = await optimizations.getByRole('button', {name:'开始规划',exact:true}).boundingBox();
//       assert(frame && toggle && confirm && toggle.y >= frame.y && toggle.y + toggle.height <= frame.y + frame.height
//         && confirm.y >= frame.y && confirm.y + confirm.height <= frame.y + frame.height, '开关或确认按钮被短屏裁切');
//       await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "optimization-options.png"))}});
//       await optimizations.getByRole('button', {name:'取消',exact:true}).click();
//       const notStarted = await page.evaluate(() => { const h=window.__industrialPlannerAppHost;
//         return !h.workspace.blueprintPlanner.queries.getTask(h.blueprintPlannerDialog.viewTaskId).planningStarted; });
//       assert(notStarted, '取消确认不能启动规划');
//       await dialog.getByRole('button', {name:'开始规划',exact:true}).click();
//       assert(await merge.isChecked(), '重新打开应保留已保存的选择');
//       await optimizations.getByRole('button', {name:'取消',exact:true}).click();
//       return {passed:true,taskId:restored.taskId};
//     }`);
//     expect(result).toMatchObject({ passed: true });
//   });
// }
