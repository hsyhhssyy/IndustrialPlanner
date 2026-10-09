import { expect, test, SCREEN_PROFILES } from "./harness/fixture";
import blueprint from "../fixtures/blueprints/e2e/copy-selection.schema7.json" with { type: "json" };

// 三屏场景装载、交互与截图开发验证完成后，独立验证基座边界。
for (const profile of SCREEN_PROFILES) {
  test(`基座隔离、只读观测与刷新持久化 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      const assert = (value, message) => { if (!value) throw new Error(message); };
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(() => {
        const ready = window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      }, null, {timeout:30000});
      const fresh = await page.evaluate(() => {
        const previous = localStorage.getItem('e2e-isolation-marker');
        localStorage.setItem('e2e-isolation-marker','owned');
        return previous;
      });
      assert(fresh === null, '不同测试 context 不得继承本地存储');
      const screen = await page.evaluate(() => window.__test__.getAppState().screen);
      assert(screen.deviceClass === ${JSON.stringify(profile.name)} && screen.hasTouch
        && screen.viewportWidth === ${profile.width} && screen.viewportHeight === ${profile.height}
        && screen.devicePixelRatio === ${profile.dpr}, '必须使用规定的真实 Screen Profile');
      const invalid = await page.evaluate(async () => {
        const before = JSON.stringify(window.__test__.document());
        let rejected = false;
        try { await window.__test__.loadBlueprint({}); } catch { rejected = true; }
        return rejected && before === JSON.stringify(window.__test__.document());
      });
      assert(invalid, '无效输入必须拒绝且不改变当前文档');
      const loaded = await page.evaluate(input => window.__test__.loadBlueprint(input), ${JSON.stringify(blueprint)});
      assert(JSON.stringify(loaded.entityIds) === ${JSON.stringify(JSON.stringify(blueprint.entityOrder))}, '完整装载固定实体身份');
      const readonly = await page.evaluate(() => {
        const snapshot = window.__test__.document();
        const id = 'e2e-copy-selection-1';
        snapshot.entities[id].position.x = 999;
        snapshot.entityOrder.length = 0;
        const state = window.__test__.getAppState();
        state.selection.push('invalid');
        return {ids:window.__test__.document().entityOrder, x:window.__test__.entity(id).position.x,
          selection:window.__test__.getAppState().selection};
      });
      assert(readonly.x === 15 && readonly.ids.length === 3 && readonly.selection.length === 0,
        '修改观测副本不能反向修改产品状态');
      const prepared = await page.evaluate(() => window.__test__.document().entityOrder);
      assert(JSON.stringify(prepared) === ${JSON.stringify(JSON.stringify([`protocol-core:${blueprint.baseId}`, ...blueprint.entityOrder]))},
        '装载完成即满足基地核心不变量，不能等到刷新才补齐');
      await page.getByRole('button',{name:'批量选择',exact:true}).click();
      await page.waitForFunction(() => window.__test__.getAppState().tool === 'marquee');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__test__.getAppState().tool === 'select');
      await page.reload();
      await page.waitForFunction(() => {
        const ready = window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      }, null, {timeout:30000});
      const persisted = await page.evaluate(() => ({ marker:localStorage.getItem('e2e-isolation-marker'),
        ids:window.__test__.document().entityOrder, baseId:window.__test__.getAppState().baseId }));
      assert(persisted.marker === 'owned', '同一 context 刷新必须保留真实存储');
      assert(JSON.stringify(persisted.ids) === JSON.stringify(prepared), '刷新不得重写场景实体身份或顺序');
      return persisted;
    }`, "contract.log");
    expect(result).toEqual({ marker: "owned", ids: [`protocol-core:${blueprint.baseId}`, ...blueprint.entityOrder], baseId: blueprint.baseId });
  });
}
