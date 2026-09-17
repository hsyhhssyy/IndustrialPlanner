#!/usr/bin/env python3
"""串行、可恢复的 EDA 参数训练。只通过正式 Vitest EDA 入口执行规划。"""
# AI-CORRECTION 2026-09-17: 用户授权资源受限的多核训练；改用常驻执行池，测试共用同一离线运行器。
from __future__ import annotations

import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import shutil
import signal
# AI-REMOVED 2026-09-17:
# Reason: 进程创建由常驻池统一管理。
# Trigger: CPU 多核训练与全进程资源预算。
# Evidence: Supervisor 改为调用 ExecutionPool。
# Replacement: eda_pool.py 的 subprocess 导入。
# Risk: Low。Human Review: Required。
# Original code:
# import subprocess
import time
# AI-REMOVED 2026-09-17:
# Reason: 执行器令牌由常驻池统一管理。
# Trigger: 多执行器各自恢复与清理。
# Evidence: 令牌生成已迁入 ExecutionPool.launch。
# Replacement: eda_pool.py 的 uuid 导入。
# Risk: Low。Human Review: Required。
# Original code:
# import uuid

from eda_resources import MIB, resolve_cpu_policy, resources, process_group
from eda_pool import ExecutionPool, recover_owned_processes

# 仅控制本进程及新建子进程，避免数值库启动后台线程争抢机器资源。
for variable in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[variable] = "1"
import optuna

ROOT = Path(__file__).resolve().parents[2]
DEFAULTS = json.loads((ROOT / "src/blueprint-planner/default-search-profile.json").read_text())
CASES = {"nugget": ("pyrrolite-nugget.json", 25, 30), "ore": ("pyrrolite-ore.json", 30, 30)}
STOP = False


