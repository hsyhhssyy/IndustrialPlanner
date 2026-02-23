# Stage1 开发指导文档集

本目录将 `prd.md` 与 `ui-spec.md` 的冻结要求，整理为可执行的 Stage1 开发指引。

## 文档导航

1. [prd.md](./prd.md)：Stage1 冻结版产品需求文档（原 `.docs/prd.md`）
2. [01-scope-and-dod.md](./01-scope-and-dod.md)：范围边界、术语、DoD、冻结清单
3. [02-architecture-and-data-model.md](./02-architecture-and-data-model.md)：前端架构、模块分层、核心数据结构
4. [03-simulation-engine-guide.md](./03-simulation-engine-guide.md)：离散 Tick 引擎、两阶段更新、设备运行规则
5. [ui-spec.md](./ui-spec.md)：Stage1 UI 设计规范与交互实现指南（合并版）
6. [05-development-plan-and-tasks.md](./05-development-plan-and-tasks.md)：里程碑、任务拆分、交付节奏
7. [06-test-and-acceptance.md](./06-test-and-acceptance.md)：该文档表明本项目Stage1不存在测试。
8. [07-stage1-faq.md](./07-stage1-faq.md)：口径澄清与常见问题
9. [08-performance-notes.md](./08-performance-notes.md)：高倍速仿真性能优化专题与排查清单

## 使用方式

- 新成员入项：先读 `01` 与 `05`
- 功能开发：按 `02 -> 03 -> ui-spec` 对照实现

## Stage1 执行原则（强约束）

- 仅实现 PRD Stage1 冻结清单，不提前引入 Stage2+ 能力。
- 传送带、分流、汇流、桥接必须是显式设备实例，禁止隐式拓扑节点。
- 连接判断只基于端口邻接与兼容，不实现寻路系统。
- 仿真采用离散 Tick 与 Plan/Commit 两阶段机制，禁止单阶段直接结算。
- UI 交互与视觉语义以现有设计规范为准，不新增额外页面与交互模式。

## 参考来源

- 产品需求：`./prd.md`
- UI 规范：`./ui-spec.md`
