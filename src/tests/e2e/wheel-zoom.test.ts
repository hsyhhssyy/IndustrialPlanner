import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test, type Page } from "./harness/fixture";
import blueprint from "../fixtures/blueprints/e2e/copy-selection.schema7.json" with { type: "json" };

// 三屏开发验证完成后独立编写；设置与滚轮均通过真实浏览器事件操作。
for (const profile of SCREEN_PROFILES) {
  test(`反转滚轮缩放即时生效并持久化，原生列表保持滚动方向 [${profile.name}]`, async ({ browserSession, baseURL }) => {
    test.setTimeout(150_000);
    const cli = await browserSession.openCli(profile);
    const result = await cli.runJson(`async page => {
      return (${wheelZoomRegression.toString()})(page, ${JSON.stringify(baseURL)},
        ${JSON.stringify(blueprint)}, ${JSON.stringify(resolve(cli.directory, "wheel-settings.png"))});
    }`);
    expect(result).toMatchObject({
      persisted: true,
      nativeScrollDirections: [true, true],
      screen: { deviceClass: profile.name, viewportWidth: profile.width, viewportHeight: profile.height,
        devicePixelRatio: profile.dpr, hasTouch: true },
      zoomDirections: [false, true, false, true, false],
    });
  });
}

async function wheelZoomRegression(page: Page, url: string, fixture: unknown, screenshotPath: string) {
  page.setDefaultTimeout(10_000);
  const ready = () => page.waitForFunction(() => {
    const state = window.__test__?.readiness();
    return state?.assembled && state.canvasAttached && state.viewportValid;
  }, undefined, { timeout: 30_000 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await ready();
  await page.evaluate(input => window.__test__!.loadBlueprint(input), fixture);
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  const row = settings.locator("article").filter({ hasText: "反转滚轮缩放" });
  const checkbox = row.locator("#setting-game-invert-wheel-zoom");
  const grid = () => page.evaluate(() => window.__test__!.getAppState().viewport.gridSize);
  const zoomDirections: boolean[] = [];
  const nativeScrollDirections: boolean[] = [];

  const openSettings = async () => {
    if (!await settings.isVisible()) await page.getByRole("button", { name: "设置", exact: true }).click();
    await row.scrollIntoViewIfNeeded();
  };
  const closeSettings = () => settings.getByRole("button", { name: "关闭", exact: true }).click();
  const wheelZoom = async (deltaY: number, increase: boolean) => {
    const before = await grid();
    const box = await page.locator("canvas").first().boundingBox();
    if (!box) throw Error("画布未显示");
    const point = { x: box.x + box.width * .65, y: box.y + box.height * .65 };
    if (!await page.evaluate(p => document.elementFromPoint(p.x, p.y) instanceof HTMLCanvasElement, point)) {
      throw Error("滚轮落点被遮挡");
    }
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, deltaY);
    await page.waitForFunction(({ before, increase }) => {
      const current = window.__test__!.getAppState().viewport.gridSize;
      return increase ? current > before : current < before;
    }, { before, increase });
    zoomDirections.push(await grid() > before);
  };
  const scrollList = async () => {
    const content = settings.locator('[class*="settings-dialog-content"]');
    const gridBefore = await grid();
    await content.evaluate(element => { element.scrollTop = 100; });
    const before = await content.evaluate(element => element.scrollTop);
    const box = await content.boundingBox();
    if (!box) throw Error("设置列表未显示");
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .7);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(before => document.querySelector<HTMLElement>('[class*="settings-dialog-content"]')!.scrollTop > before, before);
    nativeScrollDirections.push(await content.evaluate(element => element.scrollTop) > before);
    if (await grid() !== gridBefore) throw Error("列表滚动误触画布缩放");
    await row.scrollIntoViewIfNeeded();
  };

  await wheelZoom(120, false);
  await openSettings();
  if (await checkbox.isChecked()) throw Error("默认应关闭反转");
  await scrollList();
  await row.locator("label").click();
  if (!await checkbox.isChecked()) throw Error("设置未开启");
  await scrollList();
  await page.screenshot({ path: screenshotPath });
  await closeSettings();
  await wheelZoom(120, true);
  await wheelZoom(-120, false);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await ready();
  await openSettings();
  const persisted = await checkbox.isChecked();
  await closeSettings();
  await wheelZoom(120, true);
  await openSettings();
  await row.locator("label").click();
  if (await checkbox.isChecked()) throw Error("设置未关闭");
  await closeSettings();
  await wheelZoom(120, false);
  return { persisted, zoomDirections, nativeScrollDirections,
    screen: await page.evaluate(() => window.__test__!.getAppState().screen) };
}
