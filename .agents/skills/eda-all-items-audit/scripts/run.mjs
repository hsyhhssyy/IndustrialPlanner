import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, rm, rename, realpath, unlink } from "node:fs/promises";
import { dirname, resolve, posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ROOT, SKILL, LATEST, OUTPUT, WORK, readJson, saveJson, hash, writeHistory, measureMilestones, failureStopDecision } from "./common.mjs";
import { acquireBrowserLease, browserLeasePath } from "../../../../scripts/browser-test/runtime.mjs";
import { acceptCollectedResult, readCollectedResult } from "./result-retention.mjs";
import { reuseCompletedResults } from "./result-reuse.mjs";

const exec = promisify(execFile);
const policy = await readJson(resolve(SKILL, "policy.json"));
const windows = policy.windows;
process.chdir(ROOT);

/** 传输的 Python 程序用 Base64 包装；用户公式/路径不进入 shell 拼接。 */
async function remotePython(code, timeout = 55_000, attempts = 1) {
  assert(Number.isInteger(attempts) && attempts >= 1 && attempts <= 3);
  const payload = Buffer.from(code).toString("base64");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { stdout } = await exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "LogLevel=ERROR", windows.host,
        `"${windows.python}" -X utf8 -c "import base64;exec(base64.b64decode('${payload}'))"`], { timeout, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout.trim());
    } catch (error) {
      if (attempt === attempts) throw error;
      await delay(1000);
    }
  }
}

async function action(command, manifest, extra = {}) {
  const configuration = { ...windows, runId: manifest.runId, bundleSha256: manifest.bundleSha256,
    browserAttemptOffset: manifest.browserAttemptOffset ?? 0, ...extra };
  const args = [posix.join(windows.tools, "windows-runner.py"), "--command", command,
    "--config-base64", Buffer.from(JSON.stringify(configuration)).toString("base64")];
  const encoded = Buffer.from(JSON.stringify(args)).toString("base64");
  // 仅只读状态查询允许重试；启动、回收确认等写操作仍单次执行，避免传输结果不明时重复副作用。
  return remotePython(`import base64,json,runpy,sys\nsys.argv=json.loads(base64.b64decode('${encoded}'))\nrunpy.run_path(sys.argv[0],run_name='__main__')`, command === "pack" ? 300_000 : 55_000, command === "status" ? 3 : 1);
}

/** 只读现场检查，不启动浏览器、规划任务或安装软件。 */
export async function doctor() {
  const configuration = Buffer.from(JSON.stringify(windows)).toString("base64");
  return remotePython(`import base64,json,sys,socket\nfrom pathlib import Path\nimport win32com.client\nc=json.loads(base64.b64decode('${configuration}'))\ns=win32com.client.Dispatch('Schedule.Service');s.Connect();f=s.GetFolder(chr(92))\nw=win32com.client.GetObject('winmgmts:')\nrows=list(w.ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe' OR Name='msedge.exe' OR Name='chrome.exe' OR Name='python.exe'"))\nforeign=[int(p.ProcessId) for p in rows if '--remote-debugging' in (p.CommandLine or '') or 'cliDaemon' in (p.CommandLine or '')]\nowned=[int(p.ProcessId) for p in rows if c['root'].lower() in (p.CommandLine or '').replace(chr(92),'/').lower() or 'eda-all-items-session-' in (p.CommandLine or '')]\nwith socket.socket() as sock: port=sock.connect_ex(('127.0.0.1',c['port']))==0\ntasks=[t.Name for t in f.GetTasks(1) if t.Name.startswith('Endfield-EDA-AllItems-') and t.State==4]\nprint(json.dumps({'python':sys.version,'node':Path(c['node']).is_file(),'edge':Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe').is_file(),'foreignBrowserPids':foreign,'ownedPids':owned,'activeTasks':tasks,'portOpen':port,'idle':not foreign and not owned and not tasks and not port}))`);
}

async function requireIdle() {
  const state = await doctor();
  if (!state.node || !state.edge || !state.idle) throw new Error(`Windows 未就绪；等待已有任务完成并清理：${JSON.stringify(state)}`);
  return state;
}

