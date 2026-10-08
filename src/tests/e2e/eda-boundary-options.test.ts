import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import separator from "../blueprint-planner/fixtures/separator-core.json" with { type: "json" };

// 三档开发验证完成后独立编写；真实下拉框负责修改，刷新与旧配置迁移均从持久层恢复。
// AI-CORRECTION 2026-10-07: 规划选项只随任务保存；新草稿恢复默认值，旧全局选项不读取、不覆盖。
for (const profile of SCREEN_PROFILES) {
  test(`EDA 存取线形态默认值、任务保存与全局偏好隔离 [${profile.name}]`, async ({ baseURL, browserSession }) => {
    test.setTimeout(150_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem('industrial-planner.experimental.eda', 'true'));
      await page.goto(${JSON.stringify(baseURL ?? "http://127.0.0.1:4174")}, {waitUntil:'domcontentloaded'});
      const open = async () => {
        await page.waitForFunction(() => !!window.__industrialPlannerAppHost?.workspace.blueprintPlanner);
        await page.evaluate(plan => window.__industrialPlannerAppHost.blueprintPlannerDialog.open(plan), ${JSON.stringify(separator.request.plan)});
      };
      await open();
      const field = page.getByRole('combobox', {name:'存取线形态', exact:true});
      await field.scrollIntoViewIfNeeded();
      const initial = await field.inputValue();
      const labels = await field.locator('option').allTextContents();
      await field.selectOption('corner');
      const corner = await field.inputValue();
      await field.selectOption('u-shaped');
      const uShape = await field.inputValue();
      const taskId = await page.evaluate(async () => {
        const h = window.__industrialPlannerAppHost;
        return h.workspace.blueprintPlanner.actions.importTask(h.workspace.blueprintPlanner.queries.exportDraft(h.blueprintPlannerDialog.getRequest()));
      });
      const globalOptions = await page.evaluate(() => localStorage.getItem('industrial-planner.eda.options'));
      await page.reload({waitUntil:'domcontentloaded'}); await open();
      await field.scrollIntoViewIfNeeded();
      const resetAfterReload = await field.inputValue();
      await page.waitForFunction(id => window.__industrialPlannerAppHost.workspace.blueprintPlanner.queries.listTasks()
        .some(task => task.taskId === id), taskId);
      await page.evaluate(id => {
        const h = window.__industrialPlannerAppHost;
        h.blueprintPlannerDialog.selectTask(id, h.workspace.blueprintPlanner.queries.getLastRequest(id));
      }, taskId);
      const restoredTask = await field.inputValue();
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "u-shaped.png"))}});
      await page.evaluate(() => localStorage.setItem('industrial-planner.eda.options', JSON.stringify({warehouseBus:'free'})));
      await page.reload({waitUntil:'domcontentloaded'}); await open();
      await field.scrollIntoViewIfNeeded();
      const legacyIgnored = await field.inputValue();
      await field.selectOption('corner');
      const legacyOptions = await page.evaluate(() => JSON.parse(localStorage.getItem('industrial-planner.eda.options')));
      return {initial, labels, corner, uShape, resetAfterReload, restoredTask, globalOptions, legacyIgnored, legacyOptions, errors};
    }`);
    expect(result).toEqual({ initial: "straight", labels: ["直线存取线", "直角存取线", "U型存取线"],
      corner: "corner", uShape: "u-shaped", resetAfterReload: "straight", restoredTask: "u-shaped", globalOptions: null,
      legacyIgnored: "straight", legacyOptions: { warehouseBus: "free" }, errors: [] });
  });
}
