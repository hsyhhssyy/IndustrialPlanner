import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

// 三屏开发验证完成后独立编写；普通文档规则由 Editor 测试覆盖，此处验证真实菜单与 Canvas 命中、拖动、剪切。
for (const profile of SCREEN_PROFILES) {
  test(`草稿箱核心通过菜单新增、画布移动与剪切摆放 [${profile.name}]`, async ({ browserSession }) => {
    test.setTimeout(300_000);
    const cli = await browserSession.openCli(profile);
    const report = await cli.runJson(`async page => {
      await page.goto('http://127.0.0.1:4174/', {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => {
        const ready = window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      });
      const snapshot = () => page.evaluate(() => window.__test__.document());
      const countCores = document => Object.values(document.entities)
        .filter(entity => entity.definitionId === 'sp_hub_1' || entity.definitionId === 'sp_sub_hub_1').length;
      const waitCount = count => page.waitForFunction(count => Object.values(window.__test__.document().entities)
        .filter(entity => entity.definitionId === 'sp_hub_1' || entity.definitionId === 'sp_sub_hub_1').length === count, count);
      const point = position => page.evaluate(position => window.__test__.gridPoint(position), position);
      const pan = (x,y) => page.evaluate(({x,y}) => {
        const editor = window.__industrialPlannerAppHost.workspace.editor;
        editor.actions.zoom(-100);
        const viewport = editor.state.viewport;
        const startClientPixel = {x:viewport.clientRect.left + viewport.clientRect.width/2,
          y:viewport.clientRect.top + viewport.clientRect.height/2};
        editor.actions.moveViewportByClientPixelVector({startClientPixel,endClientPixel:{
          x:startClientPixel.x+(viewport.center.x-x)*viewport.gridCellPixelSize,
          y:startClientPixel.y+(viewport.center.y-y)*viewport.gridCellPixelSize}});
      }, {x,y});
      const clickGrid = async position => {const p=await point(position);await page.mouse.move(p.x,p.y);await page.mouse.click(p.x,p.y);};
      const toolbar = page.locator('aside[class*="left-toolbar"]');
      const ordinaryMenuCount = await page.locator('[data-ui-button-id="placement-sp_hub_1"]').count();
      const baseButton = toolbar.getByRole('button',{name:'基地',exact:true});
      if(await baseButton.getAttribute('aria-pressed')!=='true') await baseButton.click();
      await page.locator('[data-ui-button-id="base-current-select"]').click();
      const dialog = page.getByRole('dialog',{name:'选择基地',exact:true});
      await dialog.locator('[data-base-id="draft_box"]').click();
      await dialog.getByRole('button',{name:'确定',exact:true}).click();
      await page.waitForFunction(() => window.__test__.getAppState().baseId === 'draft_box');
      if(await baseButton.getAttribute('aria-pressed')==='true') await baseButton.click();
      await toolbar.getByRole('button',{name:'放置模式',exact:true}).click();
      await waitCount(1);
      const initial = await snapshot();
      const initialId = initial.entityOrder[0];
      await pan(30,30);
      await page.locator('[data-ui-button-id="placement-sp_hub_1"]').click();
      await clickGrid({x:30,y:30});await waitCount(2);
      await page.keyboard.press('Escape');
      const manuallyPlaced = await snapshot();

      // 聚焦只准备视口；实体移动由鼠标拖动并点击确认完成。
      await page.evaluate(id => window.__test__.focusEntity(id),initialId);
      const original = (await snapshot()).entities[initialId];
      const from = await point({x:original.position.x+4,y:original.position.y+4});
      const to = {x:from.x+44,y:from.y+28};
      await page.mouse.move(from.x,from.y);await page.mouse.down();
      await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();
      await page.mouse.click(to.x,to.y);
      await page.waitForFunction(({id,position}) => {
        const entity = window.__test__.document().entities[id];
        return entity && (entity.position.x!==position.x || entity.position.y!==position.y);
      }, {id:initialId,position:original.position});
      const moved = await snapshot();
      await page.keyboard.press('Escape');

      const entity = moved.entities[initialId];
      await pan(entity.position.x+4.5,entity.position.y+4.5);
      await page.locator('[data-ui-button-id="placement-tool-marquee"]').click();
      const a = await point({x:entity.position.x-2,y:entity.position.y-2});
      const b = await point({x:entity.position.x+11,y:entity.position.y+11});
      await page.mouse.move(a.x,a.y);await page.mouse.down();
      await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
      await page.waitForFunction(id => {
        const selected = window.__test__.getAppState().selection;
        return selected.length===1 && selected[0]===id;
      },initialId);
      await page.keyboard.press('Control+x');await waitCount(1);
      const cut = await snapshot();
      await pan(70,70);await clickGrid({x:70,y:70});await waitCount(2);
      await page.keyboard.press('Escape');
      const placed = await snapshot();
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "draft-core-canvas.png"))}});
      return {ordinaryMenuCount,initialCount:countCores(initial),manualCount:countCores(manuallyPlaced),
        movedCount:countCores(moved),cutCount:countCores(cut),placedCount:countCores(placed),
        originalRemovedByCut:cut.entities[initialId]===undefined,
        originalAbsentAfterPlacement:placed.entities[initialId]===undefined,
        manualCoreRetained:Object.keys(manuallyPlaced.entities).filter(id=>id!==initialId)
          .every(id=>placed.entities[id]!==undefined),
        screen:await page.evaluate(()=>window.__test__.readiness().screen)};
    }`);
    expect(report).toMatchObject({
      ordinaryMenuCount: 0, initialCount: 1, manualCount: 2, movedCount: 2,
      cutCount: 1, placedCount: 2, originalRemovedByCut: true,
      originalAbsentAfterPlacement: true, manualCoreRetained: true,
      screen: { viewportWidth: profile.width, viewportHeight: profile.height,
        devicePixelRatio: profile.dpr, deviceClass: profile.name, screenShape: profile.shape, hasTouch: true },
    });
  });
}