async function install() {
  const tools64 = Buffer.from(windows.tools).toString("base64");
  await remotePython(`import base64,json\nfrom pathlib import Path\np=Path(base64.b64decode('${tools64}').decode());p.mkdir(parents=True,exist_ok=True)\nprint(json.dumps({'toolsReady':True}))`);
  const { stdout } = await exec("which", ["playwright-cli"]);
  const cli = dirname(await realpath(stdout.trim()));
  await mkdir(WORK, { recursive: true });
  const archive = resolve(WORK, "cli.tar.gz");
  await exec("tar", ["-czf", archive, "-C", cli, "."], { timeout: 60_000 });
  const cliHash = hash(await readFile(archive));
  const config64 = Buffer.from(JSON.stringify({ tools: windows.tools, hash: cliHash })).toString("base64");
  const current = await remotePython(`import base64,json\nfrom pathlib import Path\nc=json.loads(base64.b64decode('${config64}'));p=Path(c['tools'])\nprint(json.dumps({'same':(p/'cli.sha256').exists() and (p/'cli.sha256').read_text()==c['hash']}))`);
  if (!current.same) {
    await exec("scp", ["-q", archive, `${windows.host}:${windows.tools}/cli.tar.gz`], { timeout: 300_000 });
    await remotePython(`import base64,json,hashlib,tarfile,shutil\nfrom pathlib import Path\nc=json.loads(base64.b64decode('${config64}'));p=Path(c['tools']);a=p/'cli.tar.gz'\nassert hashlib.sha256(a.read_bytes()).hexdigest()==c['hash'],'CLI transfer hash mismatch'\nshutil.rmtree(p/'cli',ignore_errors=True);(p/'cli').mkdir()\nwith tarfile.open(a) as t:t.extractall(p/'cli',filter='data')\na.unlink();(p/'cli.sha256').write_text(c['hash'])\nprint(json.dumps({'installed':True}))`, 55_000);
  }
  await exec("scp", ["-q", resolve(SKILL, "scripts/windows-runner.py"), `${windows.host}:${windows.tools}/windows-runner.py`], { timeout: 55_000 });
  await rm(archive, { force: true });
}

