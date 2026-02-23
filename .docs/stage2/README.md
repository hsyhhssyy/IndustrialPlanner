# Stage2 开发指导文档集（重定义）

本目录用于承接 Stage1 基线后的增量迭代，强调“变更可追溯、升级可迁移、结果可验证、异常可回滚”。

## 阶段说明

Stage2 已重定义为原 PRD 的 Stage3 能力方向：

- 产线规划与目标产量反推
- 多目标联合规划
- 配方分支可切换策略

本阶段首个交付模块为“产线规划器（基础版）”，用于在现有仿真编辑器中提供静态产能计算能力。

## 主线文档（建议先读）

1. [00-change-log-and-goals.md](./00-change-log-and-goals.md)：相对 Stage1 的变更总览、目标与非目标
2. [01-scope-and-dod-stage2.md](./01-scope-and-dod-stage2.md)：范围边界、DoD、验收口径
3. [02-design-delta.md](./02-design-delta.md)：架构/数据/交互增量设计（仅记录差异）
4. [03-migration-guide.md](./03-migration-guide.md)：从 Stage1 升级到 Stage2 的迁移与兼容策略
5. [04-api-and-contract-changes.md](./04-api-and-contract-changes.md)：接口、状态、事件契约变化
6. [05-regression-test-plan.md](./05-regression-test-plan.md)：回归测试矩阵与通过标准
7. [06-risk-and-rollback.md](./06-risk-and-rollback.md)：风险、观测指标、回滚预案
8. [07-release-notes.md](./07-release-notes.md)：发布说明、已知限制、后续计划

## 专题文档（按需阅读）

1. [01-planner-module-mvp.md](./01-planner-module-mvp.md)：产线规划器基础版需求与完成定义
2. [02-toast-governance.md](./02-toast-governance.md)：全局提示（Toast）降噪规范与落地表
3. [code-structure-smell-review.md](./code-structure-smell-review.md)：代码结构异味审查记录

## 与 Stage1 的关系

- Stage1 的编辑器与仿真逻辑保持不变。
- Stage2 模块先作为独立浮窗工具，不直接驱动地图自动布置。
- 不引入自动寻路、自动摆放、优化求解器。