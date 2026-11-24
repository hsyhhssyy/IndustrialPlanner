# 性能基线流程

## 引擎选择与记录

- 每次运行前，检查 `src/app/shell/state/simulation-engine-launch-preference.ts` 的默认启动规则及 `src/main.tsx` 的引擎映射。使用无用户持久化偏好、无调试回退时的默认引擎；当前是 Dense（`dense-v2`）。如果默认值变化，命令中的 `--engine` 必须随之变化。
- 仿真基线必须显式传入引擎。统一入口会把同一个引擎显式传给仿真执行器，并拒绝缺失或无效值。
- `.temp/perf/sim.md` 在提交 SHA 后标记实际引擎；控制台摘要和每轮日志同时记录引擎。`+WT` 只表示未提交改动，不表示引擎。
- 汇报时同时给出引擎、Run ID 和耗时摘要；比较历史结果前必须确认引擎一致。无引擎标记的历史记录视为未知，只有找到明确证据后才能补标，不按耗时推断。

## 仿真正式基线

1. 检查工作区：

```bash
git status --porcelain
```

2. 如果存在未提交改动，停止并通知用户先提交代码。只有用户明确要求快速验证时才能改用快速模式。
3. 工作区干净时运行：

```bash
npm run perf -- sim --engine dense-v2
```

该命令使用蓝图 7 核息壤运行到 3600 tick，重复 10 次取中位数，把结果写入 `.temp/perf/runs/<runId>/` 和 `.temp/perf/sim.md`。

旧入口仍可运行，但不再作为新基线首选：

```bash
SIMULATION_TEST_ENGINE=dense-v2 npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts
```

## 仿真快速验证

工作区有未提交改动、用户明确要求快速验证时，运行：

```bash
npm run perf -- sim --engine dense-v2 -n 1
```

快速模式只执行一次迭代。结果仍写入 `.temp/perf/`，SHA 标记为 `+WT`，并保留实际引擎标记；不得把该结果当作正式基线。

## EDA 基线

EDA 的 core 单核、GPU 浏览器和场景规则见 [EDA 性能流程](eda-workflow.md)。EDA 不使用 `SIMULATION_TEST_ENGINE`，固定 `dense-v2` / 2 TPS；正式基线同样要求工作区干净。
