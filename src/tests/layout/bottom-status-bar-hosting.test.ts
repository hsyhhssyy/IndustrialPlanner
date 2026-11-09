// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { BrowserRound, acquireBrowserLease, assertBrowserIdle, parseCliResult, portIsOpen } from "../../../scripts/browser-test/runtime.mjs";
import { SCREEN_PROFILES, contextOptions, installDesktopPointer } from "../e2e/harness/profiles";

const artifactRoot = resolve(".temp/playwright-test/bottom-status-bar-hosting", `${Date.now()}-${process.pid}`);

// 域名映射由 shared 单测覆盖；这里仅验证 jsdom 无法证明的实际布局与可见性。
describe.sequential("状态栏站点图标布局", () => {
  let release: (() => Promise<void>) | undefined;
  let cleanupFailed = false;
  beforeAll(async () => { release = await acquireBrowserLease("status-bar-hosting-layout"); });
  afterAll(async () => { await release?.(); });

  it.each(SCREEN_PROFILES)("$name：图标完整可见且不增加状态栏高度", async profile => {
    if (cleanupFailed) throw new Error("上一轮清理失败，禁止启动下一轮浏览器");
    await assertBrowserIdle();
    expect(await portIsOpen(4174)).toBe(false);
    const directory = resolve(artifactRoot, profile.name);
    const round = new BrowserRound(directory);
    const session = `status-host-${process.pid}-${profile.name}`;
    const errors: unknown[] = [];
    try {
      const server = await round.start(process.execPath, ["scripts/e2e/serve.mjs"], "vite.log", { NODE_ENV: "development" });
      await round.waitForServer(server, "http://127.0.0.1:4174", 30_000);
      await round.openCli(session, { browser: {
        launchOptions: { executablePath: chromium.executablePath(), headless: true },
        contextOptions: contextOptions(profile),
      } });
      const code = `async page => {
        page.setDefaultTimeout(10000);
        ${profile.name === "desktop" ? `await (${installDesktopPointer.toString()})(page.context());` : ""}
        await page.goto('http://127.0.0.1:4174', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const icon = page.locator('[data-workbench-icon="hosting-test"]');
        await icon.waitFor({ state: 'visible', timeout: 30000 });
        await page.evaluate(() => document.fonts.ready);
        const layout = await icon.evaluate(svg => {
          const chip = svg.parentElement, footer = svg.closest('footer');
          const bounds = svg.getBoundingClientRect(), bar = footer.getBoundingClientRect();
          chip.style.display = 'none';
          const previousHeight = footer.getBoundingClientRect().height;
          chip.style.removeProperty('display');
          return { width: bounds.width, height: bounds.height, barHeight: bar.height, previousHeight,
            inside: bounds.top >= bar.top && bounds.bottom <= bar.bottom && bounds.right <= bar.right,
            rightmost: chip === chip.parentElement.lastElementChild };
        });
        await page.screenshot({ path: ${JSON.stringify(resolve(directory, "final.png"))} });
        return { layout, screen: await page.evaluate(() => window.__test__.getAppState().screen),
          snapshot: await page.locator('footer').ariaSnapshot() };
      }`;
      const filename = resolve(directory, "scenario.js");
      await writeFile(filename, code);
      const result = parseCliResult(await round.command("playwright-cli", [`-s=${session}`, "run-code", `--filename=${filename}`], "scenario.log", 120_000));
      await writeFile(resolve(directory, "measurements.json"), JSON.stringify(result, null, 2));
      expect(result).toMatchObject({
        layout: { width: 16, height: 16, barHeight: 28, previousHeight: 28, inside: true, rightmost: true },
        screen: { viewportWidth: profile.width, viewportHeight: profile.height, devicePixelRatio: profile.dpr,
          deviceClass: profile.name, screenShape: profile.shape, hasTouch: true },
      });
    } catch (error) { errors.push(error); }
    finally {
      try { await round.close(); }
      catch (error) { cleanupFailed = true; errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `状态栏布局检查失败：${profile.name}`);
    await assertBrowserIdle();
    expect(await portIsOpen(4174)).toBe(false);
  });
});
