# IndustrialPlanner 文档进度记录

本文件用于记录项目各阶段（Stage）的开发与验收进度。

## Stage 文档模板要求（重要）

以后所有新 Stage 都必须从 [stage-template](stage-template) 开始创建，禁止跳过模板直接手写一套新的 Stage 文档结构。

强制要求：

1. 新 Stage 启动时，先复制 [stage-template](stage-template) 到对应 Stage 目录。
2. 新 Stage 的 README 必须从 [stage-template/README.md](stage-template/README.md) 演化而来，并同时承担 `project-overview` 职责。
3. 新 Stage 必须至少包含：
	- README
	- requirements-index
	- faq
	- bugs
	- requirements/REQ-template 的复制产物
4. 以后若要调整 Stage 文档方法，优先先更新 [stage-template](stage-template)，再用于后续 Stage；不要每个 Stage 各自发明一套新规则。
5. 若特殊情况必须偏离模板，必须先在对应 Stage 的 README 中明确写出偏离原因。

## 当前状态

- Stage1：已完成（2026-02-23）
- Stage2：已冻结（2026-02-26）
- Stage3：已冻结（2026-03-05）
- Stage4：已完成（2026-03-09）
- Stage5：已启动（2026-03-09）

## 模板入口

- Stage 模板目录： [stage-template](stage-template)
- 模板总入口： [stage-template/README.md](stage-template/README.md)

## 阶段进度明细

- 全局领域模型数据：`./domain-model-data.yaml`

### Stage1（已完成）

- 状态：Completed
- 完成日期：2026-02-23
- 相关文档目录：`./stage1/`
- 文件夹已锁定，所有文件不应继续编辑。

## Stage2：（已完成）

- 相关文档目录：`./stage2/`
- 已冻结，作为 Stage2 交付基线；不再新增需求。
- 未实现条目已迁移至 `./stage3/`。

## Stage3：（已完成）

- 相关文档目录：`./stage3/`
- 承接 Stage2 冻结后未实现项（电力完整模型、管道容量与传染、瓶装液体专用选择器等）。

## Stage4：（已完成）

- 状态：Completed
- 完成日期：2026-03-09
- 相关文档目录：`./stage4/`
- Stage4 已完成并转入冻结归档；后续新增需求统一进入 `./stage5/`。

## Stage5：（已启动）

- 相关文档目录：`./stage5/`
- 作为新的活跃阶段承接后续需求与实现工作。
- 当前主线：修复 bug、切换真实 1.1 配方与正式图标、移除“超时空模式”、增强可维护性、补齐新增功能并建立 Playwright CLI 自动化测试流程。

## 无安排需求

下列需求没有重要性，因此不会在任何一个Stage实现。未来的Stage如果不由用户明确提出，也不会将下述需求加入Stage。

- 音乐播放器
- Playwright CLI自动化测试。
- 动态静态领域模型分离
- 设备配置Json化
- 完整人类可读性重构

## 维护说明

- 新阶段启动时，必须先从 [stage-template](stage-template) 复制出新 Stage 文档，再在本文件追加阶段条目并更新状态。
- 阶段验收完成后，请同步更新“当前状态”与“阶段进度明细”。
- 若模板规则需要演化，先更新 [stage-template](stage-template)，再将变更带入后续 Stage。
