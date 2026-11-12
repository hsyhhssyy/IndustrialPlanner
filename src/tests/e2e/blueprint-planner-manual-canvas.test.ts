import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import separator from "../blueprint-planner/fixtures/separator-core.json" with { type: "json" };

// 2026-11-11：三屏开发验证完成后独立编写；覆盖真实触控裁决、画布像素与工作区隔离。
for (const profile of SCREEN_PROFILES) {
  test(`人工画布的原生拖动、快捷键与场景生命周期 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    test.setTimeout(180_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.goto(${JSON.stringify(baseURL)});
      // 2026-11-11：主画布完成挂载与初始视口同步后再建立隔离基线。
      await page.waitForFunction(()=>{const ready=window.__test__?.readiness();return ready?.assembled&&ready.canvasAttached&&ready.viewportValid;});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.waitForFunction(()=>JSON.stringify(window.__test__.document().documentSettings.viewport.center)
        ===JSON.stringify(window.__test__.getAppState().viewport.center));
      const originalDocument=await page.evaluate(()=>JSON.stringify(window.__test__.document()));
      await page.evaluate(async request=>{
        const controller=window.__industrialPlannerAppHost.blueprintPlannerDialog;
        await controller.open(request.plan);controller.updateOptions(request.options);
      },${JSON.stringify(separator.request)});
      const dialog=page.locator('[data-dialog-key="blueprint-planner"]');
      for(let index=0;index<4;index++)await dialog.getByRole('button',{name:'下一步',exact:true}).click();
      const manual=dialog.getByRole('region',{name:'人工摆放',exact:true});
      await manual.getByLabel('人工摆放预设建筑',{exact:true}).check();
      const prepared=()=>page.waitForFunction(()=>{
        const state=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual;
        if(state.error)throw Error(state.error);
        return !!state.layout?.preparation.nodes.length&&!state.loading;
      });
      await prepared();
      const palette=manual.getByRole('complementary',{name:'待摆设备'});
      const gas=palette.locator('details').filter({has:page.locator('summary',{hasText:'气体散布机'})});
      const paletteLayout={switch:await manual.getByRole('switch',{name:'人工摆放预设建筑'}).isChecked(),
        grouped:await gas.count()===1 && await gas.getAttribute('open')===null,
        counted:(await palette.getByRole('button').first().innerText()).includes('×'),
        unsupported:/热能池|洒水机/.test(await palette.innerText()),selects:await manual.locator('select').count()};
      const stage=manual.getByRole('application',{name:'人工布局画布'}),canvas=stage.locator('canvas');
      await canvas.waitFor();
      const originalCanvas=await canvas.elementHandle();
      await manual.getByRole('complementary',{name:'待摆设备'}).getByRole('button').first().click();
      await stage.scrollIntoViewIfNeeded();
      let box=await stage.boundingBox();
      const scroll=await dialog.locator('[class*="_pageScroll_"]').boundingBox();
      const top=Math.max(box.y,scroll.y),bottom=Math.min(box.y+box.height,scroll.y+scroll.height);
      const placeX=box.x+box.width*.34,placeY=top+(bottom-top)*.4;
      ${profile.isMobile ? "await page.touchscreen.tap(placeX,placeY);" : "await page.mouse.click(placeX,placeY);"}
      await page.waitForFunction(()=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements.length===1);
      await prepared();
      await stage.press('r');await prepared();
      const geometry=await page.evaluate(()=>{
        const host=window.__industrialPlannerAppHost,placement=host.blueprintPlannerDialog.manual.layout.placements[0];
        const definition=host.workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId);
        return {placement,width:placement.rotation%180?definition.footprint.height:definition.footprint.width,
          height:placement.rotation%180?definition.footprint.width:definition.footprint.height};
      });
      const before=await canvas.screenshot();
      await stage.scrollIntoViewIfNeeded();box=await stage.boundingBox();
      const cell=Math.min(box.width/30,box.height/20);
      const x=box.x+box.width/2+(geometry.placement.position.x+geometry.width/2-15)*cell;
      const y=box.y+box.height/2+(geometry.placement.position.y+geometry.height/2-10)*cell;
      if(${profile.isMobile}) {
        const cdp=await page.context().newCDPSession(page);let touching=false;
        try {
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});touching=true;
          await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+2*cell,y:y+cell,id:1}]});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});touching=false;
        } finally {
          if(touching)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await cdp.detach();
        }
      } else {
        await page.mouse.move(x,y);await page.mouse.down();
        await page.mouse.move(x+2*cell,y+cell,{steps:3});await page.mouse.up();
      }
      await page.waitForFunction(position=>{
        const current=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements[0].position;
        return current.x===position.x+2&&current.y===position.y+1;
      },geometry.placement.position);
      await prepared();
      const after=await canvas.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-moved.png"))}});
      await stage.press('Escape');
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-workspace.png"))},scale:'css'});
      return {paletteLayout,rotation:geometry.placement.rotation,changedPixels:!before.equals(after),
        reusedCanvas:await canvas.evaluate((element,original)=>element===original,originalCanvas),
        retainedWizard:await dialog.isVisible(),touchAction:await stage.evaluate(element=>getComputedStyle(element).touchAction),
        unchangedDocument:await page.evaluate(original=>JSON.stringify(window.__test__.document())===original,originalDocument),
        contained:await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)};
    }`);
    expect(result).toEqual({ paletteLayout: { switch: true, grouped: true, counted: true, unsupported: false, selects: 0 }, rotation: 90, changedPixels: true, reusedCanvas: true, retainedWizard: true,
      touchAction: "none", unchangedDocument: true, contained: true });
  });
}
