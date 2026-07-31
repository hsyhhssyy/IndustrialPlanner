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
   如果有未提交改动，通知用户先提交代码再执行测试，并停止。

2. 确认无未提交改动后，运行性能测试脚本：
   ```bash
   npx tsx --tsconfig tsconfig.app.json scripts/perf/sim-perf.ts
   ```

3. 将脚本输出的结果汇报给用户。


## 后续动作

如果用户后续要求你尝试探查性能下降原因，你不能只通过代码观察的形式来进行，你必须在Sim-Perf日志中进行时间统计，然后根据日志反馈来确定该问题的耗时。
未经用户许可，不可以实际修改代码来调整性能，你只能修改代码进行埋点。