def atomic_json(path: Path, value):
    temporary = path.with_suffix(path.suffix + ".pending")
    with temporary.open("w") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def read_json(path: Path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


# AI-REMOVED 2026-09-17:
# Reason: 串行候选与单一子进程状态无法支持统一资源受限的并发。
# Trigger: 用户确认 CPU 多核训练，CPU 和内存保留 20%。
# Evidence: 原 Supervisor 每个候选启动 Vitest，且只追踪一个 PID。
# Replacement: eda_resources.py、eda_pool.py
# Risk: 调度、取消和恢复语义需真实进程回归。
# Human Review: Required
#
# Original code:
# def resources():
#     info = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
#     available = int(info["MemAvailable"].split()[0]) * 1024
#     limit_text = Path("/sys/fs/cgroup/memory.max").read_text().strip()
#     limit = int(limit_text) if limit_text != "max" else int(info["MemTotal"].split()[0]) * 1024
#     used = int(Path("/sys/fs/cgroup/memory.current").read_text())
#     return {"availableBytes": available, "cgroupLimitBytes": limit, "cgroupUsedBytes": used}
# 
# 
# def group_rss(group: int):
#     total = 0
#     members = []
#     for path in Path("/proc").iterdir():
#         if not path.name.isdigit():
#             continue
#         try:
#             fields = (path / "stat").read_text().rpartition(")")[2].split()
#             if int(fields[2]) != group or fields[0] == "Z":
#                 continue
#             total += int((path / "statm").read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE")
#             members.append(int(path.name))
#         except (OSError, ValueError, IndexError):
#             continue
#     return total, members
# 
# 
# def terminate_group(process):
#     # start_new_session 为当前候选建立独立进程组；即使父进程先退出仍清理其子进程。
#     for sig in (signal.SIGTERM, signal.SIGKILL):
#         try:
#             os.killpg(process.pid, sig)
#         except ProcessLookupError:
#             break
#         try:
#             process.wait(timeout=3)
#         except subprocess.TimeoutExpired:
#             pass
#         if not group_rss(process.pid)[1]:
#             break
#     process.wait()
#     return group_rss(process.pid)[1]
# 
# 

def group_rss(group):
    sample = process_group(group)
    return sample["rssBytes"], sample["pids"]


# AI-REMOVED 2026-09-17:
# Reason: 串行候选与单一子进程状态无法支持统一资源受限的并发。
# Trigger: 用户确认 CPU 多核训练，CPU 和内存保留 20%。
# Evidence: 原 Supervisor 每个候选启动 Vitest，且只追踪一个 PID。
# Replacement: healthy：宿主和容器均保留 20%
# Risk: 调度、取消和恢复语义需真实进程回归。
# Human Review: Required
#
# Original code:
# def healthy(sample):
#     gib = 1024 ** 3
#     return sample["availableBytes"] >= 1.25 * gib and sample["cgroupUsedBytes"] <= min(
#         .80 * sample["cgroupLimitBytes"], sample["cgroupLimitBytes"] - gib)

def healthy(sample):
    return sample["headroomBytes"] >= 64 * MIB


def suggest(trial):
    return dict(initialTemperature=trial.suggest_float("initialTemperature", 3, 80, log=True),
                coolingRatio=trial.suggest_float("coolingRatio", .01, .3, log=True),
                congestionWeight=trial.suggest_float("congestionWeight", .2, 8, log=True),
                areaWeight=trial.suggest_float("areaWeight", .04, 1.5, log=True),
                overflowWeight=trial.suggest_float("overflowWeight", 15, 150, log=True),
                portAlignmentProbability=trial.suggest_float("portAlignmentProbability", .12, .44),
                compactionProbability=trial.suggest_float("compactionProbability", 0, .3),
                routeFeedbackWeight=trial.suggest_float("routeFeedbackWeight", .5, 6, log=True),
                initialClearance=trial.suggest_int("initialClearance", 0, 1),
                separateOperatingSupply=trial.suggest_int("separateOperatingSupply", 0, 1),
                fluidGroupSize=trial.suggest_categorical("fluidGroupSize", [1, 2, 3, 4, 64]))


def objective(record, target_area):
    """失败的固定引导项不参与蓝图验收；合法解始终优于非法解。"""
    if record["outcome"] == "success":
        secondary = record.get("search", {}).get("quality", {}).get("secondary", 0)
        return record["area"] + .5 + math.atan(secondary / 100) / math.pi
    conflicts = record.get("search", {}).get("remainingConflicts", {})
    violation = sum(conflicts.get(key, 0) for key in ("geometry", "boundary", "connections", "power"))
    if record["outcome"] == "verification-failed":
        return 1_000_000 + sum(max(0, 30 - probe["perMinute"]) for probe in record.get("measuredOutputs", []))
    # 完整布线优于几何失败；缺少搜索统计的异常不能获得便宜高分。
    search = record.get("search", {})
    unrouted = 1 - search.get("bestRoutedWireCount", 0) / max(1, search.get("wireCount", 1))
    return 2_000_000 + (violation * 1000 if conflicts else target_area * 10000) + unrouted * 1000


def accepted(record, width, height):
    actual_width, actual_height = record.get("width", math.inf), record.get("height", math.inf)
    fits = (actual_width <= width and actual_height <= height) or (actual_width <= height and actual_height <= width)
    return record.get("outcome") == "success" and fits and record.get("search", {}).get("evaluations", math.inf) <= 50_000 \
        and record.get("search", {}).get("quality", {}).get("utilization", 0) > .5 \
        and all(probe["perMinute"] >= 30 for probe in record.get("measuredOutputs", [])) \
        and bool(record.get("measuredOutputs")) \
        and record.get("constraints") is not None \
        and not record["constraints"]["placementErrors"] and not record["constraints"]["excessiveOperatingInputs"]


# AI-REMOVED 2026-09-17:
# Reason: 串行候选与单一子进程状态无法支持统一资源受限的并发。
# Trigger: 用户确认 CPU 多核训练，CPU 和内存保留 20%。
# Evidence: 原 Supervisor 每个候选启动 Vitest，且只追踪一个 PID。
# Replacement: Supervisor.run_many + ExecutionPool
# Risk: 调度、取消和恢复语义需真实进程回归。
# Human Review: Required
#
# Original code:
# class Supervisor:
#     def __init__(self, directory, args, state):
#         self.directory, self.args, self.state = directory, args, state
#         self.started = time.monotonic()
#         self.previous = state.get("sessionSeconds", 0)
#         if args.mode == "train":
#             self.state["requestedTrainingSeconds"] = args.hours * 3600
#         self.deadline = self.started + max(0, args.hours * 3600 - self.previous)
#         self.active = None
#         self.last_checkpoint = 0
# 
#     def checkpoint(self, phase, **extra):
#         self.state.update(extra, phase=phase, pid=os.getpid(), updatedAt=time.time(),
#                           sessionSeconds=self.previous + (time.monotonic() - self.started if self.args.mode == "train" else 0))
#         atomic_json(self.directory / "state.json", self.state)
#         self.last_checkpoint = time.monotonic()
# 
#     def run(self, case, profile, seed, evaluations, identifier, training=True):
#         filename, width, height = CASES[case]
#         trial_dir = self.directory / "trials" / identifier
#         trial_dir.mkdir(parents=True, exist_ok=False)
#         request = dict(engineKind="dense-v2", attempts=1, localEvaluations=evaluations,
#                        width=width, height=height, startVariant=seed, candidateSeconds=self.args.candidate_seconds,
#                        verificationSeconds=120, profile=profile)
#         atomic_json(trial_dir / "request.json", dict(case=case, seed=seed, options=request))
#         environment = dict(os.environ, EDA_PLAN=str(ROOT / "src/tests/blueprint-planner/fixtures" / filename),
#                            EDA_RUN_OPTIONS=json.dumps(request), EDA_REPORT_PATH=str(trial_dir / "result.json"),
#                            NODE_OPTIONS="--max-old-space-size=512", UV_THREADPOOL_SIZE="1", GOMAXPROCS="1")
#         before = time.monotonic()
#         peak = 0
#         stopped = None
#         token = uuid.uuid4().hex
#         environment["EDA_TRAINING_RUN_TOKEN"] = token
#         self.checkpoint("launching", activeTrial=identifier, runToken=token, childPid=None)
#         with (trial_dir / "process.log").open("w") as log:
#             process = subprocess.Popen(["node", "node_modules/vitest/vitest.mjs", "run",
#                                         "--configLoader", "runner", "--project", "eda"],
#                                        cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT,
#                                        start_new_session=True)
#             self.active = process
#             self.checkpoint("training" if training else "validating", activeTrial=identifier, childPid=process.pid)
#             try:
#                 while process.poll() is None:
#                     sample = resources()
#                     rss, _ = group_rss(process.pid)
#                     peak = max(peak, rss)
#                     if STOP:
#                         stopped = "signal"
#                     elif training and time.monotonic() >= self.deadline:
#                         stopped = "session-deadline"
#                     elif time.monotonic() - before > self.args.candidate_seconds + 150:
#                         stopped = "watchdog-timeout"
#                     elif rss > self.args.max_rss_mib * 1024 ** 2 or not healthy(sample):
#                         stopped = "memory-pressure"
#                     if stopped:
#                         break
#                     if time.monotonic() - self.last_checkpoint >= 5:
#                         self.checkpoint("training" if training else "validating", resource=sample, peakRssBytes=peak)
#                     time.sleep(.5)
#             finally:
#                 remaining = terminate_group(process)
#                 self.active = None
#         result = read_json(trial_dir / "result.json")
#         record = result["records"][0] if result and result.get("records") else None
#         outcome = dict(identifier=identifier, case=case, seed=seed, evaluations=evaluations,
#                        exitCode=process.returncode, stopped=stopped, elapsedSeconds=time.monotonic() - before,
#                        peakRssBytes=peak, remainingPids=remaining, record=record,
#                        accepted=accepted(record, width, height) if record and process.returncode == 0 and not stopped else False)
#         atomic_json(trial_dir / "supervisor.json", outcome)
#         self.state["peakRssBytes"] = max(self.state.get("peakRssBytes", 0), peak)
#         self.state["completedRuns"] = self.state.get("completedRuns", 0) + 1
#         duration_key = "candidateSeconds" if training else "validationCandidateSeconds"
#         self.state[duration_key] = self.state.get(duration_key, 0) + outcome["elapsedSeconds"]
#         self.checkpoint("idle", childPid=None, activeTrial=None, runToken=None)
#         print(json.dumps({key: outcome[key] for key in ("identifier", "case", "elapsedSeconds", "peakRssBytes", "stopped", "accepted")}), flush=True)
#         if remaining:
#             raise RuntimeError(f"候选进程组未清理：{remaining}")
#         return outcome
# 
# 

class Supervisor:
    def __init__(self, directory, args, state, policy):
        self.directory, self.args, self.state = directory, args, state
        self.started = time.monotonic()
        self.previous = state.get("sessionSeconds", 0)
        if args.mode == "train":
            self.state["requestedTrainingSeconds"] = args.hours * 3600
        self.deadline = self.started + max(0, args.hours * 3600 - self.previous)
        self.pool = ExecutionPool(ROOT, directory, policy, args.workers, args.max_rss_mib * MIB,
                                  self.checkpoint, lambda: STOP)

    def checkpoint(self, phase, **extra):
        self.state.update(extra, phase=phase, pid=os.getpid(), updatedAt=time.time(),
                          sessionSeconds=self.previous + (time.monotonic() - self.started if self.args.mode == "train" else 0))
        atomic_json(self.directory / "state.json", self.state)

    def run_many(self, specifications, training=True):
        jobs = []
        for case, profile, seed, evaluations, identifier in specifications:
            filename, width, height = CASES[case]
            trial_dir = self.directory / "trials" / identifier
            trial_dir.mkdir(parents=True, exist_ok=False)
            request = dict(engineKind="dense-v2", attempts=1, localEvaluations=evaluations,
                           width=width, height=height, startVariant=seed, candidateSeconds=self.args.candidate_seconds,
                           verificationSeconds=120, profile=profile)
            atomic_json(trial_dir / "request.json", dict(case=case, seed=seed, options=request))
            jobs.append(dict(id=identifier, planPath=str(ROOT / "src/tests/blueprint-planner/fixtures" / filename),
                             reportPath=str(trial_dir / "result.json"), options=request))
        def retain_result(job, result):
            atomic_json(Path(job["reportPath"]).with_name("execution.json"), result)
        results = self.pool.run(jobs, self.deadline if training else None, retain_result)
        outcomes = []
        for specification, result in zip(specifications, results):
            case, _profile, seed, evaluations, identifier = specification
            _, width, height = CASES[case]
            record = result["record"]
            outcome = dict(result, identifier=identifier, case=case, seed=seed, evaluations=evaluations,
                           accepted=accepted(record, width, height) if record and not result["stopped"] else False)
            atomic_json(self.directory / "trials" / identifier / "supervisor.json", outcome)
            self.state["completedRuns"] = self.state.get("completedRuns", 0) + 1
            duration_key = "candidateSeconds" if training else "validationCandidateSeconds"
            self.state[duration_key] = self.state.get(duration_key, 0) + outcome["elapsedSeconds"]
            print(json.dumps({key: outcome[key] for key in ("identifier", "case", "elapsedSeconds", "peakRssBytes", "stopped", "accepted")}), flush=True)
            outcomes.append(outcome)
        self.state["peakRssBytes"] = max(self.state.get("peakRssBytes", 0), self.pool.peak_rss)
        self.checkpoint("idle", **self.pool.state())
        return outcomes

    def run(self, case, profile, seed, evaluations, identifier, training=True):
        return self.run_many([(case, profile, seed, evaluations, identifier)], training=training)[0]



def stop_requested(_signal, _frame):
    global STOP
    STOP = True


def main():
    parser = argparse.ArgumentParser(description="多核、可恢复的 EDA 参数训练；通过常驻执行器运行真实规划与 Dense 验证。")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--hours", type=float, default=3)
    parser.add_argument("--mode", choices=("train", "validate"), default="train")
    parser.add_argument("--max-trials", type=int)
    parser.add_argument("--screen-evaluations", type=int, default=6000)
    parser.add_argument("--candidate-seconds", type=float, default=240)
    parser.add_argument("--max-rss-mib", type=int, default=0, help="全部训练进程的额外 RSS 上限；0 表示仅按 20%% 余量自动分配")
    parser.add_argument("--workers", type=int, default=0, help="并发执行器上限；0 按 CPU 与内存余量自动决定")
    parser.add_argument("--seed", type=int, default=20260916)
    args = parser.parse_args()
    if args.hours <= 0 or not math.isfinite(args.hours) or not 1 <= args.screen_evaluations <= 50000 \
            or (args.max_trials is not None and args.max_trials < 1) \
            or (args.max_rss_mib != 0 and args.max_rss_mib < 256) or args.workers < 0 or not 1 <= args.candidate_seconds <= 600:
        parser.error("预算无效；非零内存上限至少 256 MiB，单次搜索不得超过 50000。")
    directory = Path(args.directory).resolve()
    if not directory.is_relative_to(ROOT / ".temp/eda/training"):
        parser.error("训练产物必须保存在项目的 .temp/eda/training 下。")
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "supervisor.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("已有调度器持有同一训练目录，拒绝重复启动。")
        policy = resolve_cpu_policy()
        os.sched_setaffinity(0, policy["affinity"])
        os.nice(10)
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, stop_requested)
        previous = read_json(directory / "manifest.json")
        identity = dict(cases=CASES, seed=args.seed, screenEvaluations=args.screen_evaluations,
                        optunaVersion=optuna.__version__, policyVersion=3, workers=args.workers, cpuPolicy=policy,
                        candidateSeconds=args.candidate_seconds, maxRssMiB=args.max_rss_mib)
        identity = json.loads(json.dumps(identity))
        if previous and previous["identity"] != identity:
            raise RuntimeError("训练协议或运行参数已变化；请新建训练目录，禁止混合不可比的实验。")
        if not previous:
            atomic_json(directory / "manifest.json", dict(identity=identity, createdAt=time.time(), resource=resources(),
                        affinity=sorted(os.sched_getaffinity(0)), nodeHeapMiB=512, workerHeapMiB=384,
                        maxRssMiB=args.max_rss_mib, trainSeeds=[0, 1], heldoutSeeds=[100003, 200003]))
        if args.mode == "train" and (directory / "validation-selection.json").exists():
            raise RuntimeError("此实验已冻结并开始独立验收；继续调参须建立新实验，不能混用已查看的留出结果。")
        state = read_json(directory / "state.json", {})
        recover_owned_processes(state)
        supervisor = Supervisor(directory, args, state, policy)
        storage = f"sqlite:///{directory / 'study.sqlite3'}"
        studies = {case: optuna.create_study(study_name=case, storage=storage, direction="minimize", load_if_exists=True)
                   for case in CASES}
        for study in studies.values():
            # 独占锁证明旧调度器已退出；未完成的候选不当成合法低成本样本。
            for trial in study.get_trials(states=(optuna.trial.TrialState.RUNNING,)):
                study.tell(trial.number, state=optuna.trial.TrialState.FAIL)
            if not study.trials:
                study.enqueue_trial(DEFAULTS)
        try:
            if args.mode == "validate":
                validate(supervisor, studies)
                return
            count = sum(len(study.get_trials(states=(optuna.trial.TrialState.COMPLETE, optuna.trial.TrialState.FAIL, optuna.trial.TrialState.PRUNED)))
                        for study in studies.values())