async function collect(manifest, summary, rows) {
  assert.match(summary.itemId, /^item_[A-Za-z0-9_]+$/);
  if (summary.reusedFrom) {
    const collected = await readCollectedResult(manifest, summary.itemId);
    assert.deepEqual(collected?.summary, summary, "复用结果与原始证据不一致。");
    assert.deepEqual(rows.find(row => row.itemId === summary.itemId), summary, "复用成绩尚未持久化。");
    await action("ack", manifest, { itemId: summary.itemId });
    return;
  }
  // AI-REMOVED 2026-10-30:
  // Reason: 摘要文件存在不能证明回收完整，且 latest 轮换会丢失唯一任务副本。
  // Trigger: 用户要求每物品最新结果校验落盘后再删除旧结果。
  // Evidence: 原回收按 summary.json 判断完成，随后将任务移入会在 prepare 被清空的 latest/tasks。
  // Replacement: readCollectedResult、临时目录完整解包、acceptCollectedResult。
  // Risk: 新回收证据不完整时保留旧结果并停止回收确认。
  // Human Review: Required
  // Original code:
  // const directory = resolve(LATEST, "runtime/collected", summary.itemId);
  // let local = await readJson(resolve(directory, "summary.json")).catch(error => {
  //   if (error.code === "ENOENT") return null;
  //   throw error;
  // });
  const collected = await readCollectedResult(manifest, summary.itemId);
  const directory = collected?.directory ?? resolve(LATEST, "runtime/collected", summary.itemId);
  let local = collected?.summary;
  let transferSha256 = collected?.receipt.transferSha256 ?? null;
  if (!collected) {
    const packed = await action("pack", manifest, { itemId: summary.itemId });
    const archive = resolve(LATEST, "runtime/transfer.tar.gz");
    await exec("scp", ["-q", `${windows.host}:${windows.root}/latest/transfer.tar.gz`, archive], { timeout: 300_000 });
    assert.equal(hash(await readFile(archive)), packed.sha256, "回传文件 SHA-256 不匹配。");
    transferSha256 = packed.sha256;
    const { stdout } = await exec("tar", ["-tzf", archive]);
    assert(stdout.trim().split("\n").every(path => path.split("/")[0] === summary.itemId && !path.split("/").includes("..")), "回传包目录越界。");
    await mkdir(dirname(directory), { recursive: true });
    // AI-REMOVED 2026-10-30:
    // Reason: 直接解包到最终目录可能在异常后留下可被误认作完整结果的摘要。
    // Trigger: 新旧结果切换必须以完整回收为前提。
    // Evidence: tar 失败可能已写入 summary.json，而旧代码只检查该文件是否存在。
    // Replacement: 下方 incoming 临时目录解包成功后 rename。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // await exec("tar", ["-xzf", archive, "-C", dirname(directory)]);
    await mkdir(WORK, { recursive: true });
    const incoming = await mkdtemp(resolve(WORK, "collect-"));
    try {
      await exec("tar", ["-xzf", archive, "-C", incoming]);
      assert.deepEqual(await readJson(resolve(incoming, summary.itemId, "summary.json")), summary, "回收结果与远端摘要不一致。");
      await rm(directory, { recursive: true, force: true });
      await rename(resolve(incoming, summary.itemId), directory);
    } finally { await rm(incoming, { recursive: true, force: true }); }
    await rm(archive, { force: true });
    local = await readJson(resolve(directory, "summary.json"));
  }
  assert.deepEqual(local, summary, "回收结果与远端摘要不一致。");
  // AI-REMOVED 2026-10-30:
  // Reason: 每物品任务与证据统一放入跨轮保留目录，避免 prepare 删除最后一份结果。
  // Trigger: 用户要求新结果落盘后逐物品替换旧结果。
  // Evidence: latest/tasks 属于原 prepare 的整体删除范围。
  // Replacement: acceptCollectedResult 发布 results/<item-id>/<run-id>。
  // Risk: 任务缺失不再被静默忽略；完整结算结果必须携带任务。
  // Human Review: Required
  // Original code:
  // const task = resolve(directory, "task.eda-task.json");
  // await mkdir(resolve(LATEST, "tasks"), { recursive: true });
  // try { await rename(task, resolve(LATEST, "tasks", `${summary.itemId}.eda-task.json`)); }
  // catch (error) { if (error.code !== "ENOENT") throw error; }
  const inputs = await readJson(resolve(LATEST, "runtime/cases.json"));
  await acceptCollectedResult(manifest, inputs.find(input => input.itemId === summary.itemId), local, directory, transferSha256);
  if (!rows.some(row => row.itemId === local.itemId)) rows.push(local);
  if (local.hardware) manifest.hardware ??= local.hardware;
  await saveJson(resolve(LATEST, "rows.json"), rows);
  await writeHistory(manifest, rows);
  if (manifest.failureStopThreshold !== undefined) {
    const decision = failureStopDecision(rows, manifest.failureStopThreshold);
    if (decision.shouldStop) {
      // 必须先设置远端停止标记，再确认回收；远端等待确认期间不能启动下一项。
      await action("stop", manifest);
      manifest.stopReason = { kind: "failure-dominance", ...decision, itemId: summary.itemId, at: new Date().toISOString() };
      await saveJson(resolve(LATEST, "manifest.json"), manifest);
      await writeHistory(manifest, rows);
      console.log(JSON.stringify({ stopRequested: manifest.stopReason }));
    }
  }
  await action("ack", manifest, { itemId: summary.itemId });
}

async function acquire(manifest, recover) {
  if (recover) {
    const lock = browserLeasePath("windows");
    const owner = await readJson(lock);
    assert.equal(owner.label, `eda-all-items:${manifest.runId}`, "执行锁不是本轮所有，不能接管。");
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
    assert(!alive, "原本地执行器仍存活，不能接管。");
    // AI-REMOVED 2026-10-26:
    // Reason: Windows 与本机使用独立锁，本机浏览器不再阻止远端接管。
    // Trigger: 用户要求从下一物品开始分离远端 Windows 锁。
    // Evidence: 本轮控制器占用 browser.lock，而实际 Edge 全部运行在 Windows。
    // Replacement: browserLeasePath("windows")、远端轮次核验与远端 verify_idle。
    // Risk: 不同机器允许并行；同一 Windows 资源继续互斥。
    // Human Review: Required
    // Original code:
    // await assertBrowserIdle();
    const state = await action("status", manifest);
    assert.equal(state.runId, manifest.runId, "远端轮次不匹配，不能接管。");
    await unlink(lock);
  }
  return acquireBrowserLease(`eda-all-items:${manifest.runId}`, { resource: "windows" });
}

