import { spawn } from "node:child_process";
import { open, mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

const root = resolve(".temp/playwright-test");
const lockPath = resolve(root, "browser.lock");

/** 所有浏览器入口共用；只观察进程，不清理其他任务。 */
export async function browserProcesses() {
  const processes = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const args = (await readFile(`/proc/${entry}/cmdline`, "utf8")).replaceAll("\0", " ");
      const stat = await readFile(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z") continue;
      processes.push({ pid: Number(entry), parent: Number(fields[1]), group: Number(fields[2]), started: fields[19], args });
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return processes;
}

export async function assertBrowserIdle(allowedPids = []) {
  const processes = await browserProcesses();
  const allowed = new Set([process.pid, ...allowedPids]);
  // 当前检查入口的父进程可以是 npm / Playwright；其他入口仍视为占用。
  for (let current = process.pid; current;) {
    allowed.add(current);
    current = processes.find(item => item.pid === current)?.parent;
  }
  const foreign = processes.filter(item => !allowed.has(item.pid)
    && /(?:^|\/)(?:node|chrome|chrome-headless-shell|chromium)(?:\s|$)/.test(item.args)
    && /cliDaemon\.js|playwright(?:\/\S+)?\s+test(?:\s|$)|chrome-headless-shell.*--user-data-dir|--user-data-dir=\S*playwright/.test(item.args));
  if (foreign.length) throw new Error(`其他浏览器测试正在运行：${foreign.map(item => item.pid).join(", ")}`);
}

export async function acquireBrowserLease(label) {
  await mkdir(root, { recursive: true });
  let file;
  try { file = await open(lockPath, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`浏览器执行锁已存在，请等待所属任务完成；不得自动删除：${await readFile(lockPath, "utf8")}`);
  }
  const owner = { pid: process.pid, label, createdAt: new Date().toISOString() };
  await file.writeFile(JSON.stringify(owner));
  await file.close();
  try { await assertBrowserIdle(); }
  catch (error) { await unlink(lockPath); throw error; }
  return async () => {
    const actual = JSON.parse(await readFile(lockPath, "utf8"));
    if (actual.pid !== owner.pid || actual.createdAt !== owner.createdAt) throw new Error("浏览器执行锁归属发生变化");
    await unlink(lockPath);
  };
}

export async function portIsOpen(port) {
  return new Promise(resolveProbe => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolveProbe(value); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

export function cliResult(output) {
  if (/^### Error/m.test(output)) throw new Error(`Playwright CLI 失败：\n${output}`);
  return output;
}

export function parseCliResult(output) {
  cliResult(output);
  const section = output.match(/^### Result\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/m);
  if (!section) throw new Error("CLI 未返回结构化 Result，不能使用回显代码判断通过");
  return JSON.parse(section[1].trim());
}

/** 每轮独占的进程与 CLI 会话；关闭有界，保留原始失败与清理失败。 */
export class BrowserRound {
  constructor(directory) {
    this.directory = resolve(directory);
    this.children = new Set();
    this.sessions = new Map();
    this.ports = new Set();
    this.nativeProcesses = new Map();
    this.nativeGroups = new Set();
    this.stopping = false;
    this.signal = () => { void this.close().catch(error => { console.error(error); process.exitCode = 1; }); };
    process.once("SIGINT", this.signal);
    process.once("SIGTERM", this.signal);
  }

  async start(executable, args, log, env = {}) {
    this.#assertRunning();
    await mkdir(this.directory, { recursive: true });
    const file = await open(resolve(this.directory, log), "a");
    if (this.stopping) { await file.close(); this.#assertRunning(); }
    const child = spawn(executable, args, {
      cwd: process.cwd(), env: { ...process.env, ...env }, detached: true,
      stdio: ["ignore", file.fd, file.fd],
    });
    this.children.add(child);
    await new Promise((resolveSpawn, reject) => {
      child.once("spawn", resolveSpawn);
      child.once("error", reject);
    }).finally(() => file.close());
    return child;
  }

  // duringCleanup 仅供本类关闭已登记的 CLI 会话；不属于对外声明的调用参数。
  async command(executable, args, log, timeoutMs = 60_000, duringCleanup = false) {
    if (!duringCleanup) this.#assertRunning();
    await mkdir(this.directory, { recursive: true });
    const file = await open(resolve(this.directory, log), "a");
    if (!duringCleanup && this.stopping) { await file.close(); this.#assertRunning(); }
    const child = spawn(executable, args, { cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    this.children.add(child);
    let output = "", expired = false;
    let writes = Promise.resolve();
    const consume = data => {
      output += data.toString();
      // 内存只保留尾部；完整原始输出始终写入日志。
      if (output.length > 16 * 1024 * 1024) output = output.slice(-16 * 1024 * 1024);
      writes = writes.then(() => file.write(data));
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const timer = setTimeout(() => { expired = true; this.killGroup(child.pid, "SIGTERM"); }, timeoutMs);
    const forceTimer = setTimeout(() => this.killGroup(child.pid, "SIGKILL"), timeoutMs + 3000);
    try {
      const code = await new Promise((resolveExit, reject) => {
        child.once("error", reject);
        child.once("close", (status, signal) => resolveExit(status ?? signal));
      });
      if (expired || code !== 0) throw new Error(`${executable} ${expired ? "超时" : `退出 ${code}`}；日志：${log}\n${output.slice(-6000)}`);
      return executable === "playwright-cli" ? cliResult(output) : output;
    } finally {
      clearTimeout(timer); clearTimeout(forceTimer);
      try { await writes; } finally { await file.close(); }
    }
  }

  #assertRunning() {
    if (this.stopping) throw new Error("本轮已开始清理，拒绝迟到的测试步骤");
  }

  killGroup(pid, signal) {
    if (!pid) return;
    try { process.kill(-pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }

  async waitForServer(child, url, timeoutMs = 120_000) {
    this.#assertRunning();
    this.ports.add(Number(new URL(url).port));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#assertRunning();
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`测试服务提前退出：${url}`);
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.ok || response.status === 401) return;
      } catch { /* 服务监听前的连接失败仅用于只读就绪轮询。 */ }
      await delay(100);
    }
    throw new Error(`测试服务启动超时：${url}`);
  }

  async openCli(name, config) {
    this.#assertRunning();
    await mkdir(this.directory, { recursive: true });
    this.#assertRunning();
    // 在启动之前登记，open 部分成功时也能关闭自己的 daemon。
    this.sessions.set(name, null);
    const filename = resolve(this.directory, `${name}.config.json`);
    await writeFile(filename, JSON.stringify({ outputDir: this.directory, outputMode: "stdout", ...config }));
    const result = await this.command("playwright-cli", [`-s=${name}`, "open", "about:blank", `--config=${filename}`], `${name}.open.log`);
    const daemons = (await browserProcesses()).filter(item => item.args.includes("cliDaemon.js") && item.args.includes(name));
    this.sessions.set(name, daemons.map(item => ({ pid: item.pid, started: item.started })));
    return result;
  }

  /** 原生 Playwright 没有公开进程句柄；只登记由当前 worker 派生的浏览器。 */
  async recordNativeBrowser() {
    const processes = await browserProcesses();
    const isDescendant = item => {
      let parent = item.parent;
      while (parent && parent !== process.pid) parent = processes.find(value => value.pid === parent)?.parent;
      return parent === process.pid;
    };
    for (const item of processes) {
      if (/chrome-headless-shell|chromium/.test(item.args) && item.args.includes("--user-data-dir") && isDescendant(item)) {
        this.nativeProcesses.set(item.pid, item.started);
        if (item.group === item.pid) this.nativeGroups.add(item.group);
      }
    }
    let size;
    do {
      size = this.nativeProcesses.size;
      for (const item of processes) {
        if (this.nativeProcesses.has(item.parent) || this.nativeGroups.has(item.group)) this.nativeProcesses.set(item.pid, item.started);
      }
    } while (size !== this.nativeProcesses.size);
  }

  async close() {
    if (this.closing) return this.closing;
    this.closing = this.closeOwned();
    return this.closing;
  }

  async closeOwned() {
    this.stopping = true;
    const errors = [];
    const groups = new Set([...this.children].map(child => child.pid).concat([...this.nativeGroups]));
    const processes = await browserProcesses();
    const owned = new Map(processes.filter(item => groups.has(item.group) || this.nativeProcesses.get(item.pid) === item.started
      || [...this.sessions].some(([name, owners]) => item.args.includes("cliDaemon.js") && item.args.includes(name)
        && (!owners || owners.some(owner => owner.pid === item.pid && owner.started === item.started))))
      .map(item => [item.pid, item.started]));
    // daemon 的浏览器可能另立进程组；在关闭前记录完整后代与启动时刻。
    let previousSize;
    do {
      previousSize = owned.size;
      for (const item of processes) if (owned.has(item.parent)) owned.set(item.pid, item.started);
    } while (owned.size !== previousSize);
    const remainingOwned = async () => (await browserProcesses()).filter(item => owned.get(item.pid) === item.started);
    const terminateOwned = async signal => {
      for (const item of await remainingOwned()) {
        try { process.kill(item.pid, signal); }
        catch (error) { if (error.code !== "ESRCH") errors.push(error); }
      }
    };
    for (const [name, owners] of this.sessions) {
      try { await this.command("playwright-cli", [`-s=${name}`, "close"], `${name}.close.log`, 15_000, true); }
      catch (error) { errors.push(error); }
      const remaining = (await browserProcesses()).filter(item => item.args.includes("cliDaemon.js") && item.args.includes(name)
        && (!owners || owners.some(owner => owner.pid === item.pid && owner.started === item.started)));
      for (const item of remaining) {
        try { process.kill(item.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") errors.push(error); }
      }
    }
    // AI-REMOVED 2026-10-05:
    // Reason: detached daemon 的后代可能拥有独立进程组；需按 PID 与启动时刻核验归属。
    // Trigger: 基座异常清理要求。Evidence: CLI daemon 会派生独立 Chromium 进程。
    // Replacement: 上方 owned 与 terminateOwned。Risk: Low。Human Review: Required
    // Original code:
    //     for (const child of this.children) this.killGroup(child.pid, "SIGTERM");
    //     const groups = new Set([...this.children].map(child => child.pid));
    //     let remaining = [];
    //     for (let attempt = 0; attempt < 30; attempt++) {
    //       remaining = (await browserProcesses()).filter(item => groups.has(item.group)
    //         || [...this.sessions.keys()].some(name => item.args.includes("cliDaemon.js") && item.args.includes(name)));
    //       if (!remaining.length) break;
    //       if (attempt === 15) for (const child of this.children) this.killGroup(child.pid, "SIGKILL");
    //       await delay(100);
    //     }
    await terminateOwned("SIGTERM");
    let remaining = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      remaining = await remainingOwned();
      if (!remaining.length) break;
      if (attempt === 15) await terminateOwned("SIGKILL");
      await delay(100);
    }
    if (remaining.length) errors.push(new Error(`本轮进程未释放：${remaining.map(item => item.pid).join(",")}`));
    for (const port of this.ports) if (await portIsOpen(port)) errors.push(new Error(`本轮端口未释放：${port}`));
    process.removeListener("SIGINT", this.signal);
    process.removeListener("SIGTERM", this.signal);
    await mkdir(this.directory, { recursive: true });
    await writeFile(resolve(this.directory, "cleanup.json"), JSON.stringify({ passed: !errors.length,
      sessions: [...this.sessions.keys()], ports: [...this.ports], remaining: remaining.map(item => item.pid), errors: errors.map(String) }, null, 2));
    if (errors.length) throw new AggregateError(errors, "浏览器轮次清理失败，禁止继续下一轮");
  }
}
