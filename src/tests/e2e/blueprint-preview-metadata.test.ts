import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import blueprint from "../fixtures/blueprints/e2e/copy-selection.schema7.json" with { type: "json" };

// 开发期三屏视觉验证完成后独立编写；通过蓝图库真实按钮打开预览，验证版本来源与同一行排版。
for (const profile of SCREEN_PROFILES) {
  for (const locale of ["zh-CN", "en-US"] as const) {
    test(`蓝图预览架构版本与包围盒面积 [${profile.name}/${locale}]`, async ({ browserSession, baseURL }) => {
      const cli = await browserSession.openCli(profile);
      const result = await cli.runJson(`async page => {
        await page.addInitScript(locale => {
          localStorage.setItem('v3-app-settings', JSON.stringify({locale}));
        }, ${JSON.stringify(locale)});
        await page.goto(${JSON.stringify(baseURL)});
        await page.waitForFunction(() => {
          const ready = window.__test__?.readiness();
          return ready?.assembled && ready.canvasAttached && ready.viewportValid;
        });
        await page.evaluate(async blueprint => {
          const {saveBlueprintDocument} = await import('/src/shared/storage/blueprint-storage.ts');
          if (!await saveBlueprintDocument(blueprint)) throw Error('测试蓝图准备失败');
        }, ${JSON.stringify(blueprint)});
        await page.getByRole('button', {
          name:${JSON.stringify(locale === "zh-CN" ? "蓝图模式" : "Blueprint Mode")},exact:true,
        }).click();
        await page.locator('[data-blueprint-id="fixture:copy-selection"]').click();
        const dialog = page.locator('[data-dialog-key="blueprint-preview"]');
        const metadata = dialog.locator('dl');
        await metadata.waitFor({state:'visible'});
        await metadata.scrollIntoViewIfNeeded();
        const rows = await metadata.evaluate(element => [...element.querySelectorAll('dd')].map(row => {
          const bounds = row.getBoundingClientRect();
          const cells = [...row.children].map(cell => {
            const rect = cell.getBoundingClientRect();
            return {text:cell.textContent, top:rect.top, left:rect.left, right:rect.right,
              width:rect.width, height:rect.height, lineHeight:parseFloat(getComputedStyle(cell).lineHeight)};
          });
          return {text:row.textContent, cells, left:bounds.left, right:bounds.right, width:bounds.width,
            overflow:row.scrollWidth > row.clientWidth + 1};
        }));
        for (const row of rows.slice(1)) {
          if (row.width <= 0 || row.overflow || row.cells.length !== 3) throw Error('详情行不可见或溢出');
          for (const [index,cell] of row.cells.entries()) {
            if (cell.width <= 0 || cell.height > cell.lineHeight + 1
              || Math.abs(cell.top-row.cells[0].top) > 1) throw Error('普通版本号、尺寸或新增字段未保持单行');
            if (cell.left < boundsLeft(row) || cell.right > row.right + 1
              || (index > 0 && row.cells[index-1].right > cell.left + 1)) {
              throw Error('详情文字重叠');
            }
          }
        }
        function boundsLeft(row) { return row.left - 1; }
        await dialog.screenshot({path:${JSON.stringify(resolve(cli.directory, "metadata.png"))}});
        const screen = await page.evaluate(() => window.__test__.getAppState().screen);
        await dialog.getByRole('button', {
          name:${JSON.stringify(locale === "zh-CN" ? "关闭" : "Close")},exact:true,
        }).click();
        await dialog.waitFor({state:'hidden'});
        return {screen, entityCount:rows[0].text, values:rows.slice(1).map(row => row.cells.map(cell => cell.text)), closed:true};
      }`);

      expect(result).toMatchObject({
        screen: {
          viewportWidth: profile.width,
          viewportHeight: profile.height,
          devicePixelRatio: profile.dpr,
          deviceClass: profile.name,
          screenShape: profile.shape,
          hasTouch: true,
        },
        entityCount: "2",
        values: [
          ["fixture-v1", locale === "zh-CN" ? "架构版本" : "Schema Version", "6"],
          // 两个实体之间留一格，面积应为包围盒 3×1，而非实体数量 2。
          ["3 x 1", locale === "zh-CN" ? "面积" : "Area", "3"],
        ],
        closed: true,
      });
    });
  }
}
