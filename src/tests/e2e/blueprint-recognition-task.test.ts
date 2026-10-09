import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import blueprint from "../fixtures/blueprints/blueprint-planner/blueprint-optimization/unknown-entry.schema7.json" with { type: "json" };

// 独立于开发脚本编写；通过真实优化入口、定位按钮、下拉框、下载和文件导入操作验证。
for (const profile of SCREEN_PROFILES) {
  test(`识别任务部分配置导出恢复与预览定位 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      const assert = (value, message) => { if (!value) throw Error(message); };
      await page.addInitScript(() => {
        localStorage.setItem('industrial-planner.experimental.eda', 'true');
        localStorage.setItem('v3-user-settings-dialog', JSON.stringify({values:{'other-experimental-features':true}}));
      });
      await page.goto(${JSON.stringify(baseURL ?? "http://127.0.0.1:4174")});
      await page.waitForFunction(() => window.__test__?.readiness().assembled);
      await page.evaluate(record => window.__industrialPlannerAppHost.blueprintPreview.open({...record,parentFolderId:null}), ${JSON.stringify(blueprint)});
      await page.getByRole('button', {name:'优化此蓝图',exact:true}).click();
      await page.waitForFunction(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId
        && window.__industrialPlannerAppHost.workspace.blueprintPlanner.state.activeTaskId === null);
      const dialog = page.getByRole('dialog').filter({has:page.locator('#blueprint-planner-title')});
      const id = await page.evaluate(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId);
      assert(await dialog.getByRole('combobox').count() === 1, '仅未知输入应提供选择');
      const locate = dialog.locator('[class*="boundaryRow"]').first().getByRole('button');
      await locate.click();
      await dialog.locator('[class*="previewSelection"]').waitFor();
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
      assert(JSON.stringify(afterZoom.labels.map(label => label.position))
        === JSON.stringify(beforeZoom.labels.map(label => label.position)), '缩放重新分配了标签位置');
      assert(JSON.stringify(afterZoom.targets) === JSON.stringify(beforeZoom.targets), '缩放改变了目标坐标');
      assert(afterZoom.labels.length === beforeZoom.labels.length && afterZoom.labels.every((label, index) =>
        Math.abs(label.renderedWidth / beforeZoom.labels[index].renderedWidth - 1.69) < .01), '标签没有跟随蓝图缩放');
      await zoomControls.nth(1).click();
      const afterFit = await readLabels();
      assert(JSON.stringify(afterFit.labels.map(label => label.position))
        === JSON.stringify(beforeZoom.labels.map(label => label.position)), '显示全图改变了标签布局');
      await dialog.getByRole('combobox').selectOption('item_iron_ore');
      const exported = page.waitForEvent('download');
      await dialog.getByRole('button', {name:'下载任务',exact:true}).click();
      await (await exported).saveAs(${JSON.stringify(resolve(cli.directory, "partial.eda-task.json"))});
      await page.reload();
      await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.blueprintPlanner?.queries.listTasks().length === 1);
      await page.evaluate(id => {
        const h = window.__industrialPlannerAppHost;
        h.blueprintPlannerDialog.selectTask(id, h.workspace.blueprintPlanner.queries.getLastRequest(id)); h.blueprintPlannerDialog.open();
      }, id);
      assert(await dialog.getByRole('combobox').inputValue() === 'item_iron_ore', '刷新丢失输入配置');
      await dialog.locator('input[type="file"]').setInputFiles(${JSON.stringify(resolve(cli.directory, "partial.eda-task.json"))});
      await page.waitForFunction(() => window.__industrialPlannerAppHost.workspace.blueprintPlanner.queries.listTasks().length === 2);
      const restored = await page.evaluate(() => {
        const h = window.__industrialPlannerAppHost, taskId = h.blueprintPlannerDialog.viewTaskId;
        return {taskId, request:h.workspace.blueprintPlanner.queries.getLastRequest(taskId)};
      });
      assert(restored.taskId !== id && restored.request.kind === 'blueprint-recognition'
        && restored.request.input.blueprint.blueprintId === ${JSON.stringify(blueprint.blueprintId)}, '导入未携带原图或覆盖了任务');
      await dialog.getByRole('button', {name:'识别蓝图',exact:true}).click();
      await dialog.getByRole('alert').waitFor();
      assert((await dialog.getByRole('alert').innerText()).includes('净产出'), '直接透传不能被当作净产物');
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "restored.png"))}});
      return {passed:true,taskId:restored.taskId};
    }`);
    expect(result).toMatchObject({ passed: true });
  });
}
