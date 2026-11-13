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
      // 2026-11-13：真实布局验证单排设置、折叠圆点和组件自有按钮尺寸，防止只有状态正确而画面不可用。
      const controlsShareRow=await manual.evaluate(element=>{
        const toggle=element.querySelector('[role="switch"]').closest('label').getBoundingClientRect();
        const choices=element.querySelector('[role="radiogroup"]').getBoundingClientRect();
        return Math.abs(toggle.y+toggle.height/2-choices.y-choices.height/2)<2;
      });
      const oldToolbarAbsent=await manual.getByRole('button',{name:'重置视图',exact:true}).count()===0;
      await dialog.getByRole('button',{name:'收起规划步骤',exact:true}).click();
      const steps=dialog.getByRole('navigation',{name:'规划步骤'});
      const compactSteps=await steps.evaluate(element=>{
        const dots=[...element.querySelectorAll('button[data-state]')].map(button=>button.getBoundingClientRect());
        return element.innerText.trim()===''&&dots.length===6&&dots.every(rect=>Math.abs(rect.y-dots[0].y)<2);
      });
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-collapsed-steps.png"))},scale:'css'});
      await dialog.getByRole('button',{name:'展开规划步骤',exact:true}).click();
      const expandedSteps=await steps.getByRole('button',{name:'人工摆放',exact:true}).isVisible();
      const originalCanvas=await canvas.elementHandle();
      // AI-REMOVED 2026-11-12:
      // Reason: 统一触控放置保留虚影并显式确认；鼠标提交须等待命中虚影建立。
      // Trigger: REQ-048 人工布局复用统一画布手势与独立 View。
      // Evidence: 首轮 E2E trace 停在旧直接提交等待；三屏临时验证已确认触控虚影加确认。
      // Replacement: 下方原生事件与所属 View 坐标；Risk: Low；Human Review: Required
      // Original code:
      // await manual.getByRole('complementary',{name:'待摆设备'}).getByRole('button').first().click();
      // await stage.scrollIntoViewIfNeeded();
      // let box=await stage.boundingBox();
      // const scroll=await dialog.locator('[class*="_pageScroll_"]').boundingBox();
      // const top=Math.max(box.y,scroll.y),bottom=Math.min(box.y+box.height,scroll.y+scroll.height);
      // const placeX=box.x+box.width*.34,placeY=top+(bottom-top)*.4;
      // ${profile.isMobile ? "await page.touchscreen.tap(placeX,placeY);" : "await page.mouse.click(placeX,placeY);"}
      // await page.waitForFunction(()=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements.length===1);
      // await prepared();
      // await stage.press('r');await prepared();
      const pendingDevice=manual.getByRole('complementary',{name:'待摆设备'}).getByRole('button').first();
      if(${profile.isMobile}) await pendingDevice.tap(); else await pendingDevice.click();
      await stage.scrollIntoViewIfNeeded();
      const placeBox=await stage.boundingBox();
      const placeX=placeBox.x+placeBox.width/2,placeY=placeBox.y+placeBox.height/2;
      if(!${profile.isMobile}) await page.mouse.move(placeX,placeY);
      await page.waitForFunction(()=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.ensureSession().editor.state.collections.preview.length===1);
      const paletteSuppressed=await palette.isVisible()===!${profile.isMobile};
      // 2026-11-13：触屏使用 SVG 按钮，桌面使用已发布键鼠图片与 CSS mask；两者都验证真实尺寸和资源。
      const toolbarIconsVisible=await manual.locator(${profile.isMobile
        ? JSON.stringify('[data-ui-button-id] svg') : JSON.stringify('[data-toolbar-operation-id] img')}).evaluateAll(async icons=>{
        await Promise.all(icons.filter(icon=>icon instanceof HTMLImageElement).map(icon=>icon.decode()));
        return icons.length>0&&icons.every(icon=>{
          const rect=icon.getBoundingClientRect();
          return rect.width>=16&&rect.height>=16&&(!(icon instanceof HTMLImageElement)
            || icon.naturalWidth>0&&getComputedStyle(icon.parentElement,'::after').maskImage!=='none');
        });
      });
      // 键盘旋转在正式提交前作用于虚影，触控仍由原生确认按钮提交。
      await stage.press('r');
      if(${profile.isMobile}) await manual.getByRole('button',{name:'确认',exact:true}).tap();
      else await page.mouse.click(placeX,placeY);
      await page.waitForFunction(()=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements.length===1);
      await prepared();await stage.press('Escape');
      const paletteRestored=await palette.isVisible();
      // 透明 WebGL 输出必须满足预乘 alpha；非零透明底色会使半透明网格和设备边缘泛白。
      const pixels=await canvas.evaluate(element=>{
        const surface=window.__test__.renderSurface(element);surface.app.render();
        const gl=surface.app.renderer.gl,width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
        const data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);
        let invalid=0,translucent=0;
        for(let i=0;i<data.length;i+=4){const alpha=data[i+3];
          if(alpha<250&&Math.max(data[i],data[i+1],data[i+2])>alpha+2)invalid++;
          if(alpha>30&&alpha<220)translucent++;
        }
        return {invalid,translucent};
      });
      if(pixels.invalid!==0||pixels.translucent<100)throw Error('Canvas alpha/grid regression: '+JSON.stringify(pixels));
      const geometry=await page.evaluate(()=>{
        const host=window.__industrialPlannerAppHost,placement=host.blueprintPlannerDialog.manual.layout.placements[0];
        const definition=host.workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId);
        return {placement,width:placement.rotation%180?definition.footprint.height:definition.footprint.width,
          height:placement.rotation%180?definition.footprint.width:definition.footprint.height};
      });
      const before=await canvas.screenshot();
      // AI-REMOVED 2026-11-12:
      // Reason: 移除固定 30×20 取景估算，实际相机由所属 View 管理。
      // Trigger: REQ-048 人工布局复用统一画布手势与独立 View。
      // Evidence: 首轮 E2E trace 停在旧直接提交等待；三屏临时验证已确认触控虚影加确认。
      // Replacement: 下方原生事件与所属 View 坐标；Risk: Low；Human Review: Required
      // Original code:
      // await stage.scrollIntoViewIfNeeded();box=await stage.boundingBox();
      // const cell=Math.min(box.width/30,box.height/20);
      // const x=box.x+box.width/2+(geometry.placement.position.x+geometry.width/2-15)*cell;
      // const y=box.y+box.height/2+(geometry.placement.position.y+geometry.height/2-10)*cell;
      await stage.scrollIntoViewIfNeeded();
      const position=await canvas.evaluate((element,geometry)=>{
        const view=window.__test__.renderSurface(element).input.camera;
        const rect=view.queries.findClientRectForGridCell({
          x:geometry.placement.position.x+Math.floor(geometry.width/2),
          y:geometry.placement.position.y+Math.floor(geometry.height/2),
        });
        if(!rect)throw Error('人工画布坐标尚未就绪');
        return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,cell:view.state.gridCellPixelSize};
      },geometry);
      const {x,y,cell}=position;
      // 2026-11-13：逐帧观察正在拖动的虚影，避免只比较拖动前后的截图而漏掉中途消失。
      const bodyAudit=await canvas.evaluateHandle(element=>{
        const surface=window.__test__.renderSurface(element),frames=[];
        let ready=false;
        const listener={postrender(){
          const ids=surface.input.source.snapshot.getSnapshot().interaction?.collections.preview??[];
          if(ids.length===0)return;
          const visibleIds=new Set();
          const visit=node=>{
            if(node.label==='device.body'&&node.texture?.width>1){
              let visible=true,owner=null;
              for(let parent=node;parent;parent=parent.parent){
                visible=visible&&parent.visible&&parent.alpha>0;
                for(const id of ids)if(parent.label?.startsWith('entity.'+id+'.'))owner=id;
              }
              if(visible&&owner!==null)visibleIds.add(owner);
            }
            node.children?.forEach(visit);
          };
          visit(surface.app.stage);
          const visible=ids.every(id=>visibleIds.has(id));
          if(visible)ready=true;
          if(ready)frames.push(visible);
        }};
        surface.app.renderer.runners.postrender.add(listener);
        return {stop(){surface.app.renderer.runners.postrender.remove(listener);return frames;}};
      });
      let dragFrames=[];
      try {
      if(${profile.isMobile}) {
        const cdp=await page.context().newCDPSession(page);let touching=false;
        try {
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});touching=true;
          await page.waitForTimeout(700);
          for(let step=1;step<=8;step++) {
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+2*cell*step/8,y:y+cell*step/8,id:1}]});
            await page.waitForTimeout(25);
          }
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});touching=false;
        } finally {
          if(touching)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await cdp.detach();
        }
      } else {
        await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(700);
        await page.mouse.move(x+2*cell,y+cell,{steps:3});await page.mouse.up();
      }
      await page.waitForTimeout(100);
      } finally {
        dragFrames=await bodyAudit.evaluate(audit=>audit.stop());
        await bodyAudit.dispose();
      }
      const continuousDragBody=dragFrames.length>1&&dragFrames.every(Boolean);
      if(${profile.isMobile}) await manual.getByRole('button',{name:'确认',exact:true}).tap();
      else await page.mouse.click(x+2*cell,y+cell);
      await page.waitForFunction(position=>{
        const current=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements[0].position;
        return current.x===position.x+2&&current.y===position.y+1;
      },geometry.placement.position);
      await prepared();
      const after=await canvas.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-moved.png"))}});
      await stage.press('Escape');
      await page.mouse.move(0,0);
      const settled=await canvas.screenshot();await page.waitForTimeout(200);
      const stablePlacedPixels=settled.equals(await canvas.screenshot());
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-workspace.png"))},scale:'css'});
      // 2026-11-12：原生触控策略由手工场景外层 stage 承担，CanvasPanel 的 application 节点位于其内部。
      return {paletteLayout,controlsShareRow,oldToolbarAbsent,compactSteps,expandedSteps,paletteSuppressed,paletteRestored,toolbarIconsVisible,stablePlacedPixels,continuousDragBody,
        rotation:geometry.placement.rotation,changedPixels:!before.equals(after),
        reusedCanvas:await canvas.evaluate((element,original)=>element===original,originalCanvas),
        retainedWizard:await dialog.isVisible(),touchAction:await stage.evaluate(element=>{const surface=element.closest('[class*="_stage_"]');if(!surface)throw new Error('Missing manual input surface');return getComputedStyle(surface).touchAction;}),
        unchangedDocument:await page.evaluate(original=>JSON.stringify(window.__test__.document())===original,originalDocument),
        contained:await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)};
    }`);
    expect(result).toEqual({ paletteLayout: { switch: true, grouped: true, counted: true, unsupported: false, selects: 0 },
      controlsShareRow: true, oldToolbarAbsent: true, compactSteps: true, expandedSteps: true, paletteSuppressed: true, paletteRestored: true, toolbarIconsVisible: true,
      stablePlacedPixels: true, continuousDragBody: true,
      rotation: 90, changedPixels: true, reusedCanvas: true, retainedWizard: true,
      touchAction: "none", unchangedDocument: true, contained: true });
  });
}
