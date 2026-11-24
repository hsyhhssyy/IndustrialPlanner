# 性能分析流程

定位性能下降原因时，不能只观察代码或总耗时，必须先用同一场景、同一引擎、同一 affinity、同一 GPU 状态的可比结果建立证据链。未经用户许可不得修改业务代码进行性能优化；定位阶段只允许增加性能埋点。

## 先核对可比条件

- suite、场景 id、引擎、`affinity`、GPU 状态必须一致。
- EDA 还必须核对 `localEvaluations`、`attempts`、`candidateSeconds`、`verificationSeconds`、`concurrency`。
- 不同机器、不同亲和性、不同 GPU、不同尝试次数的结果不能直接比较。
- `+WT` 只能用于开发定位，不能当作正式基线。

## 日志与结果位置

统一入口的结果在：

```text
.temp/perf/runs/<RunID>/
  summary.json
  samples/sample-N.json
  sample-N.console.log
```

仿真另有执行器 tee 日志 `sample-N.sim-console.log`。EDA 的 `sample-N.json` 中包含每个 attempt 的 `evaluations`、`outcome`、`generationMs`、`verificationMs` 和面积，可直接用于定位。

## 仿真日志

- `[log]`：启动编译耗时、每 600 tick 累计 sync/report 耗时、最终总耗时分解。
- Legacy 的 `[debug]`：每 180 tick 的 `[SimWorkerPerf]` 报告，包括七阶段耗时 `stages`、求解图细分 `stage3` 和热路径计数 `hotPath`。以下命令只适用于实际输出该日志的引擎；分析 Dense 时先检查日志内容，不能假设 Dense 也输出相同阶段。

```bash
grep SimWorkerPerf .temp/perf/runs/<RunID>/sample-1.sim-console.log
```

```bash
grep SimWorkerPerf .temp/perf/runs/<RunID>/sample-1.sim-console.log | grep -o '"solveTransferGraph":[0-9.]*'
```

## EDA 归因顺序

不要先看总墙钟。按以下顺序拆分：

1. `searchMs`：算法生成与搜索。
2. `verificationMs`：Dense 仿真验收。
3. `schedulerMs`：墙钟中未被搜索或验收覆盖的部分，包含 Worker 调度和页面轮询。
4. `searchEvaluationsPerSecond`：纯搜索吞吐。
5. `evaluationsPerSecond`：总吞吐，分母包含验证，不能单独代表算法速度。

如果 `verificationMs` 显著上升，先查仿真或验收路径，不要直接归因给 EDA 搜索算法。

## 实际提案数与预算

EDA 场景的 `localEvaluations` 是上限，不是必须消耗的量：

- `createPlannerCandidate` 在某个阶段成功后会立即返回，不会为了用满预算继续搜索。
- 后续 attempt 复用已有种子时，可能只消耗 1～6 次提案。
- 比较结果时必须同时看实际 `evaluations` 和 `searchMs`；实际提案数变化可能来自成功路径变化，不一定是速度变化。

## GPU 证据限制

当前 GPU 浏览器场景记录 adapter 信息和 `gpu: true` 请求，不能证明 GPU kernel 实际参与了每次提案。没有专用 GPU 指标导出时，不得把 adapter 存在当作 GPU 加速证明；需要更细的 GPU 参与度时，只能增加只读诊断埋点。