# AI-REMOVED 2026-09-17:
# Reason: 串行候选与单一子进程状态无法支持统一资源受限的并发。
# Trigger: 用户确认 CPU 多核训练，CPU 和内存保留 20%。
# Evidence: 原 Supervisor 每个候选启动 Vitest，且只追踪一个 PID。
# Replacement: 有界批次提出配置，ExecutionPool 多进程计算，单协调者按固定次序写入
# Risk: 调度、取消和恢复语义需真实进程回归。
# Human Review: Required
#
# Original code:
#             while time.monotonic() < supervisor.deadline and not STOP and (args.max_trials is None or count < args.max_trials):
#                 sample = resources()
#                 if not healthy(sample):
#                     supervisor.checkpoint("paused-memory", resource=sample)
#                     pause_started = time.monotonic()
#                     time.sleep(5)
#                     supervisor.state["pausedSeconds"] = supervisor.state.get("pausedSeconds", 0) + time.monotonic() - pause_started
#                     continue
#                 if shutil.disk_usage(directory).free < 1024 ** 3:
#                     supervisor.checkpoint("paused-disk")
#                     pause_started = time.monotonic()
#                     time.sleep(5)
#                     supervisor.state["pausedSeconds"] = supervisor.state.get("pausedSeconds", 0) + time.monotonic() - pause_started
#                     continue
#                 case = list(CASES)[count % len(CASES)]
#                 random_baseline = count % 5 == 4
#                 sampler_seed = args.seed + count
#                 sampler = optuna.samplers.RandomSampler(seed=sampler_seed) if random_baseline else optuna.samplers.TPESampler(seed=sampler_seed, n_startup_trials=8)
#                 study = optuna.load_study(study_name=case, storage=storage, sampler=sampler)
#                 trial = study.ask()
#                 profile = suggest(trial)
#                 full = trial.number % 4 == 3
#                 evaluations = 50000 if full else args.screen_evaluations
#                 trial.set_user_attr("sampler", "random-baseline" if random_baseline else "tpe")
#                 trial.set_user_attr("evaluationsPerRun", evaluations)
#                 values = []
#                 infra_failure = False
#                 for seed in (0, 1):
#                     identifier = f"{case}-{trial.number:05d}-seed{seed}"
#                     outcome = supervisor.run(case, profile, seed, evaluations, identifier)
#                     if not outcome["record"] or outcome["stopped"] or outcome["exitCode"] != 0:
#                         infra_failure = True
#                         break
#                     values.append(objective(outcome["record"], CASES[case][1] * CASES[case][2]))
#                 trial.set_user_attr("pairedValues", values)
#                 if infra_failure:
#                     study.tell(trial, state=optuna.trial.TrialState.FAIL)
#                 else:
#                     study.tell(trial, sum(values) / len(values))
#                 count += 1
#                 supervisor.state["trials"] = count
#                 completed = study.get_trials(states=(optuna.trial.TrialState.COMPLETE,))
#                 if completed:
#                     best = study.best_trial
#                     atomic_json(directory / f"best-{case}.json", dict(profile=best.params, trial=best.number,
#                                 objective=best.value, status="unvalidated-training-selection"))
#                 supervisor.checkpoint("idle")

            while time.monotonic() < supervisor.deadline and not STOP and (args.max_trials is None or count < args.max_trials):
                if shutil.disk_usage(directory).free < 1024 ** 3:
                    supervisor.checkpoint("paused-disk")
                    time.sleep(1)
                    continue
                # 固定宽度的小批次按 trial 顺序 ask/tell，计算完成顺序不影响下一批选参。
                width = max(1, math.ceil(supervisor.pool.maximum / 2))
                if args.max_trials is not None:
                    width = min(width, args.max_trials - count)
                trials, specifications = [], []
                for offset in range(width):
                    number = count + offset
                    case = list(CASES)[number % len(CASES)]
                    random_baseline = number % 5 == 4
                    sampler_seed = args.seed + number
                    sampler = optuna.samplers.RandomSampler(seed=sampler_seed) if random_baseline else optuna.samplers.TPESampler(
                        seed=sampler_seed, n_startup_trials=8, constant_liar=True)
                    study = optuna.load_study(study_name=case, storage=storage, sampler=sampler)
                    trial = study.ask()
                    profile = suggest(trial)
                    evaluations = 50000 if trial.number % 4 == 3 else args.screen_evaluations
                    trial.set_user_attr("sampler", "random-baseline" if random_baseline else "tpe")
                    trial.set_user_attr("evaluationsPerRun", evaluations)
                    trials.append((case, study, trial))
                    for seed in (0, 1):
                        specifications.append((case, profile, seed, evaluations, f"{case}-{trial.number:05d}-seed{seed}"))
                outcomes = supervisor.run_many(specifications)
                for index, (case, study, trial) in enumerate(trials):
                    paired = outcomes[index * 2:index * 2 + 2]
                    values = [objective(outcome["record"], CASES[case][1] * CASES[case][2]) for outcome in paired
                              if outcome["record"] and not outcome["stopped"] and outcome["exitCode"] == 0]
                    trial.set_user_attr("pairedValues", values)
                    if len(values) != 2:
                        study.tell(trial, state=optuna.trial.TrialState.FAIL)
                    else:
                        study.tell(trial, sum(values) / len(values))
                    count += 1
                    supervisor.state["trials"] = count
                    if study.get_trials(states=(optuna.trial.TrialState.COMPLETE,)):
                        best = study.best_trial
                        atomic_json(directory / f"best-{case}.json", dict(profile=best.params, trial=best.number,
                                    objective=best.value, status="unvalidated-training-selection"))
                supervisor.checkpoint("idle", **supervisor.pool.state())
            duration_reached = time.monotonic() >= supervisor.deadline
            supervisor.checkpoint("interrupted" if STOP else "training-finished" if duration_reached else "paused-trial-limit",
                                  stopReason="signal" if STOP else "duration" if duration_reached else "trial-limit")
        except BaseException as error:
            supervisor.checkpoint("failed", error=str(error))
            raise
        finally:
            final_phase = state.get("phase", "failed")
            try:
                supervisor.pool.close()
            except Exception as error:
                final_phase = "cleanup-failed"
                state["error"] = str(error)
                raise
            finally:
                supervisor.checkpoint(final_phase, **supervisor.pool.state())



