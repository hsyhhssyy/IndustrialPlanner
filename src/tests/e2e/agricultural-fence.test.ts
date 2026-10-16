import { resolve } from "node:path";
import { expect, test } from "./harness/fixture";
import { SCREEN_PROFILES } from "./harness/profiles";

for (const profile of SCREEN_PROFILES) {
  test(`缘缘庄围栏以占地中心绘制，切换基地后撤下 [${profile.name}]`, async ({ browserSession }) => {
    test.setTimeout(90_000);
    const cli = await browserSession.openCli(profile);
    const report = await cli.runJson(`async page => {
      const errors=[];
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto('http://127.0.0.1:4174/');
      await page.waitForFunction(() => window.__test__?.readiness().canvasAttached && window.__test__?.readiness().viewportValid);
      await page.evaluate(async () => {
        const host=window.__industrialPlannerAppHost;
        await host.workspace.editor.actions.loadLatestBaseDocument('wuling_agricultural_land');
        const {runInAction}=await import('/node_modules/.vite/deps/mobx.js');
        runInAction(() => { host.internalState.settings.gameUseBlueprintStyleDeviceImages=false; });
        const editor=host.workspace.editor;
        editor.actions.zoom(-100);
        const viewport=editor.state.viewport;
        const start={x:viewport.clientRect.left+viewport.clientRect.width/2,y:viewport.clientRect.top+viewport.clientRect.height/2};
        editor.actions.moveViewportByClientPixelVector({startClientPixel:start,endClientPixel:{
          x:start.x+(viewport.center.x-104)*viewport.gridCellPixelSize,
          y:start.y+viewport.center.y*viewport.gridCellPixelSize,
        }});
        const {resolveViewportPointFromWorldPoint}=await import('/src/shared/geometry/viewport-transform.ts');
        const base=host.workspace.registry.baseDefinitions.find(base => base.id==='wuling_agricultural_land');
        const instances=base.builtinEntities.filter(entity => entity.id.startsWith('yuanyuan_fence_'));
        window.__measureYuanyuanFences=() => {
          const viewport=editor.state.viewport,renderer=host.workspace.render.app.renderer;
          const bodies=[];
          const visit=(node,visible) => {
            visible=visible && node.visible!==false && node.renderable!==false;
            if (visible && node.label==='device.body') {
              const entity=instances.find(entity => node.parent?.label?.startsWith('entity.base-builtin:wuling_agricultural_land:'+entity.id+'.'));
              if (entity) {
                const definition=host.workspace.registry.queries.findEntityDefinition(entity.definitionId);
                const rotated=entity.rotation===90 || entity.rotation===270;
                const point=resolveViewportPointFromWorldPoint({worldPoint:{
                  x:entity.position.x+(rotated?definition.footprint.height:definition.footprint.width)/2,
                  y:entity.position.y+(rotated?definition.footprint.width:definition.footprint.height)/2,
                },viewportBounds:{left:0,top:0,width:renderer.width,height:renderer.height},viewportCenter:viewport.center,
                  gridCellPixelSize:viewport.gridCellPixelSize,displayRotation:viewport.displayRotation});
                const actual=node.getGlobalPosition();
                bodies.push({id:entity.id,error:Math.hypot(point.x-actual.x,point.y-actual.y)});
              }
            }
            if (visible) for (const child of node.children??[]) visit(child,visible);
          };
          visit(host.workspace.render.app.stage,true);
          return bodies;
        };
      });
      const displayed=[];
      for (const rotation of [0,90]) {
        await page.evaluate(rotation => window.__industrialPlannerAppHost.workspace.editor.actions.setViewportDisplayRotation(rotation),rotation);
        await page.waitForFunction(() => {
          const bodies=window.__measureYuanyuanFences();
          return bodies.length>0 && bodies.every(body => body.error<0.05);
        });
        displayed.push({rotation,bodies:await page.evaluate(() => window.__measureYuanyuanFences())});
      }
      await page.screenshot({path:${JSON.stringify(resolve(cli.directory, "yuanyuan-fence.png"))}});
      await page.evaluate(() => window.__industrialPlannerAppHost.workspace.editor.actions.loadLatestBaseDocument('wuling_protocol_core'));
      await page.waitForFunction(() => window.__measureYuanyuanFences().length===0);
      return {displayed,remaining:await page.evaluate(() => window.__measureYuanyuanFences().length),errors};
    }`) as { displayed: Array<{ rotation: number; bodies: Array<{ id: string; error: number }> }>; remaining: number; errors: string[] };
    expect(report.displayed.map(frame => frame.rotation)).toEqual([0, 90]);
    for (const frame of report.displayed) {
      expect(frame.bodies.length).toBeGreaterThan(0);
      expect(Math.max(...frame.bodies.map(body => body.error))).toBeLessThan(0.05);
    }
    expect(report.remaining).toBe(0);
    expect(report.errors).toEqual([]);
  });
}
