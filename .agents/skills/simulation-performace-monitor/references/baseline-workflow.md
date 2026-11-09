# 性能基线流程

## 引擎选择与记录

- 每次运行前，检查 `src/app/shell/state/simulation-engine-launch-preference.ts` 的默认启动规则及 `src/main.tsx` 的引擎映射。使用无用户持久化偏好、无调试回退时的默认引擎；当前是 Dense（`dense-v2`）。如果默认值变化，以下命令的 `SIMULATION_TEST_ENGINE` 必须随之变化。
- 复用现有 `SIMULATION_TEST_ENGINE` 显式传入引擎，不沿用终端中已有的变量值，也不依赖测试工具的 Legacy 默认值。脚本会拒绝缺失或无效的引擎，并把同一个引擎显式传给仿真执行器。
- `.temp/sim-perf.md` 沿用现有表格格式，在提交 SHA 后追加 `[dense-v2]` 或 `[legacy]`；控制台摘要和每轮日志同时记录引擎。`+WT` 只表示未提交改动，不表示引擎。
- 汇报时同时给出引擎、Run ID 和耗时摘要；比较历史结果前必须确认引擎一致。无引擎标记的历史记录视为未知，只有找到明确证据后才能补标，不按耗时推断。

## 正式基线

1. 检查工作区：

```bash
git status --porcelain
```

2. 如果存在未提交改动，停止并通知用户先提交代码。只有用户明确要求快速验证时才能改用快速模式。
3. 工作区干净时运行：

```bash
SIMULATION_TEST_ENGINE=dense-v2 npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts
```

该脚本使用蓝图 7 核息壤运行到 3600 tick，重复 10 次取平均值，并把带有引擎标记的结果记录到 `.temp/sim-perf.md`。

## 快速验证模式

用户明确要求在未提交改动上快速验证性能变化时，运行：

```bash
SIMULATION_TEST_ENGINE=dense-v2 npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts -n 1
```

快速模式只执行一次迭代并跳过未提交改动拦截。工作区有未提交改动时，SHA 列标记为 `+WT`，并保留实际引擎标记，例如 `bc3efe1d+WT [dense-v2]`；详细日志仍写入 `.temp/sim-perf/runs/<RunID>/run-1.console.log`。不得把该结果当作正式基线。
