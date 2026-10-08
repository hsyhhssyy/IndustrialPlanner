import { SCREEN_PROFILES as profiles } from "./harness/profiles";
// AI-REMOVED 2026-10-05:
// Reason: CLI 配置、进程检查与清理收敛到受管会话。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 六个用例复制同一套启动与收尾逻辑。
// Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
// Risk: Low。Human Review: Required
// Original code:
// import { execFile } from "node:child_process";

// AI-REMOVED 2026-10-05:
// Reason: CLI 文件写入统一由 ManagedCli 执行。Trigger: 基座迁移。
// Evidence: 当前用例已无 writeFile 调用。Replacement: harness/fixture.ts。
// Risk: Low。Human Review: Required
// Original code:
// import { writeFile } from "node:fs/promises";
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
import input from "../blueprint-planner/fixtures/converter-startup-liquid.json" with { type: "json" };

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

// 三档开发验证完成后独立编写，使用原生选择事件和真实任务序列化。
// AI-REMOVED 2026-10-05:
// Reason: 独立屏幕或主题用例不应因前项失败而跳过。
// Trigger: 用户授权统一 E2E 基座。
// Evidence: 当前用例重复管理相同运行资源。
// Replacement: playwright.config.ts 的 workers: 1
// Risk: Low。Human Review: Required
// Original code:
// test.describe.configure({ mode: "serial" });
for (const profile of profiles) {
  test(`转化设备启动策略、默认阻断与持久化 [${profile.name}]`, async ({ baseURL, browserSession }, _testInfo) => {
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
    const _session = cli.session;

    // AI-REMOVED 2026-10-05:
    // Reason: CLI 配置、进程检查与清理收敛到受管会话。
    // Trigger: 用户授权统一 E2E 基座。
    // Evidence: 六个用例复制同一套启动与收尾逻辑。
    // Replacement: harness/fixture.ts ManagedCli 与 scripts/browser-test/runtime.mjs。
    // Risk: Low。Human Review: Required
    // Original code:
    // const session = `converter-startup-${process.pid}-${profile.name}`;

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
        const request = ${JSON.stringify(input)};
        await page.goto(${JSON.stringify(baseURL ?? "http://127.0.0.1:4174")});
        const ready = async () => page.waitForFunction(input => {
          try {
            window.__industrialPlannerAppHost.workspace.blueprintPlanner.queries.exportDraft({ ...input,
              options: { ...input.options, converterStartup: 'manual' } });
            return true;
          } catch { return false; }
        }, request);
        await ready();
        await page.evaluate(request => {
          const c = window.__industrialPlannerAppHost.blueprintPlannerDialog;
          c.setEnabled(true); c.open(request.plan);
          // 新草稿默认值与夹具路线分离，自循环必须在当前草稿中显式配置。
          for (const policy of request.plan.supplyPolicies ?? []) c.updateSupplyPolicy(policy);
        }, request);
        const screen = await page.evaluate(() => window.__industrialPlannerAppHost.state.screenProfile);
        assert(screen.deviceClass === ${JSON.stringify(profile.name)} && screen.hasTouch, 'Screen Profile');
        const dialog = page.getByRole('dialog').filter({ has: page.locator('#blueprint-planner-title') });
        const select = dialog.getByRole('combobox', { name: '固液气转换器启动', exact: true });
        const warning = dialog.getByText('液化息壤 自循环 需要外部启动器启动，请调整启动设置。', { exact: true });
        const start = dialog.getByRole('button', { name: '开始规划', exact: true });
        assert(await select.inputValue() === 'reject', '旧任务缺省必须拒绝启动');
        assert(await warning.isVisible() && await start.isDisabled(), '缺省显示错误并阻断');
        await page.screenshot({ path: ${JSON.stringify(resolve(output, "reject.png"))} });
        let savedTaskId = null;
        for (const mode of ['manual', 'tank']) {
          await select.selectOption(mode);
          assert(await warning.count() === 0 && !(await start.isDisabled()), mode + ' 应取消自循环阻断');
          const persisted = await page.evaluate(async mode => {
            const h = window.__industrialPlannerAppHost, p = h.workspace.blueprintPlanner;
            const file = p.queries.exportDraft(h.blueprintPlannerDialog.getRequest());
            const id = await p.actions.importTask(file);
            return {taskId:id,valid:file.request.options.converterStartup === mode && p.queries.getLastRequest(id).options.converterStartup === mode};
          }, mode);
          assert(persisted.valid, mode + ' 必须进入任务文件并可导入');
          savedTaskId = persisted.taskId;
          await page.screenshot({ path: ${JSON.stringify(resolve(output, "allowed"))} + '-' + mode + '.png' });
        }
        assert(await page.evaluate(() => localStorage.getItem('industrial-planner.eda.options')) === null,
          '修改启动设置不能保存全局规划偏好');
        await page.reload(); await ready();
        await page.evaluate(plan => {
          const c = window.__industrialPlannerAppHost.blueprintPlannerDialog;
          c.setEnabled(true); c.open(plan);
          for (const policy of plan.supplyPolicies ?? []) c.updateSupplyPolicy(policy);
        }, request.plan);
        assert(await select.inputValue() === 'reject', '刷新后的新草稿必须恢复默认启动设置');
        await select.selectOption('manual');
        assert(await warning.count() === 0 && !(await start.isDisabled()), '新草稿可以独立修改启动设置');
        await select.selectOption('reject');
        assert(await warning.isVisible() && await start.isDisabled(), '恢复拒绝后重新阻断');
        await page.waitForFunction(id => window.__industrialPlannerAppHost.workspace.blueprintPlanner.queries.listTasks()
          .some(task => task.taskId === id), savedTaskId);
        await page.evaluate(id => {
          const h = window.__industrialPlannerAppHost;
          h.blueprintPlannerDialog.selectTask(id, h.workspace.blueprintPlanner.queries.getLastRequest(id));
        }, savedTaskId);
        assert(await select.inputValue() === 'tank' && await warning.count() === 0,
          '已有任务必须从任务文件恢复自己的启动设置');
        assert(await page.evaluate(() => localStorage.getItem('industrial-planner.eda.options')) === null,
          '恢复已有任务不能保存全局规划偏好');
        return { passed: true };
      }`, "validation.log");
      expect(result).toMatchObject({ passed: true });
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
