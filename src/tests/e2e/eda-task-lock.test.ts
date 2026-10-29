import { SCREEN_PROFILES as profiles } from "./harness/profiles";
// AI-REMOVED 2026-10-05:
// Reason: CLI 配置、进程检查与清理收敛到受管会话。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 六个用例复制同一套启动与收尾逻辑。
// Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
// Risk: Low。Human Review: Required
// Original code:
// import { execFile } from "node:child_process";

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import plant from "../blueprint-planner/fixtures/plant-preload.json" with { type: "json" };

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

// 三档开发验证完成后独立编写；用真实任务和原生交互验证锁定、后台提示及解锁。
// AI-REMOVED 2026-10-05:
// Reason: 独立屏幕或主题用例不应因前项失败而跳过。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: playwright.config.ts 的 workers: 1
// Risk: Low。Human Review: Required
// Original code:
// test.describe.configure({ mode: "serial" });
for (const profile of profiles) {
  test(`EDA 运行期间禁止切换和创建，关闭窗口显示运行提示 [${profile.name}]`, async ({ baseURL, browserSession }, _testInfo) => {
    test.setTimeout(180_000);
    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const output = resolve(testInfo.outputPath("cli"));
    const cli = await browserSession.openCli(profile);
    const output = cli.directory;
    const session = cli.session;

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const session = `eda-lock-${process.pid}-${profile.name}`;

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
    //       const result = await execute("playwright-cli", args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
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
    // expect(await invoke(["list"], "sessions-before.log")).toContain("(no browsers)");

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const config = resolve(output, "config.json");

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // await writeFile(config, JSON.stringify({ outputDir: output, outputMode: "stdout", browser: {
    //       launchOptions: { executablePath: chromium.executablePath(), headless: true },
    //       contextOptions: { viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr,
    //         hasTouch: true, locale: "zh-CN" },
    //     } }));

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const ownedDaemons = async () => (await execute("ps", ["-eo", "pid,args"])).stdout.split("\n")
    //       .filter(line => line.includes("cliDaemon.js") && line.includes(session)).map(line => Number(line.trim().split(/\s+/)[0]));

    /* AI-CORRECTION 2026-10-05: 会话由 fixture 收尾，原 finally 原文保留在块后。 */
    {
      // AI-REMOVED 2026-10-05:
      // Reason: CLI 配置、进程检查与清理收敛到受管会话。
      // Trigger: 用户授权统一 E2E 基座。
      // Evidence: 六个用例复制同一套启动与收尾逻辑。
      // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
      // Risk: Low。Human Review: Required
      // Original code:
      // await invoke([`-s=${session}`, "open", `--config=${config}`], "open.log");

      const result = await cli.runJson(`async page => {
        const assert = (condition, message) => { if (!condition) throw Error(message); };
        await page.addInitScript(() => {
          localStorage.setItem('v3-user-settings-dialog', JSON.stringify({ values: { 'other-experimental-features': true } }));
          // AI-REMOVED 2026-10-05:
          // Reason: 桌面触控与主指针设置只保留一个实现。
          // Trigger: E2E 基座迁移。Evidence: ManagedCli.open 已安装统一 Screen Profile。
          // Replacement: harness/profiles.ts installDesktopPointer。Risk: Low。Human Review: Required
          // Original code:
          // if (!desktop) return;
          // const nativeMatchMedia = window.matchMedia.bind(window);
          // window.matchMedia = query => {
          //   const media = nativeMatchMedia(query);
          //   if (query !== '(pointer: coarse)' && query !== '(hover: none)') return media;
          //   return new Proxy(media, { get(target, key) {
          //     if (key === 'matches') return false;
          //     const value = Reflect.get(target, key, target);
          //     return typeof value === 'function' ? value.bind(target) : value;
          //   } });
          // };
        });
        const request = ${JSON.stringify(plant.request)};
        await page.goto(${JSON.stringify(baseURL ?? "http://127.0.0.1:4174")});
        await page.waitForFunction(input => {
          try { window.__industrialPlannerAppHost.workspace.blueprintPlanner.queries.exportDraft(input); return true; }
          catch { return false; }
        }, request);
        const ids = await page.evaluate(async input => {
          const h = window.__industrialPlannerAppHost;
          const { createSimulationHost } = await import('/src/simulation/simulation-host.ts');
          h.workspace.simulation.dispose();
          createSimulationHost(h.workspace, { engineKind: 'dense-v2', blueprintDenseTickRate: 2 });
          const p = h.workspace.blueprintPlanner;
          const configured = { ...input, options: { ...input.options, evaluationsPerRound: 100_000_000, concurrency: 1 } };
          const active = await p.actions.importTask(p.queries.exportDraft({ ...configured, plan: { ...input.plan, name: '运行任务' } }));
          const other = await p.actions.importTask(p.queries.exportDraft({ ...configured, plan: { ...input.plan, name: '其他任务' } }));
          // AI-REMOVED 2026-10-14:
          // Reason: 自动规划产线（EDA）转为正式功能，不再保留实验性启用开关。
          // Trigger: 用户要求 EDA 默认可用且不再需要开启。
          // Evidence: 设置注册、控制器持久化和三处入口均依赖同一实验性开关。
          // Replacement: 测试直接打开正式 EDA 入口，不再调用已移除的 setEnabled。
          // Risk: Low；规划任务与业务可用性校验保持原行为。
          // Human Review: Required
          //
          // Original code:
          //           h.blueprintPlannerDialog.setEnabled(true);

          h.blueprintPlannerDialog.selectTask(active, p.queries.getLastRequest(active));
          h.blueprintPlannerDialog.open();
          return { active, other };
        }, request);
        const screen = await page.evaluate(() => window.__industrialPlannerAppHost.state.screenProfile);
        assert(screen.deviceClass === ${JSON.stringify(profile.name)} && screen.hasTouch, 'Screen Profile');
        const dialog = page.getByRole('dialog').filter({ has: page.locator('#blueprint-planner-title') });
        const entry = page.getByRole('button', { name: /^规划(?: ·.*)?$/ });
        // 2026-10-30：三屏开发验证通过后，补充四字标签布局与放大镜运行状态回归。
        const searchIcon = entry.locator('[data-workbench-icon="search"]');
        assert(await searchIcon.count() === 1, '规划入口使用放大镜');
        assert(await searchIcon.evaluate(el => getComputedStyle(el).animationName) === 'none', '未运行时放大镜静止');
        const fourCharacterLabels = await page.locator('aside[class*="left-toolbar_"] [class*="rail-button-label_"]').evaluateAll(labels =>
          labels.filter(label => label.textContent.length === 4).map(label => {
            const range = document.createRange();
            range.selectNodeContents(label);
            const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
            const bounds = label.getBoundingClientRect(), button = label.closest('button').getBoundingClientRect();
            return { text: label.textContent, singleLine: lines.size === 1,
              inside: bounds.left >= button.left && bounds.right <= button.right };
          }));
        assert(fourCharacterLabels.length > 0 && fourCharacterLabels.every(label => label.singleLine && label.inside),
          '四字标签保持单行且不超出按钮：'+JSON.stringify(fourCharacterLabels));
        const other = dialog.getByRole('button', { name: /其他任务/ });
        await dialog.getByRole('button', { name: '开始规划', exact: true }).click();
        assert(await searchIcon.evaluate(el => getComputedStyle(el).animationName) !== 'none', '任务窗口打开时放大镜也应运动');
        assert(await other.isDisabled(), '计算时禁止切换任务');
        for (const name of ['新建产线计算', '导入任务']) {
          assert(await dialog.getByRole('button', { name, exact: true }).isDisabled(), '计算时禁止 '+name);
        }
        const guarded = await page.evaluate(async ids => {
          const h = window.__industrialPlannerAppHost, p = h.workspace.blueprintPlanner, c = h.blueprintPlannerDialog;
          c.selectTask(ids.other, p.queries.getLastRequest(ids.other));
          c.open(p.queries.getLastRequest(ids.other).plan);
          let rejected = false;
          try { await p.actions.importTask(p.queries.exportTask(ids.other)); } catch { rejected = true; }
          return c.viewTaskId === ids.active && rejected && p.queries.listTasks().length === 2;
        }, ids);
        assert(guarded, '绕过按钮也不能切换或创建');
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        await entry.scrollIntoViewIfNeeded();
        assert((await entry.getAttribute('class')).includes('eda-task-indicator'), '关闭后入口应提示运行');
        const initialTransform = await searchIcon.evaluate(el => getComputedStyle(el).transform);
        await page.waitForFunction(initial => getComputedStyle(document.querySelector(
          'aside[class*="left-toolbar_"] [data-workbench-icon="search"]')).transform !== initial, initialTransform);
        assert(await entry.evaluate(el => getComputedStyle(el, '::after').animationName) !== 'none', '运行提示应有动画');
        await page.screenshot({ path: ${JSON.stringify(resolve(output, "closed-running.png"))} });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert(await searchIcon.evaluate(el => getComputedStyle(el).animationName) === 'none', '减少动态效果时放大镜静止');
        assert(await entry.evaluate(el => getComputedStyle(el, '::after').animationName) === 'none', '减少动态效果时保留静态提示');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForFunction(id => window.__industrialPlannerAppHost.workspace.blueprintPlanner.queries.getTask(id).evaluatedProposals > 0,
          ids.active, { timeout: 30000 });
        await entry.click();
        assert(await page.evaluate(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId) === ids.active, '重开应返回运行任务');
        assert(!(await entry.getAttribute('class')).includes('eda-task-indicator'), '打开窗口后移除入口动画');
        assert(await searchIcon.evaluate(el => getComputedStyle(el).animationName) !== 'none', '重新打开窗口后放大镜继续运动');
        await dialog.getByRole('button', { name: '暂停计算', exact: true }).click();
        await page.waitForFunction(() => window.__industrialPlannerAppHost.workspace.blueprintPlanner.state.activeTaskId === null);
        assert(await searchIcon.evaluate(el => getComputedStyle(el).animationName) === 'none', '暂停后放大镜恢复静止');
        assert(!(await other.isDisabled()), '暂停收尾后允许切换');
        for (const name of ['新建产线计算', '导入任务']) {
          assert(!(await dialog.getByRole('button', { name, exact: true }).isDisabled()), '暂停收尾后允许 '+name);
        }
        const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '下载任务', exact: true }).click()]);
        await download.saveAs(${JSON.stringify(resolve(output, "task.json"))});
        await other.click();
        assert(await page.evaluate(() => window.__industrialPlannerAppHost.blueprintPlannerDialog.viewTaskId) === ids.other, '解锁后实际切换任务');
        await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        assert(!(await entry.getAttribute('class')).includes('eda-task-indicator'), '暂停后不再显示运行提示');
        return { passed: true };
      }`, "validation.log");
      expect(result).toMatchObject({ passed: true });
      const file = JSON.parse(await readFile(resolve(output, "task.json"), "utf8"));
      if (file.checkpoint.result) {
        const success = resolve(".temp/eda/success", session);
        await mkdir(success, { recursive: true });
        await writeFile(resolve(success, "task.json"), JSON.stringify(file, null, 2));
        await writeFile(resolve(success, "input.json"), JSON.stringify(file.request, null, 2));
        await writeFile(resolve(success, "blueprint.json"), JSON.stringify(file.checkpoint.result.blueprint, null, 2));
        await writeFile(resolve(success, "verification.json"), JSON.stringify({ verifiedBy: "BlueprintPlannerHost", engineKind: "dense-v2",
          tickRate: 2, elapsedMs: file.progress.elapsedMs, metrics: file.checkpoint.result.metrics }, null, 2));
      }
    }
// AI-REMOVED 2026-10-05:
// Reason: CLI 配置、进程检查与清理收敛到受管会话。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 六个用例复制同一套启动与收尾逻辑。
// Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
// Risk: Low。Human Review: Required
// Original code:
// finally {
//       try { await invoke([`-s=${session}`, "close"], "close.log"); }
//       finally {
//         for (const pid of await ownedDaemons()) {
//           try { process.kill(pid, "SIGTERM"); }
//           catch (error) { expect((error as NodeJS.ErrnoException).code).toBe("ESRCH"); }
//         }
//         await expect.poll(ownedDaemons).toEqual([]);
//         expect(await invoke(["list"], "sessions-after.log")).toContain("(no browsers)");
//       }
//     }

  });
}
