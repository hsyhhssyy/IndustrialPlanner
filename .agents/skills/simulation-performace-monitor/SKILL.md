---
name: simulation-performace-monitor
description: 运行仿真性能基线，或基于 Sim-Perf 日志定位仿真性能退化时使用；功能正确性测试、一般代码检查或未经用户授权的性能优化不得使用。
---

# 仿真性能监控

## 能做什么

- 运行基线或快速验证时，读取 [性能基线流程](references/baseline-workflow.md)。
- 定位性能下降原因时，读取 [性能分析流程](references/investigation.md)。

## 不能做什么

- 不得在存在未提交改动时运行正式基线，不得把快速验证结果当作正式基线。
- 未经用户许可不得修改业务代码进行性能优化；定位阶段只能增加性能埋点。
