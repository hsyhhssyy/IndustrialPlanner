# 性能分析流程

定位性能下降原因时，不能只观察代码，必须使用 Sim-Perf 日志中的时间统计建立证据链。未经用户许可不得修改业务代码进行性能优化；定位阶段只允许增加性能埋点。

先核对结果列表和每轮日志中的引擎标记。不同引擎及引擎未知的历史结果不能直接用于判断性能退化；`+WT` 也不能用于识别引擎。

脚本会在终端打印 `📂 运行日志:`，详细日志位于：

```text
.temp/sim-perf/runs/<RunID>/run-N.console.log
```

日志包括：

- `[log]`：启动编译耗时、每 600 tick 累计 sync/report 耗时、最终总耗时分解。
- Legacy 的 `[debug]`：每 180 tick 的 `[SimWorkerPerf]` 报告，包括七阶段耗时 `stages`、求解图细分 `stage3` 和热路径计数 `hotPath`。以下筛选命令针对该日志，不能据此认定 Dense 也输出相同阶段；分析 Dense 时先检查实际日志。

查看方法：

```bash
grep SimWorkerPerf .temp/sim-perf/runs/<RunID>/run-1.console.log
```

```bash
grep SimWorkerPerf .temp/sim-perf/runs/<RunID>/run-1.console.log | grep -o '"solveTransferGraph":[0-9.]*'
```

`.temp/sim-perf.md` 记录每次运行的 Run ID，可据此回溯对应日志目录。
