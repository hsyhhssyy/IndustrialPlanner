import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import resultTask from "../blueprint-planner/fixtures/inline-result-task.json" with { type: "json" };
import itemPolicies from "../blueprint-planner/fixtures/pyrrolite-ore.json" with { type: "json" };

// 2026-10-29：三屏开发验证后独立编写。恢复真实已验收结果，只测排版、Canvas 像素与原生手势，不重复运行搜索。
for (const profile of SCREEN_PROFILES) {
  test(`规划详情的提示贴底、物流行高和内嵌预览触控 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    test.setTimeout(150_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      await page.addLocatorHandler(page.locator('[data-dialog-key="help"]'), async dialog => {
        await dialog.getByRole('button', {name:'关闭',exact:true}).click();
      }, {times:1});
      await page.goto(${JSON.stringify(baseURL)});
      await page.waitForFunction(() => {
        const ready=window.__test__?.readiness();
        return ready?.assembled && ready.canvasAttached && ready.viewportValid;
      });
      await page.getByRole('button', {name:'工具箱',exact:true}).click();
      await page.getByText('产线规划', {exact:true}).click();
      const toolbox=page.locator('[data-dialog-key="toolbox"]');
      const material=toolbox.locator('[class*="production-planning-config_"] > section').nth(1);
      const guide=await material.evaluate(element => {
        const box=element.getBoundingClientRect();
        const hint=element.querySelector('[class*="production-planning-material-guide_"]').getBoundingClientRect();
        const padding=parseFloat(getComputedStyle(element).paddingBottom);
        return {atBottom:Math.abs(element.scrollHeight-hint.bottom+box.top-element.scrollTop+element.clientTop-padding)<1,
          headerClear:hint.top>=element.firstElementChild.getBoundingClientRect().bottom,
          contained:element.scrollWidth<=element.clientWidth+1};
      });
      await material.evaluate(element => {element.scrollTop=element.scrollHeight;});
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "material-guide.png"))},scale:'css'});
      await toolbox.getByRole('button', {name:'关闭',exact:true}).click();

      await page.evaluate(plan => window.__industrialPlannerAppHost.blueprintPlannerDialog.open(plan),
        ${JSON.stringify(itemPolicies.request.plan)});
      const dialog=page.locator('[data-dialog-key="blueprint-planner"]');
      // 2026-11-12：当前产品入口为分步向导，原生进入生产设置后再检查物流布局。
      await dialog.getByRole('button',{name:'下一步',exact:true}).click();
      await dialog.getByRole('button',{name:'下一步',exact:true}).click();
      const output=dialog.getByRole('radiogroup', {name:'灼铜块 · 产物去向',exact:true});
      await output.scrollIntoViewIfNeeded();
      const logistics=await output.evaluate(element => {
        const row=element.closest('[class*="_supplyRule_"]');
        const rowBox=row.getBoundingClientRect(), groupBox=element.getBoundingClientRect();
        const identity=row.querySelector('[class*="_supplyItem_"]').getBoundingClientRect();
        // 2026-11-12：测量内容空白时扣除真实底边框；desktop 探针为 trailing=1、border=1，内容空白实际为零。
        const css=getComputedStyle(row);
        const trailing=rowBox.bottom-Math.max(groupBox.bottom,identity.bottom)-parseFloat(css.paddingBottom)-parseFloat(css.borderBottomWidth);
        return {compact:Math.abs(trailing)<1,
          contained:row.scrollWidth<=row.clientWidth+1,
          labelsClear:[...element.querySelectorAll('label > span')].every(label=>label.scrollWidth<=label.clientWidth+1)};
      });
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "logistics.png"))},scale:'css'});

      await page.evaluate(async file => {
        const host=window.__industrialPlannerAppHost, planner=host.workspace.blueprintPlanner;
        const id=await planner.actions.importTask(file);
        await host.blueprintPlannerDialog.selectTask(id,planner.queries.getLastRequest(id));
      }, ${JSON.stringify(resultTask.file)});
      // AI-REMOVED 2026-11-12:
      // Reason: 分步向导已有三份配置摘要和独立任务菜单，不能把任意 details 当作唯一输入摘要。
      // Trigger: REQ-048 全入口回归揭示旧向导布景遗漏。
      // Evidence: BlueprintPlannerSummary 的三份 summary；首轮停在未导航的生产设置。
      // Replacement: 同时检查三份真实配置摘要默认折叠；Risk: Low；Human Review: Required
      // Original code:
      // const collapsed=await dialog.locator('details').evaluate(element => !element.open
      //   && element.getBoundingClientRect().height<=element.querySelector('summary').getBoundingClientRect().height+2);
      const collapsed=await dialog.locator('details[class*="_summary_"]').evaluateAll(elements => elements.length===3
        && elements.every(element => !element.open && element.getBoundingClientRect().height
          <=element.querySelector('summary').getBoundingClientRect().height+2));
      const preview=dialog.getByRole('region', {name:'预览蓝图',exact:true});
      const canvas=preview.locator('canvas');
      await canvas.waitFor();
      await preview.scrollIntoViewIfNeeded();
      const previewLayout=await preview.evaluate(element => ({
        belowCurve:!!element.previousElementSibling?.querySelector('figure'),
        contained:element.scrollWidth<=element.clientWidth+1,
      }));
// AI-REMOVED 2026-11-12:
// Reason: 结果预览取消缩放按钮，滚轮与键盘不能改变其取景。
// Trigger: REQ-048 已确认静态预览无相机输入。
// Evidence: 临时浏览器验证四种预览固定时间且原生输入不改变像素。
// Replacement: 下方静态像素与标记位置断言；外围布局覆盖保留。
// Risk: Low；Human Review: Required
// Original code:
//       const beforeZoom=await canvas.screenshot();
//       await preview.getByRole('button', {name:'放大蓝图',exact:true}).click();
//       await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
//       const afterZoom=await canvas.screenshot({path:${JSON.stringify(resolve(cli.directory, "preview-zoomed.png"))}});
//       await preview.getByRole('button', {name:'显示全图',exact:true}).click();
//       await preview.scrollIntoViewIfNeeded();
//
      await page.mouse.move(1,1);await page.evaluate(()=>document.activeElement?.blur());
      // 2026-11-13：允许页面滚动后，DPR 3.125 的 DOM 截图会重新采样同一画布；比较实际 GPU 图像以验证静态取景。
      const capturePixels=()=>canvas.evaluate(element=>{
        const {app}=window.__test__.renderSurface(element);
        return app.renderer.extract.canvas({target:app.stage,frame:app.screen,resolution:app.renderer.resolution}).toDataURL();
      });
      const beforeZoom=await capturePixels();
      if(await preview.getByRole('button', {name:'放大蓝图',exact:true}).count()) throw Error('静态预览仍有缩放按钮');
      const wheelBox=await canvas.boundingBox();
      await page.mouse.move(wheelBox.x+wheelBox.width/2,wheelBox.y+wheelBox.height/2);
      await page.mouse.wheel(0,-100); await page.keyboard.press('ArrowRight');
      await preview.scrollIntoViewIfNeeded();
      await page.mouse.move(1,1);await page.evaluate(()=>document.activeElement?.blur());
      await canvas.screenshot({path:${JSON.stringify(resolve(cli.directory, "preview-static.png"))}});
      const afterZoom=await capturePixels();

      const scroll=dialog.locator('[class*="_scroll_"]');
      const beforeScroll=await scroll.evaluate(element=>element.scrollTop);
      const canvasBox=await canvas.boundingBox(), scrollBox=await scroll.boundingBox();
      const top=Math.max(canvasBox.y,scrollBox.y), bottom=Math.min(canvasBox.y+canvasBox.height,scrollBox.y+scrollBox.height);
      const x=canvasBox.x+canvasBox.width/2, y=top+10, distance=Math.min(75,bottom-top-20);
      const cdp=await page.context().newCDPSession(page);
      let pinchChanged=false;
      let touching=false;
      try {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        touching=true;
        for(let step=1;step<=8;step++) {
          await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+distance*step/8,id:1}]});
          await page.waitForTimeout(25);
        }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        touching=false;
        await page.waitForTimeout(300);
        const afterScroll=await scroll.evaluate(element=>element.scrollTop);
        await preview.scrollIntoViewIfNeeded();
        await page.mouse.move(1,1);await page.evaluate(()=>document.activeElement?.blur());
        const beforePinch=await capturePixels();
        const box=await canvas.boundingBox(), area=await scroll.boundingBox();
        const centerX=box.x+box.width/2, centerY=(Math.max(box.y,area.y)+Math.min(box.y+box.height,area.y+area.height))/2;
        const touches=radius=>[{x:centerX-radius,y:centerY,id:1},{x:centerX+radius,y:centerY,id:2}];
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(30)});
        touching=true;
        for(let step=1;step<=8;step++) {
          await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(30+step*3)});
          await page.waitForTimeout(25);
        }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        touching=false;
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.mouse.move(1,1);await page.evaluate(()=>document.activeElement?.blur());
        await canvas.screenshot({path:${JSON.stringify(resolve(cli.directory, "preview-pinched.png"))}});
        const afterPinch=await capturePixels();
        pinchChanged=beforePinch!==afterPinch;
// AI-REMOVED 2026-11-12:
// Reason: 静态预览始终自动适配，不再提供重置按钮。
// Trigger: REQ-048 已确认静态预览无相机输入。
// Evidence: 临时浏览器验证四种预览固定时间且原生输入不改变像素。
// Replacement: 下方静态像素与标记位置断言；外围布局覆盖保留。
// Risk: Low；Human Review: Required
// Original code:
//         await preview.getByRole('button',{name:'显示全图',exact:true}).click();

        await preview.scrollIntoViewIfNeeded();
        await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "preview.png"))},scale:'css'});
        const footer=await dialog.locator('footer').evaluate(element => {
          const box=element.getBoundingClientRect(), css=getComputedStyle(element), left=element.firstElementChild.getBoundingClientRect(), right=element.lastElementChild.getBoundingClientRect();
          const buttons=[...element.querySelectorAll('button')];
          return {contained:element.scrollWidth<=element.clientWidth+1 && box.bottom<=innerHeight+1,
            leftAligned:Math.abs(left.left-box.left-parseFloat(css.paddingLeft))<1,
            rightAligned:Math.abs(box.right-right.right-parseFloat(css.paddingRight))<1,
            // AI-REMOVED 2026-11-12:
            // Reason: 任务操作已归入折叠菜单，结果动作仍在右侧。
            // Trigger: REQ-048 全入口回归同步当前向导 DOM。
            // Evidence: blueprint-planner-dialog.tsx footer；已有 REQ-047 页面结构。
            // Replacement: 下方同时检查可见动作及菜单动作顺序；Risk: Low；Human Review: Required
            // Original code:
            // ordered:buttons.map(button=>button.textContent.trim()).join(',')==='下载任务,删除任务,复制任务,保存蓝图,放置蓝图,继续规划',
            // 2026-11-12：闭合 details 的后代可能仍有布局 rect；按动作归属检查两组顺序，并断言菜单关闭。
            ordered:element.querySelector('details').open===false
              && buttons.filter(button=>!button.closest('details')).map(button=>button.textContent.trim()).join(',')
              ==='返回任务列表,保存蓝图,放置蓝图,继续规划'
              && [...element.querySelectorAll('details button')].map(button=>button.textContent.trim()).join(',')==='下载任务,复制任务,删除任务',
            primary:getComputedStyle(buttons.at(-1)).backgroundColor!==getComputedStyle(buttons[0]).backgroundColor};
        });
        return {guide,logistics,collapsed,previewLayout,zoomChanged:beforeZoom!==afterZoom,
          touchScrolled:beforeScroll-afterScroll>5,pinchChanged,footer};
      } finally {
        if(touching) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await cdp.detach();
      }
    }`);
    expect(result).toEqual({
      guide: { atBottom: true, headerClear: true, contained: true },
      logistics: { compact: true, contained: true, labelsClear: true },
      collapsed: true,
      previewLayout: { belowCurve: true, contained: true },
// AI-REMOVED 2026-11-12:
// Reason: 已确认静态预览禁止滚轮／键盘改变像素。
// Trigger: REQ-048 已确认静态预览无相机输入。
// Evidence: 临时浏览器验证四种预览固定时间且原生输入不改变像素。
// Replacement: 下方静态像素与标记位置断言；外围布局覆盖保留。
// Risk: Low；Human Review: Required
// Original code:
//       zoomChanged: true,
      zoomChanged: false,
      touchScrolled: true,
// AI-REMOVED 2026-11-12:
// Reason: 已确认静态预览禁止双指改变像素，原生纵向滚动继续保留。
// Trigger: REQ-048 已确认静态预览无相机输入。
// Evidence: 临时浏览器验证四种预览固定时间且原生输入不改变像素。
// Replacement: 下方静态像素与标记位置断言；外围布局覆盖保留。
// Risk: Low；Human Review: Required
// Original code:
//       pinchChanged: true,
      pinchChanged: false,
      footer: { contained: true, leftAligned: true, rightAligned: true, ordered: true, primary: true },
    });
  });
}
