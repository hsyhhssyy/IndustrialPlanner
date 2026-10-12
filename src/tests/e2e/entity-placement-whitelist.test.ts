import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, SCREEN_PROFILES } from "./harness/fixture";

// 正式回归在三屏开发验证之后独立编写；目标是浮层真实边界、原生触控与按钮宽度。
for (const profile of SCREEN_PROFILES) {
  test(`设备地图白名单的变体菜单与单型号宽度 ${profile.name}`, async ({ browserSession }, info) => {
    const scene = JSON.parse(await readFile(resolve("src/tests/fixtures/blueprints/document-scenes/app/entity-placement-whitelist/scene-01.schema7.json"), "utf8"));
    const cli = await browserSession.openCli(profile);
    const code = `async page => {
      await page.context().addInitScript(() => localStorage.setItem('v3-app-settings', JSON.stringify({collapseDeviceModes:true,gamePlayDeviceAudio:false})));
      await page.goto('http://127.0.0.1:4174/');
      await page.waitForFunction(() => window.__test__?.readiness().canvasAttached && window.__test__?.readiness().viewportValid, null, {timeout:30000});
      const help = page.locator('[data-dialog-key="help"]');
      if (await help.isVisible()) await help.getByRole('button',{name:'关闭',exact:true}).click();
      await page.evaluate(input => window.__test__.loadBlueprint(input), ${JSON.stringify(scene)});
      const activate = async locator => { if (${JSON.stringify(profile.name)} === 'desktop') await locator.click(); else await locator.tap(); };
      const placementTab = page.locator('[class*="left-toolbar"]').getByRole('button',{name:'放置模式',exact:true});
      if (await placementTab.getAttribute('aria-pressed') !== 'true') await activate(placementTab);
      const main = page.locator('[data-ui-button-id="placement-furnance_1"]');
      const shell = page.locator('[class*="placement-device-button-shell"]').filter({has:main});
      await activate(shell.locator('[aria-haspopup="menu"]'));
      const menu = page.getByRole('menu');
      await menu.waitFor({state:'visible'});
      const menuBox = await menu.boundingBox();
      const menuItems = await menu.getByRole('menuitemradio').count();
      await page.screenshot({path:${JSON.stringify(info.outputPath("two-variants.png"))}});
      await activate(menu.getByRole('menuitemradio').nth(1));
      const baseTab = page.locator('[class*="left-toolbar"]').getByRole('button',{name:'基地',exact:true});
      if (await baseTab.getAttribute('aria-pressed') !== 'true') await activate(baseTab);
      await activate(page.locator('[data-ui-button-id="base-current-select"]'));
      await activate(page.locator('[data-base-id="valley4_protocol_core"]'));
      await activate(page.locator('[data-dialog-key="base-select"] button[class*="save-blueprint-primary-button"]'));
      await page.waitForFunction(() => window.__test__.getAppState().baseId === 'valley4_protocol_core');
      await activate(placementTab);
      await main.waitFor({state:'visible'});
      const mainBox = await main.boundingBox();
      const shellBox = await shell.boundingBox();
      const variantControls = await shell.locator('[data-machine-mode-icon],[aria-haspopup="menu"]').count();
      const hiddenVariant = await page.locator('[data-ui-button-id="placement-furnance_1_liquid"]').count();
      await page.screenshot({path:${JSON.stringify(info.outputPath("single-variant.png"))}});
      return {menuBox,menuItems,mainBox,shellBox,variantControls,hiddenVariant,state:await page.evaluate(() => window.__test__.getAppState())};
    }`;
    const result = await cli.runJson(code) as {
      menuBox: { x: number; y: number; width: number; height: number };
      menuItems: number;
      mainBox: { x: number; width: number };
      shellBox: { x: number; width: number };
      variantControls: number;
      hiddenVariant: number;
      state: { tool: string; previewCount: number };
    };
    expect(result.menuItems).toBe(2);
    expect(result.menuBox.width).toBeGreaterThan(0);
    expect(result.menuBox.height).toBeGreaterThan(0);
    expect(result.menuBox.x).toBeGreaterThanOrEqual(0);
    expect(result.menuBox.y).toBeGreaterThanOrEqual(0);
    expect(result.menuBox.x + result.menuBox.width).toBeLessThanOrEqual(profile.width);
    expect(result.menuBox.y + result.menuBox.height).toBeLessThanOrEqual(profile.height);
    expect(result.hiddenVariant).toBe(0);
    expect(result.variantControls).toBe(0);
    expect(result.mainBox.width).toBeGreaterThan(0);
    expect(Math.abs(result.mainBox.x + result.mainBox.width - result.shellBox.x - result.shellBox.width)).toBeLessThanOrEqual(1);
    expect(result.state).toMatchObject({ tool: "select", previewCount: 0 });
  });
}
