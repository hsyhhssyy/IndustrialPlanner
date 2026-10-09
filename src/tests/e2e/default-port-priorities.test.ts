import { SCREEN_PROFILES as profiles } from "./harness/profiles";
// AI-REMOVED 2026-10-05:
// Reason: CLI 配置、进程检查与清理收敛到受管会话。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 六个用例复制同一套启动与收尾逻辑。
// Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
// Risk: Low。Human Review: Required
// Original code:
// import { execFile } from "node:child_process";

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// AI-REMOVED 2026-10-05:
// Reason: CLI 配置、进程检查与清理收敛到受管会话。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 六个用例复制同一套启动与收尾逻辑。
// Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
// Risk: Low。Human Review: Required
// Original code:
// import { promisify } from "node:util";

import { expect, test } from "./harness/fixture";

// AI-REMOVED 2026-10-05:
// Reason: CLI 配置、进程检查与清理收敛到受管会话。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 六个用例复制同一套启动与收尾逻辑。
// Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
// Risk: Low。Human Review: Required
// Original code:
// const execute = promisify(execFile);

// AI-REMOVED 2026-10-05:
// Reason: 屏幕尺寸、DPR 与触控设置收敛到唯一来源。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: harness/profiles.ts
// Risk: Low。Human Review: Required
// Original code:
// const profiles = [
//   { name: "mobile", width: 764, height: 345, dpr: 3.125 },
//   { name: "tablet", width: 711, height: 665, dpr: 3.125 },
//   { name: "desktop", width: 2552, height: 1315, dpr: 1 },
// ] as const;

