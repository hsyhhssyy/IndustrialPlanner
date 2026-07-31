---
description: "运行仿真性能基线测试，使用蓝图7核息壤运行到3600tick，重复10次取平均值并记录到 .temp/sim-perf.md"
argument-hint: "[额外说明...]"
agent: "agent"
---

# 请执行仿真性能基线测试。

步骤：

1. 先检查是否有未提交的改动：
   ```bash
   git status --porcelain
   ```
   如果有未提交改动：
   - 若用户明确要求快速验证（如刚改完代码想看效果），使用 `-n 1` 跳过检查
   - 否则通知用户先提交代码再执行测试，并停止。

2. 确认无未提交改动后，运行性能测试脚本：
   ```bash
   npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts
   ```

3. 将脚本输出的结果汇报给用户。


## 快速验证模式（`-n 1`）

如果用户刚调整了代码、尚未提交，想要快速跑一次验证性能变化，可使用 `-n 1`：

```bash
npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts -n 1
```

`-n 1` 特性：
- 只执行 1 次迭代，跳过未提交改动的拦截
- 写入 `sim-perf.md` 时，SHA 列会标注 `+WT`（如 `abc1234+WT`），表示工作区有脏数据
- 日志文件仍然正常写入 `runs/<RunID>/run-1.console.log`


## 后续动作

如果用户后续要求你尝试探查性能下降原因，你不能只通过代码观察的形式来进行，你必须在Sim-Perf日志中进行时间统计，然后根据日志反馈来确定该问题的耗时。
未经用户许可，不可以实际修改代码来调整性能，你只能修改代码进行埋点。

脚本运行后，会在终端输出简洁摘要（耗时、平均耗时）。详细的阶段级性能日志和 Worker 内部统计已写入以下地址：

```
.temp/sim-perf/runs/<RunID>/run-N.console.log
```

终端顶部会打印 `📂 运行日志:` 行，其中包含实际路径。

日志文件内容包括：
- `[log]` 行：启动编译耗时、每 600 tick 累计 sync/report 耗时、最终总耗时分解
- `[debug]` 行：每 180 tick 一次的 `[SimWorkerPerf]` 报告，含 7 阶段耗时（`stages`）、求解图细分（`stage3`）、热路径计数（`hotPath`）

查看方法示例：
```bash
# 查看所有 SimWorkerPerf 报告
grep SimWorkerPerf .temp/sim-perf/runs/<RunID>/run-1.console.log
# 查看某个 stage 的耗时趋势（如 solveTransferGraph）
grep SimWorkerPerf .temp/sim-perf/runs/<RunID>/run-1.console.log | grep -o '"solveTransferGraph":[0-9.]*'
```

同时，`.temp/sim-perf.md` 中记录了每次运行的 Run ID，可通过 Run ID 回溯到对应的详细日志目录。