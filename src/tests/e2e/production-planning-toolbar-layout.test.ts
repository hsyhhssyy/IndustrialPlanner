import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

// 2026-10-26：三屏开发验证完成后独立编写；仅覆盖真实布局，原料和配方状态由 production-planning-ui.test.tsx 验证。
// 2026-10-26：使用植物加工目标，回归新增种子节点的首列边界；植物回路结构由 process-graph-builder.test.ts 验证。
for (const profile of SCREEN_PROFILES) {
  test(`产线规划三栏高度、顶栏与节点交互：${profile.name}`, async ({ browserSession, baseURL }) => {
    test.setTimeout(150_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(() => {
        const ready = window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      });
      // 正式存储 API 仅准备配方偏好；目标、视图与支线操作仍使用真实 UI。
      await page.evaluate(async () => {
        const storage = await import('/src/shared/storage/planner-storage.ts');
        await storage.savePlannerState({
          targets: [], supplies: [], displayMode: 'item', viewMode: 'process', useModules: false,
          recipeChoices: {
            item_xiranite_enr_powder: 'liquid_transmuter_2_solid_xiranite_enr_powder_1',
            item_filter_core: 'tools_proc_filter_core_2',
          }, recipeChoicesDemandSignature: null,
          sourceConfig: { waterPolicy: 'use-byproduct', acidPolicy: 'use-byproduct', sewagePolicy: 'external-supply',
            waterPurifierPolicy: 'disabled', includeDeviceMinimumConsumption: 'fractional' },
          session: storage.createDefaultPlannerSessionState(),
        });
      });
      await page.reload();
      await page.waitForFunction(() => {
        const ready = window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      });
      await page.getByRole('button', { name: '工具箱', exact: true }).click();
      await page.getByText('产线规划', { exact: true }).click();
      const panel = page.locator('[class*="production-planning-panel_"]');
      const toolbar = panel.locator('[class*="production-planning-toolbar_"]');
      // 2026-10-30：结果页滑动结束后再测量绝对坐标，避免将入场位移误判为节点锚定失效。
      const waitForResultTransition = () => panel.locator('[class*="production-planning-stage_"]').evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished));
      });
      await toolbar.getByRole('switch', { name: '使用模块' }).waitFor({ state: 'attached' });
      const inputToolbarAtTop = await toolbar.evaluate(element =>
        Math.abs(element.getBoundingClientRect().top - element.parentElement.getBoundingClientRect().top) < 1);
      const config = panel.locator('[class*="production-planning-config_"]');
      const readColumnLayout = () => config.evaluate(element => {
        const box = element.getBoundingClientRect(), css = getComputedStyle(element);
        const top = box.top + element.clientTop + parseFloat(css.paddingTop);
        const bottom = box.top + element.clientTop + element.clientHeight - parseFloat(css.paddingBottom);
        const columns = Array.from(element.children).map(section => section.getBoundingClientRect());
        return { height: bottom - top, count: columns.length,
          filled: columns.every(column => Math.abs(column.top - top) < 1 && Math.abs(column.bottom - bottom) < 1) };
      });
      const emptyColumns = await readColumnLayout();
      const source = config.locator(':scope > section').nth(2);
      const sourceOverflows = await source.evaluate(element => element.scrollHeight > element.clientHeight + 1);
      let independentScroll = true;
      if (sourceOverflows) {
        await source.hover();
        await page.mouse.wheel(0, 400);
        await page.waitForFunction(() => document.querySelector('[class*="production-planning-config_"]').children[2].scrollTop > 0);
        independentScroll = await config.evaluate(element => element.scrollTop === 0
          && element.children[0].scrollTop === 0 && element.children[1].scrollTop === 0 && element.children[2].scrollTop > 0);
        await page.mouse.wheel(0, -100000);
        await page.waitForFunction(() => document.querySelector('[class*="production-planning-config_"]').children[2].scrollTop === 0);
      }
      const guideImages = panel.locator('[class*="production-planning-material-guide_"] figure > [role="img"]');
      const guideLayouts = [];
      for (let i = 0; i < 2; i++) {
        await guideImages.nth(i).scrollIntoViewIfNeeded();
        guideLayouts.push(await guideImages.nth(i).evaluate(element => {
          const stage = element.getBoundingClientRect();
          const action = element.querySelector('[class*="production-planning-guide-action"]').getBoundingClientRect();
          return { width: stage.width, height: stage.height,
            inside: action.left >= stage.left && action.right <= stage.right && action.top >= stage.top && action.bottom <= stage.bottom };
        }));
      }
      await panel.getByRole('button', { name: '添加目标', exact: true }).click();
      await page.getByPlaceholder('搜索物品或设备…').fill('芽针粉末');
      await page.locator('button').filter({
        has: page.locator('[class*="encyclopedia-card-label"]', { hasText: /^芽针粉末$/ }),
      }).click();
      const populatedColumns = await readColumnLayout();
      await toolbar.getByRole('button', { name: '计算', exact: true }).click();
      await waitForResultTransition();
      // 2026-10-29：三屏开发验证通过后补充两态操作栏的真实几何回归。
      const toolbarLayout = await toolbar.evaluate(element => {
        const actions = element.querySelector('[class*="production-planning-toolbar-controls_"]');
        const primary = actions.lastElementChild.getBoundingClientRect(), bounds = element.getBoundingClientRect();
        const heights = [...element.querySelectorAll('button')].map(button =>
          (button.closest('[class*="production-planning-segmented_"]') || button).getBoundingClientRect().height);
        return { primaryAtTopRight: bounds.right - primary.right <= 15 && primary.top - bounds.top <= 12,
          uniformHeight: heights.every(height => Math.abs(height - 38) < 1),
          overflow: element.scrollWidth > element.clientWidth + 1,
          calculationHidden: ![...element.querySelectorAll('button')].some(button => button.textContent.trim() === '计算'),
          modulesHidden: !element.querySelector('[role="switch"]') };
      });
      const graph = panel.locator('[class*="process-graph-canvas"]');
      const seed = graph.getByRole('button', { name: '芽针种子', exact: true });
      await seed.waitFor();
      const seedBox = await seed.boundingBox(), graphBox = await graph.boundingBox();
      const seedInitiallyInside = Boolean(seedBox && graphBox && seedBox.x >= graphBox.x
        && seedBox.x + seedBox.width <= graphBox.x + graphBox.width
        && seedBox.y >= graphBox.y && seedBox.y + seedBox.height <= graphBox.y + graphBox.height);
      await graph.getByRole('button', { name: '芽针粉末', exact: true }).click();
      const nodeBefore = await graph.getByRole('button', { name: '芽针粉末', exact: true }).boundingBox();
      const popup = graph.getByRole('dialog', { name: '芽针粉末', exact: true });
      await popup.waitFor();
      await popup.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      const popupLayout = await popup.evaluate(element => {
        const box = element.getBoundingClientRect(), canvas = element.parentElement.getBoundingClientRect();
        return {
          inside: box.left >= canvas.left && box.right <= canvas.right && box.top >= canvas.top && box.bottom <= canvas.bottom,
          actionsVisible: Array.from(element.querySelectorAll('button')).every(button => {
            const action = button.getBoundingClientRect();
            return action.top >= box.top && action.bottom <= box.bottom && action.left >= box.left && action.right <= box.right;
          }),
          labels: Array.from(element.querySelectorAll('button')).map(button => button.textContent.trim()),
        };
      });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "process-popup.png"))} });
      await popup.getByRole('button', { name: '设为原料', exact: true }).click();
      await graph.locator('[class*="process-node-material"]').waitFor();
      const nodeAfter = await graph.getByRole('button', { name: '芽针粉末', exact: true }).boundingBox();
      const nodeAnchored = Boolean(nodeBefore && nodeAfter
        && Math.abs(nodeBefore.x - nodeAfter.x) < 1 && Math.abs(nodeBefore.y - nodeAfter.y) < 1);
      await graph.getByRole('button', { name: '芽针粉末', exact: true }).click();
      await popup.getByRole('button', { name: '移除外部供给', exact: true }).click();
      await graph.locator('[class*="process-node-material"]').waitFor({ state: 'detached' });
      await toolbar.getByRole('button', { name: '树表', exact: true }).click();
      const detail = panel.locator('[class*="production-planning-tree-detail-stack"]');
      const originalStyle = await detail.getAttribute('style');
      const states = [];
      try {
        for (const [width, expected] of [[240, 'visible'], [160, 'hidden'], [240, 'visible']]) {
          await detail.evaluate((element, width) => {
            element.style.width = width + 'px';
            element.style.maxWidth = 'none';
          }, width);
          await page.waitForFunction(expected => {
            const label = document.querySelector('[class*="production-planning-supply-action-container"] button > span');
            return label && getComputedStyle(label).visibility === expected;
          }, expected);
          states.push(await detail.getByRole('button', { name: '设为原料', exact: true }).evaluate(button => {
            const label = button.querySelector('span');
            return { label: getComputedStyle(label).visibility,
              named: button.getAttribute('aria-label'), inside: button.getBoundingClientRect().width <= button.parentElement.getBoundingClientRect().width + 1 };
          }));
        }
      } finally {
        await detail.evaluate((element, style) => {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        }, originalStyle);
      }
      await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "tree.png"))} });
      await toolbar.getByRole('button', { name: '修改', exact: true }).click();
      await config.locator(':scope > section').first().getByRole('button', { name: '移除', exact: true }).click();
      await panel.getByRole('button', { name: '添加目标', exact: true }).click();
      await page.getByPlaceholder('搜索物品或设备…').fill('重息壤');
      await page.locator('button').filter({
        has: page.locator('[class*="encyclopedia-card-label"]', { hasText: /^重息壤$/ }),
      }).click();
      await toolbar.getByRole('button', { name: '计算', exact: true }).click();
      await waitForResultTransition();
      const branch = graph.getByRole('button', { name: '展开分离芯的上游分支', exact: true });
      await branch.focus();
      const branchBefore = await branch.boundingBox();
      await branch.press('Enter');
      const collapse = graph.getByRole('button', { name: '收起分离芯的上游分支', exact: true });
      await collapse.waitFor();
      const branchAfter = await collapse.boundingBox();
      const branchAnchored = Boolean(branchBefore && branchAfter
        && Math.abs(branchBefore.x - branchAfter.x) < 1 && Math.abs(branchBefore.y - branchAfter.y) < 1);
      const branchFocusPreserved = await collapse.evaluate(element => document.activeElement === element);
      await page.screenshot({ path: ${JSON.stringify(resolve(cli.directory, "branch-expanded.png"))} });
      await collapse.press('Space');
      await branch.waitFor();
      return { inputToolbarAtTop, toolbarLayout, columnLayouts: [emptyColumns, populatedColumns], independentScroll, guideLayouts, popupLayout,
        nodeAnchored, seedInitiallyInside, branchAnchored, branchFocusPreserved, states };
    }`) as { inputToolbarAtTop: boolean; popupLayout: { inside: boolean; actionsVisible: boolean; labels: string[] };
      toolbarLayout: { primaryAtTopRight: boolean; uniformHeight: boolean; overflow: boolean; calculationHidden: boolean; modulesHidden: boolean };
      guideLayouts: { width: number; height: number; inside: boolean }[]; nodeAnchored: boolean;
      columnLayouts: { height: number; count: number; filled: boolean }[]; independentScroll: boolean; seedInitiallyInside: boolean;
      branchAnchored: boolean; branchFocusPreserved: boolean;
      states: { label: string; named: string; inside: boolean }[] };
    expect(result.inputToolbarAtTop).toBe(true);
    expect(result.toolbarLayout).toEqual({ primaryAtTopRight: true, uniformHeight: true, overflow: false, calculationHidden: true, modulesHidden: true });
    expect(result.columnLayouts.every(layout => layout.height > 0 && layout.count === 3 && layout.filled)).toBe(true);
    expect(result.independentScroll).toBe(true);
    expect(result.popupLayout).toEqual({ inside: true, actionsVisible: true, labels: ["设为原料", "选择配方"] });
    expect(result.guideLayouts).toHaveLength(2);
    expect(result.guideLayouts.every(image => image.width > 0 && image.height > 0 && image.inside)).toBe(true);
    expect(result.nodeAnchored).toBe(true);
    expect(result.seedInitiallyInside).toBe(true);
    expect(result.branchAnchored).toBe(true);
    expect(result.branchFocusPreserved).toBe(true);
    expect(result.states.map(state => state.label)).toEqual(["visible", "hidden", "visible"]);
    expect(result.states.every(state => state.inside && state.named === "设为原料")).toBe(true);
  });
}
