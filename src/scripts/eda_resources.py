"""EDA 全部子任务共用的 CPU、主存预算；GPU 计算不设置利用率上限。"""
from __future__ import annotations

import math
import os
from pathlib import Path
import time

RESERVE = .20
MIB = 1024 ** 2


def cgroup_paths():
    """同时读取当前 cgroup 和可见祖先，不能只看宿主机逻辑核数。"""
    root = Path("/sys/fs/cgroup")
    member = next((line.split("::", 1)[1] for line in Path("/proc/self/cgroup").read_text().splitlines()
                   if line.startswith("0::")), "/")
    current = root / member.lstrip("/")
    if not (current / "cgroup.controllers").exists():
        current = root
    return [current, *(parent for parent in current.parents if parent == root or root in parent.parents)]


def read_number(path):
    try:
        value = path.read_text().strip()
        return None if value == "max" else int(value)
    except FileNotFoundError:
        return None


def cpu_policy(affinity, quotas=()):
    effective = min([len(affinity), *(quota / period for quota, period in quotas if quota > 0 and period > 0)])
    budget = effective * (1 - RESERVE)
    # 不足一个核时仍可计算，由监督器按实际 CPU 时间节流，不能向上取整成满核。
    selected = sorted(affinity)[:max(1, math.floor(budget))]
    return {"availableCpus": sorted(affinity), "effectiveCpus": effective,
            "cpuBudget": budget, "affinity": selected, "reserveFraction": RESERVE}


def resolve_cpu_policy():
    quotas = []
    for path in cgroup_paths():
        try:
            quota, period = (path / "cpu.max").read_text().split()
            if quota != "max":
                quotas.append((int(quota), int(period)))
        except FileNotFoundError:
            pass
    return cpu_policy(os.sched_getaffinity(0), quotas)


def memory_headroom(host_total, host_available, limits):
    """扣除已有负载，分别在宿主和每个有限容器边界保留 20%。"""
    return max(0, int(min([host_available - host_total * RESERVE,
                          *((1 - RESERVE) * limit - used for limit, used in limits)])))


def resources():
    info = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    total = int(info["MemTotal"].split()[0]) * 1024
    available = int(info["MemAvailable"].split()[0]) * 1024
    limits = []
    for path in cgroup_paths():
        limit, used = read_number(path / "memory.max"), read_number(path / "memory.current")
        if limit is not None and used is not None:
            limits.append((limit, used))
    limit, used = min(limits, key=lambda item: item[0] - item[1]) if limits else (total, total - available)
    return {"hostTotalBytes": total, "availableBytes": available, "cgroupLimitBytes": limit,
            "cgroupUsedBytes": used, "headroomBytes": memory_headroom(total, available, limits),
            "reserveFraction": RESERVE, "enforcement": "affinity-and-supervisor"}


def process_group(group):
    """RSS 包括所有 Worker 和辅助进程；共享页重复统计是保守资源估计。"""
    rss, cpu, members = 0, 0., []
    for path in Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        try:
            fields = (path / "stat").read_text().rpartition(")")[2].split()
            if int(fields[2]) != group or fields[0] == "Z":
                continue
            rss += int((path / "statm").read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE")
            cpu += (int(fields[11]) + int(fields[12])) / os.sysconf("SC_CLK_TCK")
            members.append(int(path.name))
        except (OSError, ValueError, IndexError):
            continue
    return {"rssBytes": rss, "cpuSeconds": cpu, "pids": members}


def own_rss():
    return int(Path("/proc/self/statm").read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE")


def admission_slots(sample, groups, worker_bytes, maximum, max_rss_bytes=0, supervisor_bytes=0):
    """在启动新进程之前预留峰值，已有任务尚未增长到峰值的部分也先扣除。"""
    current = sum(group["rssBytes"] for group in groups)
    reserved = sum(max(0, worker_bytes - group["rssBytes"]) for group in groups)
    headroom = sample["headroomBytes"] - reserved
    if max_rss_bytes:
        headroom = min(headroom, max_rss_bytes - supervisor_bytes - current - reserved)
    return max(0, min(maximum - len(groups), math.floor(headroom / worker_bytes)))


class CpuMonitor:
    def __init__(self, policy):
        self.policy = policy
        self.previous = None

    def sample(self):
        now = time.monotonic()
        cores = set(self.policy["availableCpus"])
        busy, total = 0, 0
        for line in Path("/proc/stat").read_text().splitlines():
            parts = line.split()
            if parts[0].startswith("cpu") and parts[0][3:].isdigit() and int(parts[0][3:]) in cores:
                values = list(map(int, parts[1:9]))
                total += sum(values)
                busy += sum(values) - values[3] - values[4]
        usage = []
        for path in cgroup_paths():
            try:
                fields = dict(line.split() for line in (path / "cpu.stat").read_text().splitlines())
                quota, period = (path / "cpu.max").read_text().split()
                capacity = self.policy["effectiveCpus"] if quota == "max" else min(len(cores), int(quota) / int(period))
                usage.append((str(path), int(fields["usage_usec"]), capacity))
            except FileNotFoundError:
                pass
        previous, self.previous = self.previous, (now, busy, total, usage)
        if previous is None:
            return 0.
        elapsed = now - previous[0]
        ratios = [(busy - previous[1]) / max(1, total - previous[2])]
        old = {path: value for path, value, _ in previous[3]}
        ratios.extend((value - old[path]) / (elapsed * 1_000_000 * capacity)
                      for path, value, capacity in usage if path in old and capacity > 0)
        return max(ratios)
