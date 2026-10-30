import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { acquireBrowserLease, assertBrowserIdle, BrowserRound, browserProcesses, portIsOpen } from "../browser-test/runtime.mjs";

export default async function setup(config) {
  if (config.workers !== 1 || config.fullyParallel || config.shard) {
    throw new Error("E2E 必须使用单 worker，禁止并行与分片");
  }
  const release = await acquireBrowserLease("e2e");
  const directory = config.projects[0].outputDir;
  // 2026-10-30：用户授权 Vite 跨用例复用；此资源归整轮所有，浏览器和有状态服务仍逐例释放。
  const suite = new BrowserRound(resolve(directory, "suite"));
  try {
    await mkdir(directory, { recursive: true });
    if (await portIsOpen(4174)) throw new Error("4174 已被其他服务占用");
    // 同一 worker 中的 Vite build 会设置 NODE_ENV；共享服务也显式固定为开发模式。
    const server = await suite.start(process.execPath, ["scripts/e2e/serve.mjs"], "vite.log", { NODE_ENV: "development" });
    await suite.waitForServer(server, "http://127.0.0.1:4174");
    const owner = (await browserProcesses()).find(item => item.pid === server.pid);
    if (!owner) throw new Error("共享 Vite 在就绪后已退出");
    await writeFile(resolve(directory, "run.json"), JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid,
      workers: config.workers, fullyParallel: config.fullyParallel, node: process.version,
      appServer: { pid: owner.pid, started: owner.started, url: "http://127.0.0.1:4174" } }, null, 2));
  } catch (error) {
    const errors = [error];
    try { await suite.close(); } catch (cleanupError) { errors.push(cleanupError); }
    try { await release(); } catch (cleanupError) { errors.push(cleanupError); }
    throw new AggregateError(errors, "E2E 共享服务启动失败");
  }
  // AI-REMOVED 2026-10-05:
  // Reason: 在获取锁前验证配置，避免配置失败留下锁。
  // Trigger: 基座串行与异常清理要求。Evidence: config.shard 也会启动分片。
  // Replacement: 本函数入口验证。Risk: Low。Human Review: Required
  // Original code:
  // if (config.workers !== 1 || config.fullyParallel) {
  //   await release();
  //   throw new Error("E2E 必须使用单 worker，禁止并行与分片");
  // }
  return async () => {
    const errors = [];
    try {
      await assertBrowserIdle();
      try {
        await access(resolve(directory, "cleanup-failed"));
        throw new Error("某轮资源清理失败，请查看 cleanup.json");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    } catch (error) { errors.push(error); }
    finally {
      try { await suite.close(); } catch (error) { errors.push(error); }
      try { await release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "E2E 整轮清理失败");
  };
}
