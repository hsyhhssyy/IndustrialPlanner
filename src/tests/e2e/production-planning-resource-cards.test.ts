import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

// 2026-10-19：开发三屏验证完成后新增，仅回归真实 CSS 边界；分类及规划业务由 Vitest 验证。
// 对应规则：.docs/common/产线规划自动配方规则.md
// 2026-10-26：分类默认收起；开发三屏验证完成后补充折叠标题边界及原生键盘开合验证。
type ResourceCardBounds = { label: string; width: number; height: number; border: number; escaped: string[] };
for (const profile of SCREEN_PROFILES) {
  test(`产线规划原料卡片包含标题与图标：${profile.name}`, async ({ browserSession, baseURL }) => {
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(() => {
        const ready = window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      });
      await page.getByRole('button', { name: '工具箱', exact: true }).click();
      await page.getByText('产线规划', { exact: true }).click();
      const rows = [];
      for (const label of ['自然资源', '农作物']) {
        const card = page.getByRole('group', { name: label, exact: true });
        await card.scrollIntoViewIfNeeded();
        const measure = () => card.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { label: element.getAttribute('aria-label'), width: rect.width, height: rect.height,
            border: parseFloat(getComputedStyle(element).borderTopWidth),
            escaped: Array.from(element.querySelectorAll('span,svg,img')).filter(child => {
              const box = child.getBoundingClientRect();
              return box.left < rect.left || box.right > rect.right || box.top < rect.top || box.bottom > rect.bottom;
            }).map(child => child.outerHTML) };
        });
        const collapsed = await measure();
        const toggle = card.getByRole('button');
        await toggle.focus();
        await toggle.press('Enter');
        await card.locator('img').first().waitFor();
        rows.push({ ...await measure(), collapsed });
        await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "resource-card"))} + '-' + rows.length + '-expanded.png' });
        await toggle.press('Space');
        await card.locator('img').first().waitFor({ state: 'detached' });
      }
      await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "resource-cards.png"))} });
      return rows;
    }`) as (ResourceCardBounds & { collapsed: ResourceCardBounds })[];
    expect(result.map(row => row.label)).toEqual(["自然资源", "农作物"]);
    for (const row of result) {
      expect(row.height).toBeGreaterThan(row.collapsed.height);
      for (const state of [row.collapsed, row]) {
        expect(state.width).toBeGreaterThan(0);
        expect(state.height).toBeGreaterThan(0);
        expect(state.border).toBeGreaterThan(0);
        expect(state.escaped).toEqual([]);
      }
    }
  });
}
