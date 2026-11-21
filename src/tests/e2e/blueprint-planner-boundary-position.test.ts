import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import separator from "../blueprint-planner/fixtures/separator-core.json" with { type: "json" };

// 2026-11-20：三屏开发验证后独立编写，只覆盖原生画布、拖边和标签裁切；位置规则矩阵由 Vitest 负责。
for (const profile of SCREEN_PROFILES) {
  test(`相对无界画布切换绝对边界后的原生交互 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    test.setTimeout(180_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(()=>{const r=window.__test__?.readiness();return r?.assembled&&r.canvasAttached&&r.viewportValid;});
      await page.evaluate(async request=>{const c=window.__industrialPlannerAppHost.blueprintPlannerDialog;await c.open(request.plan);c.updateOptions(request.options);},${JSON.stringify(separator.request)});
      const dialog=page.locator('[data-dialog-key="blueprint-planner"]');
      const next=()=>dialog.getByRole('button',{name:'下一步',exact:true}).click();
      for(let step=0;step<4;step++)await next();
      const options=dialog.getByRole('region',{name:'人工介入选项',exact:true});
      await options.getByRole('switch',{name:'人工摆放预设建筑',exact:true}).check();
      await options.getByRole('radio',{name:'相对摆放（无界）',exact:true}).check();
      await options.getByRole('radio',{name:'固定当前朝向',exact:true}).check();await next();
      // AI-REMOVED 2026-11-20:
      // Reason: 边界页正式名称统一为存取口与边界设置。
      // Trigger: REQ-051 相对无界与绝对有边界职责订正。
      // Evidence: 修后三屏原生开发验证均通过。
      // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
      // Original code:
      // await dialog.getByRole('region',{name:'存取线与存取口',exact:true}).getByRole('radiogroup',{name:'存取线底边方向',exact:true}).getByRole('radio',{name:'下',exact:true}).check();await next();
      const boundary=dialog.getByRole('region',{name:'存取口与边界设置',exact:true});
      await boundary.getByRole('radiogroup',{name:'存取线底边方向',exact:true}).getByRole('radio',{name:'下',exact:true}).check();await next();
      const manual=dialog.getByRole('region',{name:'人工摆放',exact:true});
      const stage=manual.getByRole('application',{name:'人工布局画布',exact:true}),canvas=stage.locator('canvas');
      const prepared=()=>page.waitForFunction(()=>{const m=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual;if(m.error)throw Error(m.error);return !!m.layout?.preparation.nodes.length&&!m.loading;});
      await prepared();await canvas.waitFor();await stage.scrollIntoViewIfNeeded();
      // AI-REMOVED 2026-11-20:
      // Reason: 相对无界由真实SceneSpace和原生平移证明，不通过脚本相机取景准备负坐标。
      // Trigger: REQ-051 相对无界与绝对有边界职责订正。
      // Evidence: 修后三屏原生开发验证均通过。
      // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
      // Original code:
      // // 仅准备初始取景；被测平移、缩放和放置全部通过原生事件。
      // await canvas.evaluate(element=>window.__test__.renderSurface(element).input.camera.actions.focusOnBounds({x:-25,y:-25,width:30,height:20},{durationMs:0,gridSize:1}));
      const unbounded=await canvas.evaluate(element=>Object.values(window.__test__.renderSurface(element).input.source.snapshot.getSnapshot().space.areas[0].bounds).every(value=>value===null));
      const before=await canvas.evaluate(element=>{const v=window.__test__.renderSurface(element).input.camera.state;return {x:v.center.x,cell:v.gridCellPixelSize};});
      await stage.focus();await page.keyboard.down('ArrowLeft');await page.waitForTimeout(650);await page.keyboard.up('ArrowLeft');
      await page.keyboard.down('ArrowUp');await page.waitForTimeout(650);await page.keyboard.up('ArrowUp');
      const box=await stage.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-100);await page.waitForTimeout(200);
      const moved=await canvas.evaluate(element=>{const v=window.__test__.renderSurface(element).input.camera.state;return {x:v.center.x,cell:v.gridCellPixelSize};});
      const palette=manual.getByRole('complementary',{name:'待摆设备'}).locator('button[aria-pressed]').first();
      if(${profile.isMobile})await palette.tap();else await palette.click();
      await stage.scrollIntoViewIfNeeded();const target=await stage.boundingBox(),x=target.x+target.width/2,y=target.y+target.height*.42;
      if(!${profile.isMobile})await page.mouse.move(x,y);
      await page.waitForFunction(()=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.ensureSession().editor.state.collections.preview.length===1);
      if(${profile.isMobile})await manual.getByRole('button',{name:'确认',exact:true}).tap();else await page.mouse.click(x,y);
      await page.waitForFunction(()=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements.length===1);
      await prepared();await stage.press('Escape');
      const original=await page.evaluate(()=>JSON.parse(JSON.stringify(window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements[0])));
      // AI-REMOVED 2026-11-20:
      // Reason: 定位与固定侧边前置到选项页；相对设备经原生向导切换绝对双侧，保留位置。
      // Trigger: REQ-051 相对无界与绝对有边界职责订正。
      // Evidence: 修后三屏原生开发验证均通过。
      // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
      // Original code:
      // await manual.getByRole('switch',{name:'锁定边界位置',exact:true}).check();
      // const base=manual.getByRole('spinbutton',{name:'底边坐标',exact:true}),initial=Number(await base.inputValue());
      // await base.fill(String(initial+3));await base.press('Enter');
      // await manual.getByRole('radiogroup',{name:'固定侧边',exact:true}).getByRole('radio',{name:'固定双侧',exact:true}).check();
      await dialog.getByRole('navigation',{name:'规划步骤'}).getByRole('button',{name:'人工介入选项',exact:true}).click();
      await options.getByRole('radio',{name:'绝对定位（有边界）',exact:true}).check();
      await options.getByRole('radiogroup',{name:'固定侧边',exact:true}).getByRole('radio',{name:'固定双侧',exact:true}).check();
      await next();await boundary.waitFor();await next();await prepared();
      const base=manual.getByRole('spinbutton',{name:'底边坐标',exact:true}),initial=Number(await base.inputValue());
      const finite=await canvas.evaluate(element=>Object.values(window.__test__.renderSurface(element).input.source.snapshot.getSnapshot().space.areas[0].bounds).filter(value=>value!==null).length===3);
      const leftInput=manual.getByRole('spinbutton',{name:'左侧坐标',exact:true}),rightInput=manual.getByRole('spinbutton',{name:'右侧坐标',exact:true});
      const left=Number(await leftInput.inputValue()),right=Number(await rightInput.inputValue());
      await leftInput.fill(String(left-3));await leftInput.press('Enter');await rightInput.fill(String(right+3));await rightInput.press('Enter');
      await manual.getByRole('button',{name:'查看边界',exact:true}).click();
      const handle=manual.locator('[data-boundary-handle="base"]');
      for(let attempt=0;attempt<16&&await handle.evaluate(el=>getComputedStyle(el).visibility==='hidden');attempt++){
        const direction=await canvas.evaluate(element=>{const camera=window.__test__.renderSurface(element).input.camera;const position=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.boundary.position;return position.base>camera.state.center.y?'ArrowDown':'ArrowUp';});
        await stage.focus();await page.keyboard.down(direction);await page.waitForTimeout(45);await page.keyboard.up(direction);await page.waitForTimeout(35);
      }
      await handle.waitFor({state:'visible'});
      const labelLayout=await manual.locator('[data-boundary-handle]').evaluateAll(handles=>{
        const visible=handles.filter(el=>getComputedStyle(el).visibility!=='hidden');
        const rectangles=visible.map(el=>el.getBoundingClientRect());
        const contained=visible.every((el,index)=>{const b=rectangles[index],p=el.parentElement.getBoundingClientRect();return b.left>=p.left-1&&b.right<=p.right+1&&b.top>=p.top-1&&b.bottom<=p.bottom+1;});
        let separated=true;for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){const a=rectangles[i],b=rectangles[j];if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)separated=false;}
        return {contained,separated};
      });
      const h=await handle.boundingBox(),cell=await canvas.evaluate(element=>window.__test__.renderSurface(element).input.camera.state.gridCellPixelSize);
      const hx=h.x+h.width/2,hy=h.y+h.height/2;
      if(${profile.isMobile}){
        const cdp=await page.context().newCDPSession(page);let active=false;
        try {
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hx,y:hy,id:1}]});active=true;
          for(let step=1;step<=5;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:hx,y:hy-cell*step/5,id:1}]});
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});active=false;
        } finally {if(active)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
      } else {await page.mouse.move(hx,hy);await page.mouse.down();await page.mouse.move(hx,hy-cell,{steps:5});await page.mouse.up();}
      // AI-REMOVED 2026-11-20:
      // Reason: 绝对入口按设备完整占地自动留三格，拖一格后再跨四格触发真实越界。
      // Trigger: REQ-051 相对无界与绝对有边界职责订正。
      // Evidence: 修后三屏原生开发验证均通过。
      // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
      // Original code:
      // await page.waitForFunction(value=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.boundary.position.base===value,initial+2);
      // const dragSynced=Number(await base.inputValue())===initial+2;
      // await base.fill(String(initial-1));await base.press('Enter');await prepared();
      await page.waitForFunction(value=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.boundary.position.base===value,initial-1);
      const dragSynced=Number(await base.inputValue())===initial-1;
      await base.fill(String(initial-4));await base.press('Enter');await prepared();
      const conflict=await page.evaluate(()=>{const m=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual;return {blocked:m.blocked(),invalid:m.invalidPositions(),placement:JSON.parse(JSON.stringify(m.layout.placements[0]))};});
      const alertVisible=await manual.getByRole('alert').isVisible(),nextDisabled=await dialog.getByRole('button',{name:'下一步',exact:true}).isDisabled();
      const redDevice=await canvas.evaluate(element=>{const surface=window.__test__.renderSurface(element);surface.app.render();const gl=surface.app.renderer.gl,data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);let red=0;for(let i=0;i<data.length;i+=4)if(data[i]>150&&data[i]>data[i+1]*1.5&&data[i]>data[i+2]*1.5)red++;return red>20;});
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory,"boundary-conflict.png"))},scale:'css'});
      await stage.focus();await stage.press('Control+z');await prepared();
      // AI-REMOVED 2026-11-20:
      // Reason: undo回到本轮真实拖动后的底边。
      // Trigger: REQ-051 相对无界与绝对有边界职责订正。
      // Evidence: 修后三屏原生开发验证均通过。
      // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
      // Original code:
      // const undoRestored=Number(await base.inputValue())===initial+2&&!await manual.getByRole('alert').count();
      const undoRestored=Number(await base.inputValue())===initial-1&&!await manual.getByRole('alert').count();
      return {unbounded,finite,nativePan:moved.x<before.x,nativeZoom:moved.cell!==before.cell,negativePlacement:original.position.x<0&&original.position.y<0,labelsContained:labelLayout.contained,labelsSeparated:labelLayout.separated,dragSynced,conflictMarked:conflict.blocked&&conflict.invalid.includes(original.referenceNode.id),retainedDevice:JSON.stringify(conflict.placement)===JSON.stringify(original),alertVisible,nextDisabled,redDevice,undoRestored};
    }`);
    expect(result).toEqual({ unbounded: true, finite: true, nativePan: true, nativeZoom: true, negativePlacement: true, labelsContained: true, labelsSeparated: true,
      dragSynced: true, conflictMarked: true, retainedDevice: true, alertVisible: true, nextDisabled: true, redDevice: true, undoRestored: true });
  });
}
