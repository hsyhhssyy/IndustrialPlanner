import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, SCREEN_PROFILES, test } from "./harness/fixture";

test.use({ appServer: false });

// 延迟 CLI 自身的目录创建，真实浏览器仍负责动作、live trace 和 fixture 收尾；连续冷启动验证后续轮次可执行。
for (const profile of SCREEN_PROFILES) {
  for (const roundNumber of [1, 2]) {
    test(`慢速目录创建时完整记录 live trace 并释放会话 [${profile.name}] [${roundNumber}]`, async ({ browserSession, round }) => {
      const traces = resolve(round.directory, "traces");
      const delayed = resolve(round.directory, "trace-mkdir-delayed.txt");
      const preload = resolve(round.directory, "slow-trace-mkdir.cjs");
      await mkdir(round.directory, { recursive: true });
      await writeFile(preload, `
        const fs = require('node:fs');
        const originalMkdir = fs.promises.mkdir;
        fs.promises.mkdir = async function(directory, ...options) {
          if (String(directory) === ${JSON.stringify(resolve(traces, "resources"))}) {
            fs.writeFileSync(${JSON.stringify(delayed)}, 'delayed');
            await new Promise(resolve => setTimeout(resolve, 250));
          }
          return originalMkdir.call(this, directory, ...options);
        };
      `);
      const originalNodeOptions = process.env.NODE_OPTIONS;
      try {
        // 仅本次 CLI daemon 继承 I/O 延迟；finally 恢复 worker 环境，fixture 继续完成停止 trace 和资源核验。
        process.env.NODE_OPTIONS = `${originalNodeOptions ?? ""} --require=${JSON.stringify(preload)}`;
        const cli = await browserSession.openCli(profile);
        expect(await cli.runJson(`async page => {
          await page.setContent('<button type="button">记录动作</button>');
          await page.getByRole('button').evaluate(button => {
            button.addEventListener('click', () => { button.textContent = '记录完成'; }, {once:true});
          });
          await page.getByRole('button', {name:'记录动作', exact:true}).click();
          return page.getByRole('button').textContent();
        }`, "trace-action.log")).toBe("记录完成");
        expect(await readFile(delayed, "utf8")).toBe("delayed");
        const files = await readdir(traces);
        const actionFiles = files.filter(file => file.endsWith(".trace"));
        const stackFiles = files.filter(file => file.endsWith(".stacks"));
        expect(actionFiles).toHaveLength(1);
        expect(stackFiles).toHaveLength(1);
        await expect.poll(async () => (await readFile(resolve(traces, actionFiles[0]!), "utf8"))
          .includes('"method":"click"')).toBe(true);
        await expect.poll(async () => {
          try {
            const metadata = JSON.parse(await readFile(resolve(traces, stackFiles[0]!), "utf8")) as { stacks: unknown[] };
            return metadata.stacks.length;
          } catch (error) {
            if (error instanceof SyntaxError) return 0;
            throw error;
          }
        }).toBeGreaterThan(0);
      } finally {
        if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
        else process.env.NODE_OPTIONS = originalNodeOptions;
      }
    });
  }
}