async function monitor(manifest) {
  const rows = await readJson(resolve(LATEST, "rows.json")).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  let previous = "";
  for (;;) {
    const data = await action("status", manifest);
    assert.equal(data.runId, manifest.runId, "远端执行轮次发生变化。");
    const acknowledgements = new Set(data.acknowledgedItems);
    for (const summary of data.summaries) if (!acknowledgements.has(summary.itemId)) await collect(manifest, summary, rows);
    await saveJson(resolve(LATEST, "runtime/status.json"), data);
    const line = JSON.stringify({ phase: data.status.phase, itemId: data.status.itemId, progress: data.status.progress, recorded: rows.length, total: manifest.itemIds.length });
    if (line !== previous) { console.log(line); previous = line; }
    if (!data.runnerAlive && !data.taskRunning) {
      assert(["completed", "stopped", "fatal"].includes(data.status.phase), "远端意外退出，保留现场，禁止重开冷任务。");
      const covered = rows.length === manifest.itemIds.length && rows.every(row => row.completed && row.cleanupPassed);
      const cleanup = await action("cleanup", manifest, { keepFrozen: data.status.phase !== "completed" || !covered });
      await saveJson(resolve(LATEST, "runtime/final-cleanup.json"), cleanup);
      manifest.state = data.status.phase;
      await saveJson(resolve(LATEST, "manifest.json"), manifest);
      await writeHistory(manifest, rows);
      if (data.status.phase === "completed") {
        assert.equal(rows.length, manifest.itemIds.length, "全量覆盖不完整。");
        assert(rows.every(row => row.completed && row.cleanupPassed), "执行或清理未完成。");
        await rm(resolve(LATEST, "runtime/dist"), { recursive: true, force: true });
        await rm(resolve(LATEST, "runtime/bundle.tar.gz"), { force: true });
      }
      return { phase: data.status.phase, records: rows.length, firstPassed: rows.filter(row => row.firstPassed).length,
        secondPassed: rows.filter(row => row.firstPassed && row.secondPassed).length, error: data.status.error ?? null };
    }
    await delay(10_000);
  }
}

async function run(manifest, resume, recover) {
  const frozen = await readJson(resolve(LATEST, "runtime/source-fingerprint.json"));
  for (const [path, expected] of Object.entries(frozen).filter(([path]) => path.startsWith(".agents/skills/eda-all-items-audit/"))) {
    assert.equal(hash(await readFile(resolve(ROOT, path))), expected, `执行设施在 prepare 后变化：${path}；重新 prepare。`);
  }
  const release = await acquire(manifest, recover);
  let cleaned = false;
  const signal = () => { void action("stop", manifest).catch(error => console.error(String(error))); };
  process.once("SIGINT", signal); process.once("SIGTERM", signal);
  try {
    if (!resume) {
      assert.equal(manifest.state, "prepared", "已有执行记录，请使用 resume 或重新 prepare。");
      await requireIdle();
      await install();
      await action("reset", manifest);
      await exec("scp", ["-q", resolve(LATEST, "runtime/bundle.tar.gz"), `${windows.host}:${windows.root}/latest/bundle.tar.gz`], { timeout: 300_000 });
      await action("unpack", manifest);
      await action("launch", manifest);
    } else {
      const state = await action("status", manifest);
      assert.equal(state.runId, manifest.runId, "远端轮次与本地不一致。");
      if (!state.runnerAlive && !state.taskRunning) {
        assert.notEqual(state.status.phase, "completed", "本轮已结束，无需恢复。");
        assert(state.summaries.every(row => row.completed && row.cleanupPassed), "存在中断项目，禁止自动重开；检查 latest 中的任务现场。");
        const reused = await reuseCompletedResults(manifest, state, action);
        if (reused.length) console.log(JSON.stringify({ reusedItems: reused }));
        await action("launch", manifest);
      }
    }
    manifest.state = "running";
    await saveJson(resolve(LATEST, "manifest.json"), manifest);
    const result = await monitor(manifest);
    cleaned = true;
    console.log(JSON.stringify(result));
    if (result.phase !== "completed") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", signal); process.removeListener("SIGTERM", signal);
    if (!cleaned) {
      // 连接中断不意味着远端停止；保留共享锁，后续只能核验归属后接管。
      await saveJson(resolve(LATEST, "runtime/controller-interrupted.json"), { pid: process.pid, at: new Date().toISOString(), runId: manifest.runId });
      try {
        const state = await action("status", manifest);
        if (!state.runnerAlive && !state.taskRunning && !state.remaining.length && !state.portOpen) {
          await action("cleanup", manifest, { keepFrozen: true });
          cleaned = true;
        }
      } catch { /* 归属未验证时保留锁和现场。 */ }
    }
    if (cleaned) await release();
  }
}

