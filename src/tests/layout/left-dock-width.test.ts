// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";
import { BrowserRound, acquireBrowserLease, assertBrowserIdle, parseCliResult, portIsOpen } from "../../../scripts/browser-test/runtime.mjs";
import { SCREEN_PROFILES, contextOptions } from "../e2e/harness/profiles";
import type { DockWidthMeasurement } from "./left-dock-width-scenario";
import fixture from "../fixtures/blueprints/layout/left-dock.schema7.json";

const APP_URL = "http://127.0.0.1:4174";
const variants = SCREEN_PROFILES.flatMap(profile => (["zh-CN", "en-US"] as const).map(locale => ({ profile, locale })));
const artifactRoot = resolve(".temp/playwright-test/left-dock-width-vitest", `${Date.now()}-${process.pid}`);

// 此 project 强制单 worker；租约覆盖其他 CLI / E2E 入口，每轮关闭自己的服务和浏览器。
describe.sequential("左栏真实布局宽度", () => {
  let release: (() => Promise<void>) | undefined;
  let cleanupFailed = false;
  let scenario: string;
  let pointer: string;
  beforeAll(async () => {
    release = await acquireBrowserLease("vitest-left-dock-width");
    const compilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext };
    scenario = ts.transpileModule(await readFile(resolve("src/tests/layout/left-dock-width-scenario.ts"), "utf8"), { compilerOptions })
      .outputText.replace("export async function runLeftDockWidthScenario", "async function runLeftDockWidthScenario");
    const profiles = ts.transpileModule(await readFile(resolve("src/tests/e2e/harness/profiles.ts"), "utf8"), { compilerOptions }).outputText;
    pointer = profiles.slice(profiles.indexOf("export async function installDesktopPointer")).replace("export async function", "async function");
  });
  afterAll(async () => { await release?.(); });

  it.each(variants)("$profile.name / $locale：内部容器和统计列保持在左栏内", async ({ profile, locale }) => {
    if (cleanupFailed) throw new Error("上一轮清理失败，禁止启动下一轮浏览器");
    const directory = resolve(artifactRoot, `${profile.name}-${locale}`);
    const round = new BrowserRound(directory), session = `dock-width-${process.pid}-${profile.name}-${locale}`;
    const errors: unknown[] = [];
    let cliOpened = false;
    try {
      await assertBrowserIdle();
      if (await portIsOpen(4174)) throw new Error("4174 已被其他服务占用");
      const server = await round.start(process.execPath, ["scripts/e2e/serve.mjs"], "vite.log", { NODE_ENV: "development" });
      await round.waitForServer(server, APP_URL, 30_000);
      await round.openCli(session, { browser: { launchOptions: { executablePath: chromium.executablePath(), headless: true }, contextOptions: contextOptions(profile) } });
      cliOpened = true;
      const options = { url: APP_URL, locale, fixture, screenshotPath: resolve(directory, "final.png") };
      const code = `async page => {
        ${pointer}
        ${profile.name === "desktop" ? "await installDesktopPointer(page.context());" : ""}
        ${scenario}
        return runLeftDockWidthScenario(page, ${JSON.stringify(options)});
      }`;
      const filename = resolve(directory, "scenario.js");
      await mkdir(directory, { recursive: true });
      await writeFile(filename, code);
      const result = parseCliResult(await round.command("playwright-cli", [`-s=${session}`, "run-code", `--filename=${filename}`], "scenario.log", 150_000)) as {
        screen: unknown; measurements: DockWidthMeasurement[]; snapshot: string;
      };
      await writeFile(resolve(directory, "measurements.json"), JSON.stringify(result, null, 2));
      await writeFile(resolve(directory, "snapshot.yaml"), result.snapshot);
      expect(result.screen).toMatchObject({ deviceClass: profile.name, viewportWidth: profile.width, viewportHeight: profile.height, devicePixelRatio: profile.dpr });
      expect(result.measurements).toHaveLength(16);
      for (const measurement of result.measurements) {
        // 非零断言避免未排版或未挂载的节点使 <= 宽度断言假通过。
        expect(measurement.dockWidth, measurement.label).toBeGreaterThan(100);
        expect(measurement.bodyWidth, measurement.label).toBeGreaterThan(100);
        expect(measurement.bodyWidth, measurement.label).toBeLessThanOrEqual(measurement.dockWidth + 1);
        expect(measurement.panelWidth, measurement.label).toBeLessThanOrEqual(measurement.dockWidth + 1);
        expect(measurement.containers.length, measurement.label).toBeGreaterThan(2);
        for (const container of measurement.containers) {
          expect(container.width, `${measurement.label}: ${container.name}`).toBeLessThanOrEqual(measurement.dockWidth + 1);
        }
        expect(measurement.escapedContent, measurement.label).toEqual([]);
        expect(measurement.clippedWarehouseCells, measurement.label).toEqual([]);
      }
    } catch (error) { errors.push(error); }
    finally {
      if (errors.length && cliOpened) {
        try {
          await round.command("playwright-cli", [`-s=${session}`, "run-code", `async page => {
            await page.screenshot({ path: ${JSON.stringify(resolve(directory, "failure.png"))}, timeout: 5000 });
            return { snapshot: await page.locator('body').ariaSnapshot({ timeout: 5000 }),
              state: await page.evaluate(() => window.__test__?.getAppState() ?? null) };
          }`], "failure.log", 15_000);
        } catch (error) { errors.push(error); }
      }
      try { await round.close(); }
      catch (error) { cleanupFailed = true; errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `左栏宽度检查失败：${profile.name} / ${locale}；证据：${directory}`);
  });
});
