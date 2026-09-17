"""有界常驻 Node 执行池；单一协调者管理预算、资源和原子结果，不并发写数据库。"""
from __future__ import annotations

from collections import deque
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import time
import uuid

from eda_resources import MIB, CpuMonitor, admission_slots, own_rss, process_group, resources


def terminate_worker(process):
    # 节流时可能处于 SIGSTOP；先恢复才能处理正常退出，再限定等待后强制清理本组。
    for sig in (signal.SIGCONT, signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            break
        if sig != signal.SIGCONT:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            if not process_group(process.pid)["pids"]:
                break
    process.wait(timeout=5)
    for stream in (process.stdin, process.stdout):
        if stream:
            stream.close()
    remaining = process_group(process.pid)["pids"]
    if remaining:
        raise RuntimeError(f"EDA 执行器清理不完整：{remaining}")


class ExecutionPool:
    def __init__(self, root, directory, policy, max_workers, max_rss_bytes, checkpoint, stopped):
        self.root, self.directory, self.policy = root, directory, policy
        self.node = shutil.which("node")
        if self.node is None:
            raise RuntimeError("未找到 Node；请先在训练环境安装 Node 和项目依赖。")
        self.maximum = min(max_workers or len(policy["affinity"]), len(policy["affinity"]))
        self.max_rss_bytes, self.checkpoint, self.stopped = max_rss_bytes, checkpoint, stopped
        self.selector = selectors.DefaultSelector()
        self.slots = []
        self.worker_bytes = 384 * MIB
        self.monitor = CpuMonitor(policy)
        self.peak_rss = 0
        self.peak_workers = 0
        self.completed = 0
        self.paused_at = None
        self.cpu_pause_seconds = 0.
        self.last_report = 0.
        if max_rss_bytes and max_rss_bytes < self.worker_bytes + own_rss():
            raise ValueError("总 RSS 上限不足以预留一个执行器及协调者；请提高上限或使用自动预算。")

    def state(self):
        return {"workers": [{"pid": slot["process"].pid if slot.get("process") else None,
                              "token": slot["token"], "job": slot["job"]["id"] if slot["job"] else None}
                             for slot in self.slots],
                "peakTrainingRssBytes": self.peak_rss, "peakWorkers": self.peak_workers,
                "workerReservationBytes": self.worker_bytes, "cpuPauseSeconds": self.cpu_pause_seconds,
                "cpuPolicy": self.policy}

    def publish(self, phase, **extra):
        self.checkpoint(phase, **self.state(), **extra)
        self.last_report = time.monotonic()

    def launch(self):
        token = uuid.uuid4().hex
        slot = {"token": token, "job": None, "process": None, "ready": False,
                "buffer": b"", "launched": time.monotonic(), "peak": 0, "started": None}
        self.slots.append(slot)
        # 先保存令牌，再启动，覆盖协调者在 Popen 和保存 PID 之间崩溃的窗口。
        self.publish("launching")
        environment = dict(os.environ, EDA_TRAINING_RUN_TOKEN=token, NODE_OPTIONS="--max-old-space-size=512",
                           UV_THREADPOOL_SIZE="1", GOMAXPROCS="1")
        logs = self.directory / "workers"
        logs.mkdir(exist_ok=True)
        try:
            with (logs / f"{token}.log").open("w") as log:
                process = subprocess.Popen([self.node, "src/scripts/eda/training-worker.mjs"],
                                           cwd=self.root, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=log, start_new_session=True, bufsize=0)
            slot["process"] = process
            os.set_blocking(process.stdout.fileno(), False)
            self.selector.register(process.stdout, selectors.EVENT_READ, slot)
            self.peak_workers = max(self.peak_workers, len(self.slots))
            self.publish("starting-workers")
        except BaseException:
            self.remove(slot)
            raise

    def remove(self, slot):
        process = slot.get("process")
        if process:
            try:
                self.selector.unregister(process.stdout)
            except (KeyError, ValueError):
                pass
            terminate_worker(process)
        if slot in self.slots:
            self.slots.remove(slot)

    def close(self):
        self.throttle(False)
        errors = []
        for slot in list(self.slots):
            try:
                self.remove(slot)
            except Exception as error:
                errors.append(str(error))
        self.selector.close()
        self.publish("pool-closed")
        if errors:
            raise RuntimeError("; ".join(errors))

    def throttle(self, paused):
        now = time.monotonic()
        if paused == (self.paused_at is not None):
            return
        if paused:
            self.paused_at = now
        else:
            self.cpu_pause_seconds += now - self.paused_at
            self.paused_at = None
        for slot in self.slots:
            if slot.get("process"):
                try:
                    os.killpg(slot["process"].pid, signal.SIGSTOP if paused else signal.SIGCONT)
                except ProcessLookupError:
                    pass

    def run(self, jobs, deadline=None, on_result=None):
        waiting = deque(jobs)
        results = {}
        consecutive_start_failures = 0
        def finish(slot, stopped=None, message=None):
            job = slot["job"]
            if job is None:
                return
            record = None
            if stopped is None:
                try:
                    report = json.loads(Path(job["reportPath"]).read_text())
                    if len(report.get("records", [])) != 1 or report.get("localEvaluations", float("inf")) > job["options"]["localEvaluations"]:
                        raise ValueError("执行器报告缺少唯一候选或超过共享预算")
                    record = report["records"][0]
                except (OSError, ValueError, KeyError) as error:
                    stopped, message = "invalid-report", str(error)
            results[job["id"]] = {"record": record, "stopped": stopped, "error": message,
                                  "exitCode": 0 if stopped is None else -1,
                                  "elapsedSeconds": time.monotonic() - slot["started"],
                                  "startedAt": slot["startedAt"], "finishedAt": time.time(),
                                  "workerPid": slot["process"].pid, "workerToken": slot["token"],
                                  "peakRssBytes": slot["peak"], "workerAliveAtCompletion": slot["process"].poll() is None,
                                  "backend": "cpu",
                                  "evaluationsCharged": record.get("search", {}).get("evaluations", job["options"]["localEvaluations"])
                                  if record else job["options"]["localEvaluations"]}
            self.completed += 1
            if on_result:
                on_result(job, results[job["id"]])
            slot["job"] = None
            self.publish("running")
        try:
            while waiting or any(slot["job"] for slot in self.slots):
                now = time.monotonic()
                stop = "signal" if self.stopped() else "session-deadline" if deadline and now >= deadline else None
                if stop:
                    for slot in list(self.slots):
                        finish(slot, stop)
                        self.remove(slot)
                    while waiting:
                        job = waiting.popleft()
                        results[job["id"]] = {"record": None, "stopped": stop, "exitCode": -1,
                                              "elapsedSeconds": 0, "peakRssBytes": 0, "remainingPids": [],
                                              "evaluationsCharged": 0, "backend": "cpu"}
                        if on_result:
                            on_result(job, results[job["id"]])
                    break
                sample = resources()
                groups = [process_group(slot["process"].pid) for slot in self.slots]
                coordinator = own_rss()
                rss = coordinator + sum(group["rssBytes"] for group in groups)
                self.peak_rss = max(self.peak_rss, rss)
                for slot, group in zip(self.slots, groups):
                    slot["peak"] = max(slot["peak"], group["rssBytes"])
                    self.worker_bytes = max(self.worker_bytes, int(group["rssBytes"] * 1.25))
                pressure = sample["headroomBytes"] < 64 * MIB or (self.max_rss_bytes and rss >= self.max_rss_bytes)
                if pressure and self.slots:
                    # 暂停不会释放内存，先退出空闲执行器，再释放一个在途任务；其他任务保留。
                    slot = max(self.slots, key=lambda item: (item["job"] is None, item["peak"]))
                    finish(slot, "memory-pressure")
                    self.remove(slot)
                    self.publish("paused-memory", resource=sample)
                    time.sleep(.2)
                    continue
                ratio = self.monitor.sample()
                # 留有调度余量；低于阈值后恢复。单核/分数核也通过此反馈节流。
                self.throttle(ratio >= .78)
                if waiting and not pressure and self.paused_at is None:
                    count = admission_slots(sample, groups, self.worker_bytes, self.maximum,
                                            self.max_rss_bytes, coordinator)
                    idle = sum(slot["job"] is None for slot in self.slots)
                    if count > 0 and len(waiting) > idle:
                        self.launch()
                    for slot in self.slots:
                        if waiting and slot["ready"] and slot["job"] is None:
                            job = waiting.popleft()
                            slot.update(job=job, started=time.monotonic(), startedAt=time.time(), peak=0)
                            self.publish("running")
                            data = (json.dumps({key: job[key] for key in ("id", "planPath", "reportPath", "options")}) + "\n").encode()
                            try:
                                slot["process"].stdin.write(data)
                                slot["process"].stdin.flush()
                            except (OSError, BrokenPipeError) as error:
                                finish(slot, "worker-exit", str(error))
                                self.remove(slot)
                for key, _ in self.selector.select(.2):
                    slot = key.data
                    if slot not in self.slots:
                        continue
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        finish(slot, "worker-exit", "执行器提前关闭输出")
                        if not slot["ready"]:
                            consecutive_start_failures += 1
                        self.remove(slot)
                        continue
                    slot["buffer"] += chunk
                    if len(slot["buffer"]) > MIB:
                        raise RuntimeError("训练执行器消息超过上限")
                    while b"\n" in slot["buffer"]:
                        line, slot["buffer"] = slot["buffer"].split(b"\n", 1)
                        message = json.loads(line)
                        if message.get("type") == "ready" and not slot["ready"] and message.get("protocol") == 1:
                            slot["ready"] = True
                            consecutive_start_failures = 0
                        elif slot["job"] and message.get("id") == slot["job"]["id"]:
                            finish(slot, None if message.get("type") == "completed" else "worker-failure", message.get("message"))
                        else:
                            raise RuntimeError("训练执行器返回过期或无效消息")
                for slot in list(self.slots):
                    job = slot["job"]
                    timeout = (now - slot["started"] > job["options"]["candidateSeconds"] + job["options"]["verificationSeconds"] + 30) if job else False
                    startup_timeout = not slot["ready"] and now - slot["launched"] > 90
                    if timeout or startup_timeout or slot["process"].poll() is not None:
                        finish(slot, "watchdog-timeout" if timeout else "worker-exit")
                        if startup_timeout or not slot["ready"]:
                            consecutive_start_failures += 1
                        self.remove(slot)
                if consecutive_start_failures >= 3:
                    raise RuntimeError("训练执行器连续三次启动失败，详见 workers 日志")
                if now - self.last_report >= 2:
                    self.publish("running" if any(slot["job"] for slot in self.slots) else "paused-resources",
                                 resource=sample, cpuUtilization=ratio, queuedRuns=len(waiting))
            self.throttle(False)
            return [results[job["id"]] for job in jobs]
        except BaseException:
            try:
                for slot in list(self.slots):
                    finish(slot, "supervisor-failure")
            finally:
                # 报告写入失败也必须清理所有执行器，不能被再次写报告的异常打断。
                self.close()
            raise


def recover_owned_processes(state):
    """独占锁取得后，只清理持有上次随机令牌的遗留候选，避免 PID 复用误杀。"""
    tokens = [entry["token"] for entry in state.get("workers", [])]
    if state.get("runToken"):
        tokens.append(state["runToken"])
    for token in tokens:
        recover_token(token)
    state.update(childPid=None, runToken=None, activeTrial=None, workers=[])


def recover_token(token):
    expected = f"EDA_TRAINING_RUN_TOKEN={token}".encode()
    groups = set()
    for path in Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        try:
            # 令牌只存在于当前训练创建的 Node/构建辅助进程；不输出任何环境变量。
            if expected not in (path / "environ").read_bytes().split(b"\0"):
                continue
            fields = (path / "stat").read_text().rpartition(")")[2].split()
            if fields[0] != "Z":
                groups.add(int(fields[2]))
        except (OSError, ValueError, IndexError):
            continue
    for group in groups:
        for member in process_group(group)["pids"]:
            try:
                owned = expected in Path(f"/proc/{member}/environ").read_bytes().split(b"\0")
            except FileNotFoundError:
                continue
            if not owned:
                raise RuntimeError("遗留进程组归属不完整，拒绝终止或并发启动。")
        for sig in (signal.SIGCONT, signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(group, sig)
            except ProcessLookupError:
                break
            time.sleep(.5)
        if process_group(group)["pids"]:
            raise RuntimeError("遗留候选仍在运行，拒绝启动新候选。")