def validation_summary(selection, outcomes):
    """按冻结任务去重；中断重试保留证据，但不冒充完成的独立验收。"""
    expected = {(case, selected["label"], seed) for case, profiles in selection.items()
                for selected in profiles for seed in (0, 100003, 200003)}
    completed = {}
    for item in outcomes:
        key = (item["case"], item.get("profileLabel"), item["seed"])
        if key in expected and not item.get("stopped") and item.get("record") and item.get("exitCode") == 0:
            completed[key] = item
    summary = {}
    for case, profiles in selection.items():
        records = [item for key, item in completed.items() if key[0] == case]
        attempts = [item for item in outcomes if item["case"] == case]
        summary[case] = dict(attempts=len(attempts), runs=len(records),
            interrupted=sum(bool(item.get("stopped")) or item.get("exitCode") != 0 or not item.get("record") for item in attempts),
            accepted=sum(item["accepted"] for item in records),
            heldoutAccepted=sum(item["accepted"] and item["seed"] != 0 for item in records),
            stableProfiles=[selected["label"] for selected in profiles
                            if all(completed.get((case, selected["label"], seed), {}).get("accepted", False)
                                   for seed in (0, 100003, 200003))])
    full_selection = set(selection) == set(CASES) and all(selection.values())
    return dict(status="completed" if full_selection and expected and len(completed) == len(expected) else "incomplete",
                expectedRuns=len(expected), completedRuns=len(completed), summary=summary, outcomes=outcomes,
                bothTargetsReached=full_selection and all(result["accepted"] > 0 for result in summary.values()),
                bothHeldoutTargetsReached=full_selection and all(result["heldoutAccepted"] > 0 for result in summary.values()),
                bothTargetsStable=full_selection and all(bool(result["stableProfiles"]) for result in summary.values()))