// 三档开发验证完成后独立编写。CLI 独占一个会话，正式 E2E 的服务器由运行器负责清理。
// AI-REMOVED 2026-10-05:
// Reason: 独立屏幕或主题用例不应因前项失败而跳过。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: playwright.config.ts 的 workers: 1
// Risk: Low。Human Review: Required
// Original code:
// test.describe.configure({ mode: "serial" });
for (const profile of profiles) {
  test(`默认优先级的展示、覆盖和问题提示 [${profile.name}]`, async ({ baseURL, browserSession }, _testInfo) => {
    test.setTimeout(120_000);
    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const session = `port-priority-${process.pid}-${profile.name}`;
    const cli = await browserSession.openCli(profile);
    const output = cli.directory;
    const _session = cli.session;

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const output = resolve(testInfo.outputPath("cli"));

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // await mkdir(output, { recursive: true });

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const invoke = async (args: string[], log: string) => {
    //       const result = await execute("playwright-cli", args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
    //       await writeFile(resolve(output, log), result.stdout + result.stderr);
    //       if (result.stdout.includes("### Error")) throw new Error(result.stdout);
    //       return result.stdout;
    //     };

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // expect(await invoke(["list"], "before-sessions.log")).toContain("(no browsers)");

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const config = resolve(output, "config.json");

    const code = resolve(output, "scenario.js");
    const blueprint = JSON.parse(await readFile(
      "src/tests/fixtures/blueprints/simulation/default-port-priorities/stash-splitter-last.schema7.json", "utf8",
    ));
    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // await writeFile(config, JSON.stringify({
    //       outputDir: output, outputMode: "stdout",
    //       browser: {
    //         launchOptions: { executablePath: chromium.executablePath(), headless: true },
    //         contextOptions: {
    //           viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr,
    //           hasTouch: profile.name !== "desktop", isMobile: profile.name !== "desktop", locale: "zh-CN",
    //         },
    //       },
    //     }));

    await writeFile(code, `async page => {
      const assert = (condition, message) => { if (!condition) throw Error(message); };
      const directory = ${JSON.stringify(output)};
      // AI-REMOVED 2026-10-05:
      // Reason: 桌面触控与主指针设置只保留一个实现。
      // Trigger: E2E 基座迁移。Evidence: ManagedCli.open 已安装统一 Screen Profile。
      // Replacement: harness/profiles.ts installDesktopPointer。Risk: Low。Human Review: Required
      // Original code:
      // if (${JSON.stringify(profile.name)} === 'desktop') {
      //   await page.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 1 }));
      // }
      try {
        await page.goto(${JSON.stringify(baseURL ?? "http://127.0.0.1:4174")});
        await page.waitForFunction(() => window.__industrialPlannerAppHost?.workspace.editor?.state.viewport.clientRect.width > 0);
        const id = await page.evaluate(blueprint => {
          const editor = window.__industrialPlannerAppHost.workspace.editor;
          editor.actions.createBlueprintPlacementDraft(blueprint, { x: 0, y: 0 });
          if (!editor.actions.applyPlacementDraft()) throw Error('场景放置失败');
          editor.actions.cancelPlacementDraft();
          const target = Object.values(editor.document.getSnapshot().entities).find(entity => entity.definitionId === 'storager_1');
          editor.actions.clearCollection('selection');
          editor.actions.addToCollection({ collectionType: 'selection', entityId: target.id });
          return target.id;
        }, ${JSON.stringify(blueprint)});
        await page.waitForFunction(id => window.__industrialPlannerAppHost.portPriorityDefaults.get(id)?.length === 5, id);
        const screen = await page.evaluate(() => window.__industrialPlannerAppHost.state.screenProfile);
        assert(screen.deviceClass === ${JSON.stringify(profile.name)} && screen.hasTouch, 'Screen Profile 不匹配');
        const panel = page.locator('[data-inspector-key="port-priority-group"]').filter({ visible: true });
        await panel.waitFor({ state: 'visible' });
        const priorities = await panel.locator('[data-port-priority-number]').allTextContents();
        assert(JSON.stringify(priorities) === JSON.stringify(['9','9','5','9','9','1']), '默认优先级不正确');
        const persisted = await page.evaluate(id => window.__industrialPlannerAppHost.workspace.editor.document.getSnapshot().entities[id].config, id);
        assert(JSON.stringify(persisted) === '{}', '推导结果不得进入实体配置');
        await page.screenshot({ path: directory + '/defaults.png' });
        const toggle = panel.locator('[data-port-priority-custom-switch]');
        await toggle.check();
        const row = panel.locator('[data-port-key="item_input:in_s_0"]');
        await row.locator('[data-port-priority-number]').click();
        await row.locator('[data-port-priority-choice="5"]').click();
        await page.waitForFunction(() => document.querySelector('[data-port-key="item_input:in_s_0"] [data-port-priority-number]')?.textContent === '5');
        await toggle.uncheck();
        await page.waitForFunction(() => document.querySelector('[data-port-key="item_input:in_s_0"] [data-port-priority-number]')?.textContent === '9');
        const notice = page.locator('[data-problem-row][data-problem-severity="info"]').filter({ visible: true });
        await notice.scrollIntoViewIfNeeded();
        assert((await notice.textContent()).includes('默认端口存在优先级'), '缺少设备提示');
        assert((await notice.textContent()).includes('您摆出的这个设备组合，会导致本身在游戏内的默认端口优先级发生变化。'), '提示说明不正确');
        assert(await notice.evaluate(element => getComputedStyle(element).borderLeftColor) === 'rgb(34, 197, 94)', '提示应为绿色');
        await page.screenshot({ path: directory + '/notice.png' });
        return { passed: true, screen, priorities, snapshot: await page.locator('body').ariaSnapshot() };
      } catch (error) {
        await page.screenshot({ path: directory + '/failure.png' }).catch(() => {});
        throw error;
      }
    }`);
    /* AI-CORRECTION 2026-10-05: 会话由 fixture 收尾，原 finally 原文保留在块后。 */
    {
      // AI-REMOVED 2026-10-05:
      // Reason: CLI 配置、进程检查与清理收敛到受管会话。
      // Trigger: 用户授权统一 E2E 基座。
      // Evidence: 六个用例复制同一套启动与收尾逻辑。
      // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
      // Risk: Low。Human Review: Required
      // Original code:
      // await invoke([`-s=${session}`, "open", "about:blank", `--config=${config}`], "open.log");

      const result = await cli.runJson(await readFile(code, "utf8"), "scenario.log");
      expect(result).toMatchObject({ passed: true });
      await _testInfo.attach("cli-result", { body: JSON.stringify(result), contentType: "application/json" });
    }
// AI-REMOVED 2026-10-05:
// Reason: CLI 配置、进程检查与清理收敛到受管会话。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 六个用例复制同一套启动与收尾逻辑。
// Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
// Risk: Low。Human Review: Required
// Original code:
// finally {
//       try {
//         await invoke([`-s=${session}`, "close"], "close.log");
//       } finally {
//         expect(await invoke(["list"], "after-sessions.log")).not.toContain(session);
//       }
//     }

  });
}
