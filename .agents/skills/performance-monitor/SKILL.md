---
name: performance-monitor
description: 运行仿真或 EDA 算法性能基线、比较性能结果、定位性能退化时使用；覆盖单核 CPU、真实 GPU 浏览器、分阶段耗时和场景对比。功能正确性测试、EDA 质量回归、一般代码检查、未经用户授权的性能优化不得使用。
---

# 性能监控

## 能做什么

- 运行仿真或 EDA 基线、快速验证时，读取 [性能基线流程](references/baseline-workflow.md)。
- 运行 EDA core / GPU 场景时，读取 [EDA 性能流程](references/eda-workflow.md)。
- 定位性能下降原因时，读取 [性能分析流程](references/investigation.md)。
- 统一入口：
  - `npm run perf -- sim --engine dense-v2 [-n 10]`
  - `npm run perf -- eda --mode core --scenario <id> [-n 3] [--affinity 0]`
  - `npm run perf -- eda --mode browser --scenario <id> [-n 1]`
  - `npm run perf -- compare <baseline-run> <current-run>`
- 每次性能测试先核对应用当前默认引擎，再显式传给脚本；当前默认是 Dense（`dense-v2`）。结果和汇报必须标明实际引擎、suite、场景、affinity、GPU 状态；不同条件不得混作同一基线比较。
- sim 结果写 `.temp/perf/sim.md`；EDA 结果写 `.temp/perf/eda.md`；原始样本和日志在 `.temp/perf/runs/<runId>/`。旧 `.temp/sim-perf.md` 仅作历史，不再作为新基线入口。

## 不能做什么

- 不得在存在未提交改动时运行正式基线。`-n 1` 或 `--allow-dirty` 只能做开发验证，结果带 `+WT`，不能当作正式基线。
- 不得把 EDA 性能测试当作质量回归。面积、首解次数、产出和预算结算仍由 `npm run test:eda` 验收。
- 无真实硬件 WebGPU 时不得产出 GPU 基线。fallback adapter 必须拒绝，不能把 CPU 回退结果计为 GPU。
- 不得跨场景、跨引擎、跨 affinity、跨 GPU 状态、跨尝试次数直接比较耗时。
- EDA 实际提案数不等于场景预算上限。成功返回会提前结束，后续 attempt 多为少量续搜；不能把 `localEvaluations` 当作已执行次数。
- 未经用户许可不得修改业务代码进行性能优化；定位阶段只能增加性能埋点。
