"""Windows 交互桌面、Playwright CLI 串行执行器；只清理本技能有明确归属的资源。"""
import argparse
import base64
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import traceback


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".new")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def read(path, fallback=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback


def processes():
    import win32com.client
    wmi = win32com.client.GetObject("winmgmts:")
    return [dict(pid=int(p.ProcessId), parent=int(p.ParentProcessId), command=p.CommandLine or "", created=str(p.CreationDate))
            for p in wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe' OR Name='msedge.exe' OR Name='chrome.exe' OR Name='python.exe'")]


def assert_idle():
    foreign = [p["pid"] for p in processes() if "cliDaemon" in p["command"] or "--remote-debugging" in p["command"]
               or "playwright/driver" in p["command"].replace(chr(92), "/") or re.search(r"playwright(?:\.cmd)?\s+test", p["command"])]
    if foreign:
        raise RuntimeError("其他浏览器测试尚在运行，请等待完成与清理：" + str(foreign))


def port_open(port):
    with socket.socket() as probe:
        probe.settimeout(1)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def scheduler():
    import win32com.client
    service = win32com.client.Dispatch("Schedule.Service")
    service.Connect()
    return service, service.GetFolder(chr(92))


def task_info(config):
    _, folder = scheduler()
    tasks = [task for task in folder.GetTasks(1) if task.Name.startswith("Endfield-EDA-AllItems-")]
    return tasks


def owned_processes(latest):
    marker = str(latest).replace(chr(92), "/").lower()
    return [p for p in processes() if p["pid"] != os.getpid()
            and (marker in p["command"].replace(chr(92), "/").lower() or "eda-all-items-session-" in p["command"])]


def verify_idle(config):
    if any(task.State == 4 for task in task_info(config)):
        raise RuntimeError("本技能上一轮计划任务仍在运行。")
    latest = Path(config["root"]) / "latest"
    if owned_processes(latest) or port_open(config["port"]):
        raise RuntimeError("上一轮所属进程或专用端口尚未释放。")
    assert_idle()


def cli(config, session, directory, args, timeout=90):
    process = subprocess.Popen([config["node"], str(Path(config["tools"]) / "cli/playwright-cli.js"), "-s=" + session, *args],
                               cwd=str(directory), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               encoding="utf-8", errors="replace", creationflags=0x08000000)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
        process.communicate(timeout=10)
        raise
    output = stdout + stderr
    with (directory / "cli.log").open("a", encoding="utf-8") as stream:
        stream.write("\nCOMMAND " + repr(args[:2]) + "\n" + output + "\n")
    if process.returncode or re.search(r"^### Error", output, re.M):
        raise RuntimeError("Playwright CLI 失败：" + output[-4000:])
    return output


def run_code(config, session, directory, source, name, timeout=90):
    path = directory / (name + ".js")
    path.write_text(source, encoding="utf-8")
    output = cli(config, session, directory, ["run-code", "--filename=" + str(path)], timeout)
    match = re.search(r"^### Result\r?\n([\s\S]*?)(?=^### |\Z)", output, re.M)
    if not match:
        raise RuntimeError("CLI 没有结构化结果：" + output[-1000:])
    return json.loads(match.group(1).strip())


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def execute(config, record, number, latest):
    directory = latest / "cases" / record["itemId"]
    directory.mkdir(parents=True, exist_ok=True)
    summary = dict(itemId=record["itemId"], name=record["name"], firstAttempts=None, secondAttempts=None,
                   firstPassed=False, secondPassed=False, completed=False, cleanupPassed=False, error=None)
    if record["preparationError"]:
        summary.update(completed=True, cleanupPassed=True, error=record["preparationError"], errorKind="preparation")
        save(directory / "summary.json", summary)
        return summary
    assert_idle()
    if port_open(config["port"]):
        raise RuntimeError("专用端口被占用，不能开始本项。")
    profiles = [(2552, 1315, 1), (764, 345, 3.125), (711, 665, 3.125)]
    width, height, scale = profiles[number] if number < 3 else profiles[0]
    session = "eda-all-items-session-" + str(number)
    profile = directory / "profile"
    save(directory / "browser.json", dict(outputDir=str(directory), outputMode="stdout", browser=dict(browserName="chromium", userDataDir=str(profile),
        launchOptions=dict(channel="msedge", headless=False, args=["--disable-software-rasterizer"]),
        contextOptions=dict(viewport=dict(width=width, height=height), deviceScaleFactor=scale, hasTouch=True, locale="zh-CN", serviceWorkers="block"))))
    before = {p["pid"]: p["created"] for p in processes()}
    server = None
    server_thread = None
    opened = False
    started = time.monotonic()
    state = None

    def evaluate(code, name, timeout=90):
        return run_code(config, session, directory, "async page => await page.evaluate(" + code + ")", name, timeout)

    def persist_task():
        task = evaluate("() => window.__edaAuditPayload ?? null", "export-task", 180)
        if task is not None:
            save(directory / "task.eda-task.json", task)

    try:
        http.server.ThreadingHTTPServer.request_queue_size = 128
        server = http.server.ThreadingHTTPServer(("127.0.0.1", config["port"]), functools.partial(QuietHandler, directory=str(latest / "dist")))
        server.daemon_threads = True
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        opened = True
        cli(config, session, directory, ["open", "about:blank", "--config=" + str(directory / "browser.json")])
        cli(config, session, directory, ["goto", "http://127.0.0.1:" + str(config["port"]) + "/"], 180)
        run_code(config, session, directory,
                 "async page => { await page.waitForFunction(() => window.__edaAuditHost?.workspace.blueprintPlanner, null, {timeout:120000}); return {ready:true}; }", "ready", 150)
        source = (latest / "browser-scenario.txt").read_text(encoding="utf-8")
        measure = (latest / "measure.txt").read_text(encoding="utf-8")
        code = "async record => { const measure = " + measure + "; return (" + source + ")(record, measure); }," + json.dumps(record, ensure_ascii=False)
        evaluate(code, "start", 150)
        cli(config, session, directory, ["screenshot", "--filename=" + str(directory / "initial.png")])
        saved = set()
        while True:
            state = evaluate("() => window.__edaAudit", "poll")
            save(latest / "status.json", dict(phase="running", itemId=record["itemId"], name=record["name"], progress=state.get("progress"), pid=os.getpid()))
            stage = state.get("pending")
            if stage and stage not in saved:
                persist_task()
                save(directory / ("stage-" + stage + ".json"), state)
                evaluate("() => { window.__edaAudit.acknowledged = " + json.dumps(stage) + "; return true; }", "ack")
                saved.add(stage)
            if state.get("done"):
                break
            if (latest / "STOP_NOW").exists() or time.monotonic() - started > 7500:
                evaluate("() => { window.__edaAuditCancel(); return true; }", "cancel")
            if time.monotonic() - started > 7800:
                raise RuntimeError("浏览器超过取消结算保护时间。")
            time.sleep(5)
        persist_task()
        progress = state.get("progress") or {}
        summary.update({key: progress.get(key) for key in ["firstAttempts", "secondAttempts", "firstPassed", "secondPassed"]})
        summary.update(completed=state["completed"], error=state["error"], errorKind=state.get("errorKind"),
                       evaluations=progress.get("evaluatedProposals", 0), hardware=state.get("hardware"), area=state.get("area"), stages=state.get("stages"))
        cli(config, session, directory, ["screenshot", "--filename=" + str(directory / "final.png")])
    except Exception:
        summary.update(error=traceback.format_exc(), errorKind="runtime", completed=False)
        if opened:
            try:
                run_code(config, session, directory,
                    "async page => { await page.evaluate(() => window.__edaAuditCancel?.()); await page.waitForFunction(() => window.__edaAudit?.done, null, {timeout:120000}); return true; }", "settle-failure", 150)
                persist_task()
                cli(config, session, directory, ["screenshot", "--filename=" + str(directory / "failed.png")])
            except Exception:
                save(directory / "export-error.json", dict(error=traceback.format_exc()))
    finally:
        errors = []
        if opened:
            try:
                cli(config, session, directory, ["close"], 60)
            except Exception as error:
                errors.append(str(error))
        if server:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=5)
        marker = str(profile).replace(chr(92), "/").lower()
        owned = [p for p in processes() if before.get(p["pid"]) != p["created"]
                 and (marker in p["command"].replace(chr(92), "/").lower() or session in p["command"])]
        for process in owned:
            subprocess.run(["taskkill", "/PID", str(process["pid"]), "/T", "/F"], capture_output=True, creationflags=0x08000000)
        time.sleep(1)
        remaining = [p for p in processes() if any(p["pid"] == old["pid"] and p["created"] == old["created"] for old in owned)
                     or before.get(p["pid"]) != p["created"] and (marker in p["command"].replace(chr(92), "/").lower() or session in p["command"])]
        cleanup = dict(passed=not remaining and not port_open(config["port"]) and not errors, remaining=remaining, errors=errors, portOpen=port_open(config["port"]))
        summary["cleanupPassed"] = cleanup["passed"]
        save(directory / "cleanup.json", cleanup)
        save(directory / "summary.json", summary)
        if not remaining:
            shutil.rmtree(profile, ignore_errors=True)
        # CLI 的重复场景源码不属于证据；防止每项再保存一份完整请求。
        for path in directory.glob("*.js"):
            path.unlink()
    return summary


def worker(config):
    latest = Path(config["root"]) / "latest"
    cases = read(latest / "cases.json")
    summaries = read(latest / "summaries.json", [])
    existing = {row["itemId"]: row for row in summaries}
    browser_number = sum(row.get("errorKind") != "preparation" for row in summaries)
    try:
        for number, record in enumerate(cases):
            prior = existing.get(record["itemId"])
            if prior:
                if not prior["completed"] or not prior["cleanupPassed"]:
                    raise RuntimeError("存在未完整结算的项目，禁止自动重开冷任务。")
                continue
            if (latest / "STOP_AFTER_CASE").exists() or (latest / "STOP_NOW").exists():
                break
            if (latest / "cases" / record["itemId"]).exists():
                raise RuntimeError("发现未结算现场，禁止覆盖或重开该项。")
            summary = execute(config, record, browser_number, latest)
            if not record["preparationError"]:
                browser_number += 1
            summaries.append(summary)
            save(latest / "summaries.json", summaries)
            save(latest / "status.json", dict(phase="awaiting-collection", itemId=record["itemId"], pid=os.getpid()))
            # 每项已完成 finally 后等待校验回收，控制远端占用和跨轮资源生命周期。
            deadline = time.monotonic() + 900
            while not (latest / "acks" / (record["itemId"] + ".json")).exists():
                if time.monotonic() > deadline:
                    raise RuntimeError("十五分钟未收到回收确认；暂停队列，任务现场保留。")
                time.sleep(3)
            if not summary["cleanupPassed"] or not summary["completed"]:
                raise RuntimeError("运行故障或清理失败，停止队列；不得自动重开。");
        phase = "completed" if len(summaries) == len(cases) else "stopped"
        save(latest / "status.json", dict(phase=phase, pid=os.getpid(), completed=len(summaries), total=len(cases)))
    except Exception:
        save(latest / "status.json", dict(phase="fatal", pid=os.getpid(), error=traceback.format_exc()))


def operate(command, config):
    root = Path(config["root"])
    if root.name != "all-items" or root.parent.name != "eda" or root.parent.parent.name != ".temp":
        raise RuntimeError("远端根目录必须是本专项 .temp/eda/all-items。")
    latest = root / "latest"
    if command == "worker":
        worker(config)
        return dict(workerExited=True)
    if command == "preflight":
        verify_idle(config)
        result = subprocess.run([config["node"], str(Path(config["tools"]) / "cli/playwright-cli.js"), "--version"],
                                capture_output=True, text=True, timeout=20, creationflags=0x08000000, check=True)
        return dict(idle=True, python=sys.version, node=Path(config["node"]).is_file(), cliVersion=result.stdout.strip())
    if command == "reset":
        verify_idle(config)
        shutil.rmtree(latest, ignore_errors=False) if latest.exists() else None
        latest.mkdir(parents=True)
        return dict(reset=True)
    if command == "unpack":
        verify_idle(config)
        bundle = latest / "bundle.tar.gz"
        actual = hashlib.sha256(bundle.read_bytes()).hexdigest()
        if actual != config["bundleSha256"]:
            raise RuntimeError("测试包 SHA-256 不匹配。")
        with tarfile.open(bundle) as archive:
            archive.extractall(latest, filter="data")
        bundle.unlink()
        save(latest / "config.json", config)
        return dict(verified=True, sha256=actual)
    if command == "launch":
        verify_idle(config)
        for flag in ["STOP_AFTER_CASE", "STOP_NOW"]:
            (latest / flag).unlink(missing_ok=True)
        service, folder = scheduler()
        for task in task_info(config):
            folder.DeleteTask(task.Name, 0)
        definition = service.NewTask(0)
        definition.Principal.UserId = config["user"]
        definition.Principal.LogonType = 3
        definition.Principal.RunLevel = 1
        definition.Settings.Enabled = True
        definition.Settings.AllowDemandStart = True
        definition.Settings.ExecutionTimeLimit = "PT0S"
        definition.Settings.Hidden = True
        action = definition.Actions.Create(0)
        action.Path = config["python"]
        payload = base64.b64encode(json.dumps(config).encode()).decode()
        action.Arguments = '-X utf8 "' + str(Path(config["tools"]) / "windows-runner.py") + '" --command worker --config-base64 ' + payload
        task = folder.RegisterTaskDefinition("Endfield-EDA-AllItems-" + config["runId"], definition, 2, None, None, 3)
        task.Run(None)
        return dict(started=True, task=task.Name)
    if command == "status":
        state = read(latest / "status.json", dict(phase="prepared"))
        rows = processes()
        alive = any(p["pid"] == state.get("pid") for p in rows)
        remote_config = read(latest / "config.json", {})
        acknowledgements = latest / "acks"
        return dict(runId=remote_config.get("runId"), status=state, summaries=read(latest / "summaries.json", []), runnerAlive=alive,
                    acknowledgedItems=[p.stem for p in acknowledgements.glob("*.json")] if acknowledgements.exists() else [],
                    taskRunning=any(task.State == 4 for task in task_info(config)),
                    remaining=owned_processes(latest), portOpen=port_open(config["port"]))
    if command in ["stop", "cancel"]:
        (latest / ("STOP_NOW" if command == "cancel" else "STOP_AFTER_CASE")).touch()
        return dict(requested=command)
    if command == "pack":
        item = config["itemId"]
        if not re.fullmatch(r"item_[A-Za-z0-9_]+", item):
            raise RuntimeError("非法物品 ID。")
        source = latest / "cases" / item
        path = latest / "transfer.tar.gz"
        with tarfile.open(path, "w:gz", compresslevel=1) as archive:
            archive.add(source, arcname=item)
        return dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bytes=path.stat().st_size)
    if command == "ack":
        item = config["itemId"]
        if not re.fullmatch(r"item_[A-Za-z0-9_]+", item):
            raise RuntimeError("非法物品 ID。")
        source = latest / "cases" / item
        if source.exists():
            shutil.rmtree(source)
        (latest / "transfer.tar.gz").unlink(missing_ok=True)
        save(latest / "acks" / (item + ".json"), dict(localVerified=True))
        return dict(acknowledged=True)
    if command == "cleanup":
        verify_idle(config)
        _, folder = scheduler()
        for task in task_info(config):
            folder.DeleteTask(task.Name, 0)
        if not config.get("keepFrozen"):
            shutil.rmtree(latest / "dist", ignore_errors=True)
        return dict(cleanupPassed=True)
    raise RuntimeError("未知操作：" + command)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", required=True)
    parser.add_argument("--config-base64", required=True)
    args = parser.parse_args()
    configuration = json.loads(base64.b64decode(args.config_base64))
    print(json.dumps(operate(args.command, configuration), ensure_ascii=False))
