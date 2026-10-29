import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

// 2026-10-29：开发截图确认后独立添加；仅回归错误区与图形共存的真实排版，循环业务矩阵由 Vitest 覆盖。
for (const profile of SCREEN_PROFILES) {
  test(`循环错误提示保留可见工序图：${profile.name}`, async ({ browserSession, baseURL }) => {
    test.setTimeout(150_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      const ready = () => page.waitForFunction(() => {
        const state = window.__test__?.readiness();
        return state?.assembled && state.canvasAttached && state.viewportValid;
      });
      await page.goto(${JSON.stringify(baseURL)});
      await ready();
      await page.evaluate(async () => {
        const storage = await import('/src/shared/storage/planner-storage.ts');
        await storage.savePlannerState({
          targets: [{ id: 'target', itemId: 'item_gas_copper', perMinute: 30 }],
          supplies: [{ id: 'gas', itemId: 'item_gas_xiranite', perMinute: 60, isInfinite: true }],
          displayMode: 'item', viewMode: 'process', useModules: false,
          recipeChoices: { item_gas_copper: 'liquid_transmuter_2_gas_gas_copper_1',
            item_copper_nugget: 'liquid_transmuter_2_solid_copper_nugget_1' },
          recipeChoicesDemandSignature: null,
          sourceConfig: { waterPolicy: 'use-byproduct', acidPolicy: 'use-byproduct', sewagePolicy: 'external-supply',
            waterPurifierPolicy: 'disabled', includeDeviceMinimumConsumption: 'fractional' },
          session: storage.createDefaultPlannerSessionState(),
        });
      });
      await page.reload();
      await ready();
      await page.getByRole('button', { name: '工具箱', exact: true }).click();
      await page.getByText('产线规划', { exact: true }).click();
      const panel = page.locator('[class*="production-planning-panel_"]');
      await panel.getByRole('button', { name: '计算', exact: true }).click();
      const alert = panel.getByRole('alert');
      await alert.waitFor();
      await panel.locator('[class*="production-planning-stage_"]').evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished));
      });
      const geometry = await panel.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const alert = element.querySelector('[role="alert"]').getBoundingClientRect();
        const graph = element.querySelector('[class*="process-graph-canvas"]').getBoundingClientRect();
        const badgeVisible = [...element.querySelectorAll('[class*="process-node-error"]')].some(badge => {
          const box = badge.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.left >= graph.left && box.right <= graph.right
            && box.top >= graph.top && box.bottom <= graph.bottom;
        });
        return { alertInside: alert.width > 0 && alert.height > 0 && alert.left >= bounds.left && alert.right <= bounds.right,
          graphUsable: graph.height >= 64 && graph.top >= alert.bottom - 1 && graph.bottom <= bounds.bottom + 1,
          badgeVisible };
      });
      await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "cycle-layout.png"))} });
      return geometry;
    }`);
    expect(result).toEqual({ alertInside: true, graphUsable: true, badgeVisible: true });
  });
}
