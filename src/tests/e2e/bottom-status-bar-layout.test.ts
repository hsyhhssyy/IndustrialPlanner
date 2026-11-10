import { resolve } from "node:path";
import { portIsOpen } from "../../../scripts/browser-test/runtime.mjs";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

// 2026-11-10：三屏开发验证完成后另行编写；仅验证真实排版、触控及浮层边界。
// 每例自有服务随 round 清理，不复用套件服务；完整文案与翻译由 Vitest 验证。
test.use({ appServer: false });

for (const profile of SCREEN_PROFILES) {
  test(`底栏自适应与声明浮层：${profile.name}`, async ({ browserSession, round }) => {
    test.setTimeout(180_000);
    if (await portIsOpen(4186)) throw new Error("4186 已被占用，不能接管其他服务");
    const server = await round.start(process.execPath,
      ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4186", "--strictPort"],
      "status-bar-vite.log", { NODE_ENV: "development" });
    await round.waitForServer(server, "http://127.0.0.1:4186", 60_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.goto('http://127.0.0.1:4186');
      await page.locator('footer').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const screen = await page.evaluate(() => ({ ...window.__industrialPlannerAppHost.state.screenProfile }));
      const layouts = [], popovers = [], dismissals = [];
      const measure = async (compact) => {
        await page.waitForFunction(compact => !!document.querySelector('footer button') === compact, compact);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return page.locator('footer').evaluate(footer => {
          const left = footer.firstElementChild;
          const visible = [...footer.querySelectorAll('span,a,button')].filter(element =>
            !element.closest('[inert]') && element.getBoundingClientRect().width > 0);
          const clipped = visible.filter(element => {
            const rect = element.getBoundingClientRect();
            for (let ancestor = element.parentElement; ancestor && ancestor !== footer.parentElement; ancestor = ancestor.parentElement) {
              const bounds = ancestor.getBoundingClientRect();
              if (getComputedStyle(ancestor).overflowX === 'hidden'
                && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) return true;
            }
            return false;
          });
          return { height: footer.getBoundingClientRect().height, leftWidth: left.clientWidth,
            leftClipped: left.scrollWidth > left.clientWidth + 1, clipped: clipped.map(element => element.textContent) };
        });
      };
      for (const locale of ['zh-CN', 'en-US']) {
        await page.evaluate(locale => window.__industrialPlannerAppHost.internalActions.setLocale(locale), locale);
        layouts.push(await measure(${profile.name !== 'desktop'}));
        const label = locale === 'zh-CN' ? '非鹰角网站' : 'Unofficial site';
        const button = page.getByRole('button', { name: label, exact: true });
        if (${profile.name === 'desktop'}) await page.setViewportSize({ width: 764, height: 345 });
        layouts.push(await measure(true));
        await button.tap();
        const panel = page.getByRole('dialog', { name: label, exact: true });
        await panel.waitFor();
        popovers.push(await panel.evaluate(element => {
          const rect = element.getBoundingClientRect(), footer = document.querySelector('footer').getBoundingClientRect();
          return { parent: element.parentElement.tagName, height: rect.height,
            inside: rect.left >= 8 && rect.right <= innerWidth - 8 && rect.top >= 8 && rect.bottom < footer.top,
            contentFits: element.scrollHeight <= element.clientHeight + 1 };
        }));
        await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, 'notice'))} + '-' + locale + '.png' });
        await panel.locator('span').last().tap();
        dismissals.push(await panel.isVisible());
        await button.tap();
        await panel.waitFor({ state: 'detached' });
        await button.tap();
        await panel.waitFor();
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'detached' });
        dismissals.push(await button.evaluate(element => document.activeElement === element));
        await button.tap();
        await panel.waitFor();
        await page.locator('footer > div').first().tap();
        await panel.waitFor({ state: 'detached' });
        await button.tap();
        await panel.waitFor();
        await page.setViewportSize({ width: 2552, height: 1315 });
        layouts.push(await measure(false));
        await panel.waitFor({ state: 'detached' });
        await page.setViewportSize({ width: ${profile.width}, height: ${profile.height} });
        layouts.push(await measure(${profile.name !== 'desktop'}));
      }
      return { screen, layouts, popovers, dismissals, snapshot: await page.locator('footer').ariaSnapshot() };
    }`) as {
      screen: unknown;
      layouts: { height: number; leftWidth: number; leftClipped: boolean; clipped: string[] }[];
      popovers: { parent: string; height: number; inside: boolean; contentFits: boolean }[];
      dismissals: boolean[];
      snapshot: string;
    };
    expect(result.screen).toMatchObject({ deviceClass: profile.name, viewportWidth: profile.width,
      viewportHeight: profile.height, devicePixelRatio: profile.dpr, hasTouch: true });
    expect(result.layouts).toHaveLength(8);
    for (const layout of result.layouts) {
      expect(layout.height).toBe(28);
      expect(layout.leftWidth).toBeGreaterThan(100);
      expect(layout.leftClipped).toBe(false);
      expect(layout.clipped).toEqual([]);
    }
    expect(result.popovers).toHaveLength(2);
    for (const popover of result.popovers) {
      expect(popover).toMatchObject({ parent: "BODY", inside: true, contentFits: true });
      expect(popover.height).toBeGreaterThan(80);
    }
    expect(result.dismissals).toEqual([true, true, true, true]);
    expect(result.snapshot).toContain("Yue ICP 2021107697-1");
  });
}
