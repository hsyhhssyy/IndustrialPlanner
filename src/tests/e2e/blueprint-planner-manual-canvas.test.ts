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
      // AI-REMOVED 2026-11-20:
      // Reason: 人工开关前置到选项页，方向页位于画布之前。
      // Trigger: REQ-051 三步人工流程与边界定位。
      // Evidence: 三屏开发验证完成，人工选项及方向先于画布。
      // Replacement: 下方当前流程和可见性检查。
      // Risk: Low；保留原生画布、生命周期和工作台隔离断言。Human Review: Required
      // Original code:
      // const manual=dialog.getByRole('region',{name:'人工摆放',exact:true});
      // await manual.getByLabel('人工摆放预设建筑',{exact:true}).check();
      const options=dialog.getByRole('region',{name:'人工介入选项',exact:true});
      await options.getByRole('switch',{name:'人工摆放预设建筑',exact:true}).check();
      const enabled=await options.getByRole('switch',{name:'人工摆放预设建筑',exact:true}).isChecked();
      await options.getByRole('radio',{name:'固定当前朝向',exact:true}).check();
      const optionControlsVisible=await options.locator('[role="switch"], [role="radiogroup"]').evaluateAll(controls=>
        // AI-REMOVED 2026-11-20:
        // Reason: 相对默认选项新增摆放方式组，原开关/绑定/朝向均继续可见。
        // Trigger: REQ-051 相对无界与绝对有边界职责订正。
        // Evidence: 修后三屏原生开发验证均通过。
        // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
        // Original code:
        // controls.length===3&&controls.every(control=>{const rect=control.getBoundingClientRect();return rect.width>0&&rect.height>0;}));
        controls.length===4&&controls.every(control=>{const rect=control.getBoundingClientRect();return rect.width>0&&rect.height>0;}));
      await dialog.getByRole('button',{name:'下一步',exact:true}).click();
      // AI-REMOVED 2026-11-20:
      // Reason: 边界页正式名称统一。
      // Trigger: REQ-051 相对无界与绝对有边界职责订正。
      // Evidence: 修后三屏原生开发验证均通过。
      // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
      // Original code:
      // const boundary=dialog.getByRole('region',{name:'存取线与存取口',exact:true});
      const boundary=dialog.getByRole('region',{name:'存取口与边界设置',exact:true});
      await boundary.waitFor();
      await boundary.getByRole('radiogroup',{name:'设备组面向底边的一侧',exact:true}).getByRole('radio',{name:'下',exact:true}).check();
      await dialog.getByRole('button',{name:'下一步',exact:true}).click();
      const manual=dialog.getByRole('region',{name:'人工摆放',exact:true});
      const prepared=()=>page.waitForFunction(()=>{
        const state=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual;
        if(state.error)throw Error(state.error);
        return !!state.layout?.preparation.nodes.length&&!state.loading;
      });
      await prepared();
      const palette=manual.getByRole('complementary',{name:'待摆设备'});
      // AI-REMOVED 2026-11-13:
      // Reason: 无环境需求的产线不再展示完整环境列表，折叠由共享按钮控制。
      // Trigger: 用户要求隐藏无关环境、外置数量并复用主放置条目。
      // Evidence: 三屏开发验证通过；separator 场景没有环境需求。
      // Replacement: 下方拓扑条目的原生展开与外置圆标测量。Risk: Low。Human Review: Required
      // Original code:
      // const gas=palette.locator('details').filter({has:page.locator('summary',{hasText:'气体散布机'})});
      // grouped:await gas.count()===1 && await gas.getAttribute('open')===null,
      // counted:(await palette.getByRole('button').first().innerText()).includes('×'),
      // AI-REMOVED 2026-11-13:
      // Reason: 存取口由坐标放置清单转移到所属边步骤，原位置不能继续查找该折叠组。
      // Trigger: REQ-047 条件步骤与边关联；Evidence: 三屏开发验证与准备清单设备分类。
      // Replacement: 下方新步骤中的折叠、下拉和无横向溢出检查。Risk: Low。Human Review: Required。
      // Original code:
      //       await manual.getByRole('radio',{name:'按拓扑关系绑定',exact:true}).check();await prepared();
      //       const group=palette.locator('button[aria-expanded]').first();
      //       const wasCollapsed=await group.getAttribute('aria-expanded')==='false';
      //       const visibleBefore=await palette.locator('button[aria-pressed]:visible').count();
      //       await group.click();
      //       const grouped=wasCollapsed&&await group.getAttribute('aria-expanded')==='true'
      //         &&await palette.locator('button[aria-pressed]:visible').count()>visibleBefore;
      //       await manual.getByRole('radio',{name:'按生产配方绑定',exact:true}).check();await prepared();
      //       // 2026-11-13：无配方源汇按物料职责展开；与暗管出口共用分组和放置入口。
      //       const supplyGroup=palette.locator('button[aria-expanded][title="仓库取货口"]');
      //       // 同设备分组切换绑定模式时保留展开状态，不能把上一步已展开的组再次收起。
      //       if(await supplyGroup.getAttribute('aria-expanded')==='false')await supplyGroup.click();
      //       const supplyContent=await supplyGroup.getAttribute('aria-controls');
      //       const supplyEntries=palette.locator('[id="'+supplyContent+'"] button[aria-pressed]');
      //       const supplyExpanded=await supplyEntries.evaluateAll(buttons=>buttons.length>1&&buttons.every(button=>{
      //         const rect=button.getBoundingClientRect();
      //         return rect.width>0&&rect.height>0&&rect.height<=44;
      //       }));
      //       await supplyGroup.click();
      const boundaryPortsAbsent=await palette.locator('button[title="仓库取货口"]').count()===0;
      // AI-REMOVED 2026-11-20:
      // Reason: 开关已从画布移动至选项页，复用经过原生操作确认的启用状态。
      // Trigger: REQ-051 三步人工流程与边界定位。
      // Evidence: 三屏开发验证完成，人工选项及方向先于画布。
      // Replacement: 下方当前流程和可见性检查。
      // Risk: Low；保留原生画布、生命周期和工作台隔离断言。Human Review: Required
      // Original code:
      // const paletteLayout={switch:await manual.getByRole('switch',{name:'人工摆放预设建筑'}).isChecked(),
      const paletteLayout={switch:enabled,
        boundaryPortsAbsent,
        counted:await palette.locator('button[aria-pressed]').first().evaluate(button=>{
          const count=button.parentElement.firstElementChild;
          return count!==button&&/^[0-9]+$/.test(count.textContent)&&count.getBoundingClientRect().right<button.getBoundingClientRect().left;
        }),
        unneededEnvironmentHidden:!(/气体散布机|∞/.test(await palette.innerText())),
        unsupported:/热能池|洒水机/.test(await palette.innerText()),selects:await manual.locator('select').count()};
      const stage=manual.getByRole('application',{name:'人工布局画布'}),canvas=stage.locator('canvas');
      await canvas.waitFor();
      // 2026-11-13：真实布局验证单排设置、折叠圆点和组件自有按钮尺寸，防止只有状态正确而画面不可用。
      // AI-REMOVED 2026-11-20:
      // Reason: 原单行开关和绑定已拆入人工介入选项页，不能在画布继续测量。
      // Trigger: REQ-051 三步人工流程与边界定位。
      // Evidence: 三屏开发验证完成，人工选项及方向先于画布。
      // Replacement: 下方当前流程和可见性检查。
      // Risk: Low；保留原生画布、生命周期和工作台隔离断言。Human Review: Required
      // Original code:
      // const controlsShareRow=await manual.evaluate(element=>{
      // const toggle=element.querySelector('[role="switch"]').closest('label').getBoundingClientRect();
      // const choices=element.querySelector('[role="radiogroup"]').getBoundingClientRect();
      // return Math.abs(toggle.y+toggle.height/2-choices.y-choices.height/2)<2;
      // });
      // AI-CORRECTION 2026-11-20：选项前置后验证专属页面三组控件可见；画布只保留边界定位条。
      const optionControlsVisibleResult=optionControlsVisible;
      const oldToolbarAbsent=await manual.getByRole('button',{name:'重置视图',exact:true}).count()===0;
      await dialog.getByRole('button',{name:'收起规划步骤',exact:true}).click();
      const steps=dialog.getByRole('navigation',{name:'规划步骤'});
      const compactSteps=await steps.evaluate(element=>{
        const dots=[...element.querySelectorAll('button[data-state]')].map(button=>button.getBoundingClientRect());
        // AI-REMOVED 2026-11-20:
        // Reason: 新增人工介入选项稳定步骤身份，启用时八个导航点。
        // Trigger: REQ-051 三步人工流程与边界定位。
        // Evidence: 三屏开发验证完成，人工选项及方向先于画布。
        // Replacement: 下方当前流程和可见性检查。
        // Risk: Low；保留原生画布、生命周期和工作台隔离断言。Human Review: Required
        // Original code:
        // return element.innerText.trim()===''&&dots.length===7&&dots.every(rect=>Math.abs(rect.y-dots[0].y)<2);
        return element.innerText.trim()===''&&dots.length===8&&dots.every(rect=>Math.abs(rect.y-dots[0].y)<2);
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
      // 2026-11-13：真实设备标签必须以主要产物替换 avatar，不能另叠一层固定尺寸图标。
      function readProductionLabel(element) {
        const host=window.__industrialPlannerAppHost,surface=window.__test__.renderSurface(element);
        const placement=host.blueprintPlannerDialog.manual.layout.placements[0];
        const id=host.blueprintPlannerDialog.manual.ensureSession().editor.state.collections.preview[0]??placement.referenceNode.id;
        const recipe=host.workspace.registry.queries.findRecipeDefinition(placement.referenceNode.recipeId);
        const title=host.actions.translate(host.workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId).nameKey);
        const find=(node,test)=>{if(test(node))return node;for(const child of node.children??[]){const found=find(child,test);if(found)return found;}};
        const visible=node=>{if(!node)return false;for(let n=node;n;n=n.parent)if(!n.visible||!n.renderable)return false;return true;};
        const root=find(surface.app.stage,node=>String(node.label).startsWith('entity.'+id+'.')&&String(node.label).endsWith('.entity'));
        if(!root)return {ready:false};
        const avatar=find(root,node=>node.label==='device.icon');
        const product=find(root,node=>visible(node)&&String(node.texture?.label).includes('/item-icons/'+recipe.primaryOutputs[0]+'.webp'));
        return {ready:!!product&&!visible(avatar)&&surface.input.simulation===null
          &&product.parent.children.filter(visible).length===2,
          named:!!find(root,node=>visible(node)&&node.text===title)};
      }
      const waitProductionLabel=async named=>{
        for(let attempt=0;attempt<100;attempt++) {
          const label=await canvas.evaluate(readProductionLabel);
          if(label.ready&&label.named===named)return true;
          await page.waitForTimeout(80);
        }
        throw Error('主要产物、avatar 或名称显示未同步');
      };
      const setNames=value=>page.evaluate(async value=>{
        const {runInAction}=await import('/node_modules/.vite/deps/mobx.js');
        runInAction(()=>{window.__industrialPlannerAppHost.internalState.settings.gameShowDeviceNames=value;});
      },value);
      await setNames(true);
      const namedProductionLabel=await waitProductionLabel(true);
      await setNames(false);
      const unnamedProductionLabel=await waitProductionLabel(false);
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
      const movingProductionLabel=await waitProductionLabel(false);
      if(${profile.isMobile}) await manual.getByRole('button',{name:'确认',exact:true}).tap();
      else await page.mouse.click(x+2*cell,y+cell);
      await page.waitForFunction(position=>{
        const current=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.placements[0].position;
        return current.x===position.x+2&&current.y===position.y+1;
      },geometry.placement.position);
      await prepared();
      const movedProductionLabel=await waitProductionLabel(false);
      const after=await canvas.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-moved.png"))}});
      await stage.press('Escape');
      await page.mouse.move(0,0);
      const settled=await canvas.screenshot();await page.waitForTimeout(200);
      const stablePlacedPixels=settled.equals(await canvas.screenshot());
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-workspace.png"))},scale:'css'});
      // AI-REMOVED 2026-11-20:
      // Reason: 新定位浏览器回归独立成测试，不和既有设备标签/拖放像素场景耦合。
      // Trigger: 主代理要求最小独立定位回归。
      // Evidence: 三屏开发验证已确认原生拖边、冲突及历史语义。
      // Replacement: blueprint-planner-boundary-position.test.ts。
      // Risk: Low；原有人工画布断言完整保留。Human Review: Required
      // Original code:
      // // 2026-11-19：三屏开发验证完成后独立编写；只验证浏览器拖动与标签排版，规则矩阵由 Vitest 覆盖。
      // await manual.getByRole('switch',{name:'锁定边界位置',exact:true}).check();
      // const baseInput=manual.getByRole('spinbutton',{name:'底边坐标',exact:true});
      // const initialBase=Number(await baseInput.inputValue());
      // await baseInput.fill(String(initialBase+3));await baseInput.press('Enter');
      // await manual.getByRole('radiogroup',{name:'固定侧边',exact:true}).getByRole('radio',{name:'固定双侧',exact:true}).check();
      // const labelsContained=await manual.locator('[data-boundary-handle]').evaluateAll(handles=>
      // handles.filter(handle=>getComputedStyle(handle).visibility!=='hidden').every(handle=>{
      // const box=handle.getBoundingClientRect(),surface=handle.parentElement.getBoundingClientRect();
      // return box.left>=surface.left-1&&box.right<=surface.right+1&&box.top>=surface.top-1&&box.bottom<=surface.bottom+1;
      // }));
      // const baseHandle=manual.locator('[data-boundary-handle="base"]');
      // // 离屏约束线保持真实世界坐标，先用原生相机操作移入视野，再操作其标签。
      // for(let attempt=0;attempt<16&&await baseHandle.evaluate(handle=>getComputedStyle(handle).visibility==='hidden');attempt++){
      // const direction=await canvas.evaluate(element=>{
      // const camera=window.__test__.renderSurface(element).input.camera;
      // const base=window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.boundary.position.base;
      // return base>camera.state.center.y?'ArrowDown':'ArrowUp';
      // });
      // await stage.focus();await page.keyboard.down(direction);await page.waitForTimeout(45);
      // await page.keyboard.up(direction);await page.waitForTimeout(35);
      // }
      // await baseHandle.waitFor({state:'visible'});
      // const dragBox=await baseHandle.boundingBox();
      // const dragCell=await canvas.evaluate(element=>window.__test__.renderSurface(element).input.camera.state.gridCellPixelSize);
      // const handleX=dragBox.x+dragBox.width/2,handleY=dragBox.y+dragBox.height/2;
      // if(${profile.isMobile}){
      // const cdp=await page.context().newCDPSession(page);let down=false;
      // try {
      // await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:handleX,y:handleY,id:1}]});down=true;
      // for(let step=1;step<=5;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:handleX,y:handleY-dragCell*step/5,id:1}]});
      // await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});down=false;
      // } finally {if(down)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
      // } else {
      // await page.mouse.move(handleX,handleY);await page.mouse.down();
      // await page.mouse.move(handleX,handleY-dragCell,{steps:5});await page.mouse.up();
      // }
      // await page.waitForFunction(base=>window.__industrialPlannerAppHost.blueprintPlannerDialog.manual.layout.boundary.position.base===base,initialBase+2);
      // const nativeBoundarySynced=Number(await baseInput.inputValue())===initialBase+2;
      // await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "manual-boundary-position.png"))},scale:'css'});
      // 2026-11-12：原生触控策略由手工场景外层 stage 承担，CanvasPanel 的 application 节点位于其内部。
      const reusedCanvas=await canvas.evaluate((element,original)=>element===original,originalCanvas);
      const touchAction=await stage.evaluate(element=>{const surface=element.closest('[class*="_stage_"]');if(!surface)throw new Error('Missing manual input surface');return getComputedStyle(surface).touchAction;});
      // AI-REMOVED 2026-11-20:
      // Reason: 存取口步骤位于人工画布之前，使用已访问导航返回检查。
      // Trigger: REQ-051 三步人工流程与边界定位。
      // Evidence: 三屏开发验证完成，人工选项及方向先于画布。
      // Replacement: 下方当前流程和可见性检查。
      // Risk: Low；保留原生画布、生命周期和工作台隔离断言。Human Review: Required
      // Original code:
      // await dialog.getByRole('button',{name:'下一步',exact:true}).click();
      // const boundary=dialog.getByRole('region',{name:'存取线与朝向',exact:true});
      // AI-REMOVED 2026-11-20:
      // Reason: 已访问步骤名称与页面同步。
      // Trigger: REQ-051 相对无界与绝对有边界职责订正。
      // Evidence: 修后三屏原生开发验证均通过。
      // Replacement: 下方当前向导及原生交互。Risk: Low。Human Review: Required
      // Original code:
      // await steps.getByRole('button',{name:'存取线与存取口',exact:true}).click();
      await steps.getByRole('button',{name:'存取口与边界设置',exact:true}).click();
      const group=boundary.locator('button[aria-expanded][title="仓库取货口"]');
      const collapsed=await group.getAttribute('aria-expanded')==='false';
      await group.click();
      const boundaryControls=collapsed&&await boundary.locator('select:visible').count()===2;
      await boundary.locator('select:visible').first().selectOption('base');await prepared();
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "boundary-direction.png"))},scale:'css'});
      const boundaryContained=await boundary.evaluate(el=>el.scrollWidth<=el.clientWidth+1);
      return {paletteLayout,boundaryControls,boundaryContained,optionControlsVisibleResult,oldToolbarAbsent,compactSteps,expandedSteps,paletteSuppressed,paletteRestored,toolbarIconsVisible,stablePlacedPixels,continuousDragBody,
        namedProductionLabel,unnamedProductionLabel,movingProductionLabel,movedProductionLabel,
        rotation:geometry.placement.rotation,changedPixels:!before.equals(after),
        reusedCanvas,
        retainedWizard:await dialog.isVisible(),touchAction,
        unchangedDocument:await page.evaluate(original=>JSON.stringify(window.__test__.document())===original,originalDocument),
        contained:await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)};
    }`);
    expect(result).toEqual({ paletteLayout: { switch: true, boundaryPortsAbsent: true, counted: true, unneededEnvironmentHidden: true, unsupported: false, selects: 0 },
      boundaryControls: true, boundaryContained: true, optionControlsVisibleResult: true, oldToolbarAbsent: true, compactSteps: true, expandedSteps: true, paletteSuppressed: true, paletteRestored: true, toolbarIconsVisible: true,
      stablePlacedPixels: true, continuousDragBody: true,
      namedProductionLabel: true, unnamedProductionLabel: true, movingProductionLabel: true, movedProductionLabel: true,
      rotation: 90, changedPixels: true, reusedCanvas: true, retainedWizard: true,
      touchAction: "none", unchangedDocument: true, contained: true });
  });
}
