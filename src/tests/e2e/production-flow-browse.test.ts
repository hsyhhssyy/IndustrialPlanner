import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";
import plant from "../blueprint-planner/fixtures/plant-preload.json" with { type: "json" };

// 三屏开发验证后独立编写；原生触摸滚动继续由 eda-task-defaults.test.ts 覆盖。
test("触屏 PC 的浏览流程图支持鼠标平移并在松键后停止", async ({ browserSession, baseURL }) => {
  test.setTimeout(180_000);
  const cli = await browserSession.openCli(SCREEN_PROFILES.find(profile => profile.name === "desktop")!);
  const result = await cli.runJson(`async page => {
    await page.goto(${JSON.stringify(baseURL)});
    await page.waitForFunction(() => window.__test__?.readiness().assembled);
    await page.evaluate(plan => window.__industrialPlannerAppHost.blueprintPlannerDialog.open(plan),
      ${JSON.stringify(plant.request.plan)});
    const dialog = page.locator('[data-dialog-key="blueprint-planner"]');
    const canvas = dialog.locator('[class*="production-flow-canvas"]');
    const surface = canvas.locator('[class*="production-flow-surface"]');
    const reset = canvas.getByRole('button', {name:'重置布局',exact:true});
    await reset.click();
    const initialStyle = await surface.getAttribute('style');
    const position = () => surface.evaluate(element => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return {x:matrix.e,y:matrix.f,scale:matrix.a};
    });
    const nodePositions = () => canvas.locator('div[class*="production-flow-node"][style]')
      .evaluateAll(elements => elements.map(element => ({left:element.style.left,top:element.style.top})));
    const before = await position();
    const initialNodes = await nodePositions();
    const icon = canvas.locator('div[class*="production-flow-node"][style]').first().locator('img').first();
    const box = await icon.boundingBox();
    if (!box) throw Error('流程图节点图标不可见');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await dialog.screenshot({path:${JSON.stringify(resolve(cli.directory, "flow-before.png"))}});
    await page.mouse.move(x,y);
    await page.mouse.down();
    await page.mouse.move(x+80,y+30,{steps:8});
    await page.mouse.up();
    const after = await position();
    const nodesUnchanged = JSON.stringify(await nodePositions()) === JSON.stringify(initialNodes);
    await dialog.screenshot({path:${JSON.stringify(resolve(cli.directory, "flow-panned.png"))}});
    await reset.click();
    const resetView = await surface.getAttribute('style') === initialStyle;
    const frame = await canvas.boundingBox();
    if (!frame) throw Error('流程图画布不可见');
    const beforeOutside = await surface.getAttribute('style');
    await page.mouse.move(frame.x+10,frame.y+100);
    await page.mouse.down();
    await page.mouse.move(frame.x-30,frame.y+130,{steps:6});
    await page.mouse.up();
    const afterOutside = await surface.getAttribute('style');
    await page.mouse.move(frame.x+60,frame.y+100);
    return {dx:after.x-before.x,dy:after.y-before.y,scaleUnchanged:after.scale === before.scale,
      nodesUnchanged,resetView,outsidePanned:afterOutside !== beforeOutside,
      stopped:await surface.getAttribute('style') === afterOutside};
  }`) as { dx: number; dy: number; scaleUnchanged: boolean; nodesUnchanged: boolean;
    resetView: boolean; outsidePanned: boolean; stopped: boolean };
  expect(result.dx).toBeCloseTo(80);
  expect(result.dy).toBeCloseTo(30);
  expect(result.scaleUnchanged).toBe(true);
  expect(result.nodesUnchanged).toBe(true);
  expect(result.resetView).toBe(true);
  expect(result.outsidePanned).toBe(true);
  expect(result.stopped).toBe(true);
});