def validate(supervisor, studies):
    selection_path = supervisor.directory / "validation-selection.json"
    selection = read_json(selection_path)
    if selection is None:
        selection = {}
        for case, study in studies.items():
            completed = study.get_trials(states=(optuna.trial.TrialState.COMPLETE,))
            selected = sorted(completed, key=lambda trial: trial.value)[:3]
            selection[case] = [dict(label=f"trial{trial.number}", profile=trial.params) for trial in selected] \
                or [dict(label="default", profile=DEFAULTS)]
        atomic_json(selection_path, selection)
    previous = read_json(supervisor.directory / "acceptance.json", {})
    outcomes = previous.get("outcomes", [])
    # 冻结选择后再测试未知种子；每次都由原规划重新生成，禁止从训练蓝图起步。
    for case, profiles in selection.items():
        for selected in profiles:
            label, profile = selected["label"], selected["profile"]
            for seed in (0, 100003, 200003):
                if any(item["case"] == case and item.get("profileLabel") == label and item["seed"] == seed
                       and not item.get("stopped") and item.get("record") and item.get("exitCode") == 0 for item in outcomes):
                    continue
                if STOP:
                    atomic_json(supervisor.directory / "acceptance.json", validation_summary(selection, outcomes))
                    supervisor.checkpoint("interrupted-validation")
                    return
                while not healthy(resources()) and not STOP:
                    supervisor.checkpoint("paused-memory-validation")
                    time.sleep(5)
                if STOP:
                    atomic_json(supervisor.directory / "acceptance.json", validation_summary(selection, outcomes))
                    supervisor.checkpoint("interrupted-validation")
                    return
                identifier = f"validation-{case}-{label}-seed{seed}-{time.time_ns()}"
                outcome = supervisor.run(case, profile, seed, 50000, identifier, training=False)
                outcome["profileLabel"] = label
                outcomes.append(outcome)
                atomic_json(supervisor.directory / "acceptance.json", validation_summary(selection, outcomes))
    # AI-REMOVED 2026-09-16:
    # Reason: 中断重试不能计作独立完成，末项中断不能把整体验收标记完成。
    # Trigger: 无人值守恢复与验收冻结验证。
    # Evidence: supervisor-final-smoke-20260916 两次中断产生同一任务的两个未完成结果。
    # Replacement: validation_summary 按冻结任务去重，分别汇报尝试、完成与中止。
    # Risk: 报告消费者应按新字段区分统计口径。Human Review: Required。
    # Original code:
    # summary = {case: dict(runs=sum(item["case"] == case for item in outcomes),
    #                       accepted=sum(item["case"] == case and item["accepted"] for item in outcomes),
    #                       heldoutAccepted=sum(item["case"] == case and item["accepted"] and item["seed"] != 0 for item in outcomes),
    #                       stableProfiles=[selected["label"] for selected in selection[case]
    #                                       if all(any(item["case"] == case and item.get("profileLabel") == selected["label"]
    #                                                  and item["seed"] == seed and item["accepted"] for item in outcomes)
    #                                              for seed in (0, 100003, 200003))]) for case in CASES}
    # atomic_json(supervisor.directory / "acceptance.json", dict(status="completed", summary=summary, outcomes=outcomes,
    #              bothTargetsReached=all(result["accepted"] > 0 for result in summary.values()),
    #              bothHeldoutTargetsReached=all(result["heldoutAccepted"] > 0 for result in summary.values()),
    #              bothTargetsStable=all(bool(result["stableProfiles"]) for result in summary.values())))
    # supervisor.checkpoint("validation-finished")
    result = validation_summary(selection, outcomes)
    atomic_json(supervisor.directory / "acceptance.json", result)
    supervisor.checkpoint("validation-finished" if result["status"] == "completed" else "validation-incomplete")


if __name__ == "__main__":
    main()