const args = process.argv.slice(2), command = args.shift() ?? "help";
let formula = null, recover = false, failureStopThreshold, algorithmRef = null, selectedItemIds = null, searchMode = 2;
while (args.length) {
  const key = args.shift();
  if (key === "--area" && command === "prepare" && args.length) formula = args.shift();
  else if (key === "--search-mode" && command === "prepare" && args.length) {
    const value = args.shift();
    assert.match(value, /^[1234]$/, "搜索模式必须为 1、2、3 或 4。");
    searchMode = Number(value);
  }
  else if (key === "--algorithm-ref" && command === "prepare" && args.length) algorithmRef = args.shift();
  else if (key === "--items" && command === "prepare" && args.length) selectedItemIds = args.shift().split(",").map(id => id.trim());
  else if (key === "--recover-lock" && command === "resume") recover = true;
  else if (key === "--stop-on-failure-dominance" && ["run", "resume"].includes(command) && args.length) {
    const value = args.shift();
    assert.match(value, /^\d+$/, "失败停止门槛必须是非负整数。");
    failureStopThreshold = Number(value);
    failureStopDecision([], failureStopThreshold);
  }
  else throw new Error(`未知或不适用的参数：${key}`);
}
try {
  if (command === "help" || command === "--help") {
    console.log("prepare --search-mode 1|2|3|4：1=跑满累计50M；2=最多50M、次解即停（默认）；3=每次追加50M直到次解；4=至少跑满50M且找到次解。resume 沿用冻结模式，并校验已登记的跨轮复用结果。");
    console.log("prepare 可附加 --algorithm-ref <已授权标签> --items <逗号分隔物品ID>；省略 --area 使用该版本默认面积。run 可附加 --stop-on-failure-dominance <门槛>。");
    console.log("EDA 全物品 Windows 专项\ndoctor  只读环境检查\nsetup  安装/核验远端固定执行器和 CLI，不启动浏览器\nprepare [--area '2S'|数学公式]  冻结当前输入和测试构建，保留各物品旧结果直到新结果回收\nrun  执行已准备的全量队列\nstatus  查看当前轮次与远端状态\nstop  当前项结束后停止\ncancel  取消当前项并停止（不可自动重开该项）\nresume [--recover-lock]  恢复已结算项目后的队列，或接管仍运行的远端\naudit  复核最新任务和精简历史记录\nself-test  无浏览器、无搜索的工具自检");
  } else if (command === "doctor") console.log(JSON.stringify(await doctor(), null, 2));
  else if (command === "setup") {
    const release = await acquireBrowserLease("eda-all-items:setup", { resource: "windows" });
    try {
      await requireIdle(); await install();
      console.log(JSON.stringify(await action("preflight", { runId: "setup" })));
    } finally { await release(); }
  }
  else if (command === "prepare") {
    const release = await acquireBrowserLease("eda-all-items:prepare", { resource: "windows" });
    try { await requireIdle(); const { prepare } = await import("./prepare.mjs"); console.log(JSON.stringify(await prepare(formula, algorithmRef, selectedItemIds, searchMode))); }
    finally { await release(); }
  } else if (command === "self-test") await import("./self-test.mjs");
  else if (command === "audit") { const { audit } = await import("./audit.mjs"); console.log(JSON.stringify(await audit())); }
  else {
    const manifest = await readJson(resolve(LATEST, "manifest.json"));
    if (failureStopThreshold !== undefined) manifest.failureStopThreshold = failureStopThreshold;
    if (command === "run" || command === "resume") await run(manifest, command === "resume", recover);
    else if (command === "status") console.log(JSON.stringify({ manifest: { runId: manifest.runId, state: manifest.state, formula: manifest.formula,
      searchMode: manifest.searchMode ?? 2 }, remote: await action("status", manifest) }, null, 2));
    else if (command === "stop" || command === "cancel") console.log(JSON.stringify(await action(command, manifest)));
    else throw new Error(`未知操作：${command}`);
  }
} catch (error) {
  console.error(error.stack ?? String(error)); process.exitCode = 1;
}
