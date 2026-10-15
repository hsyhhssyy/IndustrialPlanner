import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import plant from "../blueprint-planner/fixtures/plant-preload.json" with { type: "json" };

// 开发三屏验证完成后独立编写；只覆盖真实滚动和排版，复制及种子持久化由 Vitest 验证。
for (const profile of SCREEN_PROFILES) {
  test(`任务随机种子在统计区完整可见 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(() => window.__test__?.readiness().assembled);
      await page.evaluate(async plan => {
        const app = window.__industrialPlannerAppHost;
        app.blueprintPlannerDialog.open(plan);
        const planner = app.workspace.blueprintPlanner;
        const id = await planner.actions.importTask(planner.queries.exportDraft(app.blueprintPlannerDialog.getRequest()));
        app.blueprintPlannerDialog.selectTask(id, planner.queries.getLastRequest(id));
      }, ${JSON.stringify(plant.request.plan)});
      const dialog = page.locator('[data-dialog-key="blueprint-planner"]');
      const seed = dialog.locator('span').filter({ hasText: /^随机种子 \\d+$/ }).first();
      await seed.scrollIntoViewIfNeeded();
      const bounds = await seed.boundingBox(), viewport = page.viewportSize();
      await dialog.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "seed-layout.png"))} });
      return { visible: await seed.isVisible(), contained: !!bounds && bounds.x >= 0 && bounds.y >= 0
        && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
        unclipped: await seed.evaluate(element => element.scrollWidth <= element.clientWidth) };
    }`);
    expect(result).toEqual({ visible: true, contained: true, unclipped: true });
  });
}
