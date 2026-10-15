import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

for (const profile of SCREEN_PROFILES) {
  test(`橙黄色断电插头保留设备 avatar 与定时上传开关 ${profile.name}`, async ({ browserSession }, info) => {
    test.setTimeout(180_000);
    const blueprint = JSON.parse(await readFile(resolve(
      "src/tests/fixtures/blueprints/collections/renderer/device-power-status/scene-01-variant-1.schema7.json",
    ), "utf8"));
    const cli = await browserSession.openCli(profile);
    // 验证真实 Pixi Sprite 的可见性、纹理和颜色，并保留画面；纯 Node 环境无法验证此目标。
    const result = await cli.runJson(`async page => {
      await page.addInitScript(() => localStorage.setItem('v3-app-settings', JSON.stringify({
        gameShowDeviceIcons: true, gameShowDeviceNames: true, gameUseBlueprintStyleDeviceImages: false,
      })));
      await page.goto('http://127.0.0.1:4174');
      await page.waitForFunction(() => window.__test__?.readiness().canvasAttached && window.__test__?.readiness().viewportValid);
      await page.evaluate(input => window.__test__.loadBlueprint(input), ${JSON.stringify(blueprint)});
      function read(id) {
        const app = window.__industrialPlannerAppHost;
        function find(node, predicate) {
          if (predicate(node)) return node;
          for (const child of node.children ?? []) {
            const match = find(child, predicate);
            if (match) return match;
          }
        }
        const root = find(app.workspace.render.app.stage, node => String(node.label).startsWith('entity.' + id + '.') && String(node.label).endsWith('.entity'));
        const icon = root && find(root, node => node.label === 'device.powerDisconnected');
        const avatar = root && find(root, node => node.label === 'device.icon');
        let visible = Boolean(icon?.visible);
        for (let parent = icon?.parent; parent; parent = parent.parent) visible = visible && parent.visible;
        let avatarVisible = Boolean(avatar?.visible);
        for (let parent = avatar?.parent; parent; parent = parent.parent) avatarVisible = avatarVisible && parent.visible;
        const iconBounds = icon?.getBounds();
        const avatarBounds = avatar?.getBounds();
        return { id, present: Boolean(root), visible, tint: icon?.tint, texture: icon?.texture?.label,
          avatarVisible, avatarTint: avatar?.tint, avatarTexture: avatar?.texture?.label,
          iconBottom: iconBounds && iconBounds.y + iconBounds.height, avatarTop: avatarBounds?.y };
      }
      const states = [];
      async function observe(id, visible) {
        await page.evaluate(id => window.__test__.focusEntity(id), id);
        for (let i = 0; i < 100; i++) {
          const state = await page.evaluate(read, id);
          if (state.present && state.avatarVisible && state.avatarTexture?.includes('/avatar/') &&
            (visible ? state.visible && state.tint === 0xfea737 && state.texture?.includes('power-disconnected.webp') : !state.visible)) {
            states.push(state); return;
          }
          await page.waitForTimeout(100);
        }
        throw new Error('设备图标未达到预期状态：' + id);
      }
      await observe('reactor-unpowered', true);
      await page.screenshot({ path: ${JSON.stringify(info.outputPath("reactor-stopped.png"))} });
      await observe('reactor-powered', false);
      await observe('storage-disabled', false);
      await observe('storage-enabled', true);
      const point = await page.evaluate(id => window.__test__.entityPoint(id), 'storage-enabled');
      await page.mouse.click(point.x, point.y);
      const toggle = page.locator('[data-recipe-select="warehouse_submit"]');
      await toggle.click();
      await observe('storage-enabled', false);
      await toggle.click();
      await observe('storage-enabled', true);
      await page.keyboard.press('Escape');
      await page.locator('[data-ui-button-id="top-bar-simulation-control"]').click();
      await page.waitForFunction(() => window.__industrialPlannerAppHost.workspace.simulation.state.runningState === 'start');
      await observe('reactor-unpowered', true);
      await observe('storage-enabled', true);
      await page.screenshot({ path: ${JSON.stringify(info.outputPath("storage-running.png"))} });
      await page.locator('[data-ui-button-id="top-bar-simulation-stop"]').click();
      await page.waitForFunction(() => window.__industrialPlannerAppHost.workspace.simulation.state.runningState === 'stop');
      await observe('storage-enabled', true);
      return { states, screen: await page.evaluate(() => window.__test__.getAppState().screen) };
    }`, "power-disconnected.log") as {
      states: Array<{
        id: string; visible: boolean; tint?: number; texture?: string;
        avatarVisible: boolean; avatarTint?: number; avatarTexture?: string;
        iconBottom: number; avatarTop: number;
      }>;
      screen: { deviceClass: string };
    };

    expect(result.screen.deviceClass).toBe(profile.name);
    expect(result.states.map((state) => state.visible)).toEqual([
      true, false, false, true, false, true, true, true, true,
    ]);
    for (const state of result.states) {
      expect(state.avatarVisible).toBe(true);
      expect(state.avatarTint).toBe(0xffffff);
      expect(state.avatarTexture).toContain("/avatar/");
    }
    expect(result.states[4]?.avatarTexture).toBe(result.states[3]?.avatarTexture);
    expect(result.states[5]?.avatarTexture).toBe(result.states[3]?.avatarTexture);
    for (const state of result.states.filter((state) => state.visible)) {
      expect(state.tint).toBe(0xfea737);
      expect(state.texture).toContain("power-disconnected.webp");
      expect(state.iconBottom).toBeLessThanOrEqual(state.avatarTop + 1);
    }
  });
}
