import { resolve } from "node:path";
import { expect, test } from "./harness/fixture";
import { SCREEN_PROFILES } from "./harness/profiles";

interface NameplateMeasurement {
  readonly name: string;
  readonly leftOffset: number;
  readonly bottomToWarningTop: number;
}

interface AgriculturalLandReport {
  readonly group: string;
  readonly initial: readonly NameplateMeasurement[];
  readonly rotated: readonly NameplateMeasurement[];
  readonly afterSwitch: readonly NameplateMeasurement[];
}

// 每个 Profile 使用受管 CLI；fixture 逐轮关闭浏览器、服务并核验资源释放。
for (const profile of SCREEN_PROFILES) {
  test(`农牧用地的名牌跟随区域旋转，切换基地后隐藏 [${profile.name}]`, async ({ browserSession }) => {
    test.setTimeout(90_000);
    const cli = await browserSession.openCli(profile);
    const report = await cli.runJson(`async page => {
      await page.goto('http://127.0.0.1:4174/');
      await page.waitForFunction(() => {
        const ready = window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      });
      const baseButton = page.locator('aside[class*="left-toolbar"]')
        .getByRole('button', { name: '基地', exact: true });
      const select = async id => {
        if (await baseButton.getAttribute('aria-pressed') !== 'true') await baseButton.click();
        await page.locator('[data-ui-button-id="base-current-select"]').click();
        const dialog = page.getByRole('dialog', { name: '选择基地', exact: true });
        const option = dialog.locator('[data-base-id="' + id + '"]');
        const group = await option.locator('xpath=ancestor::section[1]').getByRole('heading').innerText();
        await option.click();
        await dialog.getByRole('button', { name: '确定', exact: true }).click();
        await page.waitForFunction(id => window.__test__?.getAppState().baseId === id, id);
        if (await baseButton.getAttribute('aria-pressed') === 'true') await baseButton.click();
        return group;
      };
      const group = await select('wuling_agricultural_land');
      await page.evaluate(() => document.fonts.ready);
      // 准备视口：保持原生基地切换和旋转动作，布景不写文档或渲染对象。
      await page.evaluate(center => {
        const editor = window.__industrialPlannerAppHost.workspace.editor;
        editor.actions.zoom(-100);
        const viewport = editor.state.viewport;
        const startClientPixel = { x: viewport.clientRect.left + viewport.clientRect.width / 2,
          y: viewport.clientRect.top + viewport.clientRect.height / 2 };
        editor.actions.moveViewportByClientPixelVector({ startClientPixel, endClientPixel: {
          x: startClientPixel.x + (viewport.center.x - center.x) * viewport.gridCellPixelSize,
          y: startClientPixel.y + (viewport.center.y - center.y) * viewport.gridCellPixelSize,
        } });
      }, ${JSON.stringify({ x: profile.name === "tablet" ? 30 : 35, y: profile.name === "mobile" ? -4 : 10 })});

      const measure = async () => {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return page.evaluate(async () => {
          const host = window.__industrialPlannerAppHost;
          const render = host.workspace.render;
          const canvas = render.app.canvas.getBoundingClientRect();
          const { resolveBaseAreas } = await import('/src/shared/geometry/base-areas.ts');
          const { resolveViewportRectFromWorldGridRect } = await import('/src/shared/geometry/viewport-transform.ts');
          const base = host.workspace.registry.baseDefinitions.find(base => base.id === 'wuling_agricultural_land');
          const viewport = host.workspace.editor.state.viewport;
          const measurements = [];
          const visit = (node, parentVisible) => {
            const visible = parentVisible && node.visible !== false;
            const area = visible ? resolveBaseAreas(base).find(area => area.nameplate === node.text) : undefined;
            if (area) {
              const bounds = node.getBounds();
              const outer = resolveViewportRectFromWorldGridRect({ gridRect: area.outerRect,
                viewportBounds: viewport.clientRect, viewportCenter: viewport.center,
                gridCellPixelSize: viewport.gridCellPixelSize, displayRotation: viewport.displayRotation });
              measurements.push({ name: node.text, leftOffset: bounds.x + canvas.left - outer.left,
                bottomToWarningTop: outer.top - 2 * viewport.gridCellPixelSize
                  - (bounds.y + canvas.top + bounds.height) });
            }
            for (const child of node.children ?? []) visit(child, visible);
          };
          visit(render.app.stage, true);
          return measurements;
        });
      };
      const initial = await measure();
      await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "agricultural-layout.png"))} });
      await page.getByRole('button', { name: '旋转视角', exact: true }).click();
      await page.waitForFunction(() => window.__industrialPlannerAppHost.workspace.editor.state.viewport.displayRotation === 90);
      const rotated = await measure();
      await select('wuling_protocol_core');
      const afterSwitch = await measure();
      return { group, initial, rotated, afterSwitch };
    }`) as AgriculturalLandReport;

    expect(report.group).toBe("武陵");
    for (const measurements of [report.initial, report.rotated]) {
      expect(measurements.map(item => item.name)).toEqual(["武陵农用地", "缘缘庄"]);
      for (const measurement of measurements) {
        expect(measurement.leftOffset).toBeGreaterThanOrEqual(8);
        expect(measurement.leftOffset).toBeLessThanOrEqual(12);
        expect(measurement.bottomToWarningTop).toBeGreaterThan(0);
      }
    }
    expect(report.afterSwitch).toEqual([]);
  });
}
