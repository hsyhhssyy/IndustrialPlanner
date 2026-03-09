# Stage5 需求索引 / 状态面板

## 文档内容范围、结构与格式约定（必读）

### 1. 本文档负责什么

本文档是 Stage5 的需求总表与进度面板，只负责：

1. 汇总所有 Stage5 已确认需求。
2. 为每个需求提供编号、状态、优先级、当前阶段与文档链接。
3. 提供面向 AI 和人类的快速导航入口。
4. 作为项目级进度同步时的第一查看点。

本文档不负责：

1. 展开某个需求的完整讨论与设计细节。
2. 记录逐轮聊天内容。
3. 代替单需求文档承担验收、测试或 bug 记录。
4. 代替 [bugs.md](bugs.md) 承担跨需求 bug / 中断流水。

### 2. 本文档固定结构

本文档必须长期保持以下结构：

1. 文档内容范围、结构与格式约定
2. 使用规则
3. 需求状态总表
4. 当前阶段观察
5. 更新日志

### 3. 本文档记录格式

1. 每条需求必须有唯一编号，格式为 `S5-RQ-XXX`。
2. 状态统一使用：`todo`、`in-progress`、`blocked`、`done`。
3. 优先级统一使用：`P0`、`P1`、`P2`、`P3`。
4. 每条需求必须链接到唯一的单需求文档。
5. 若某项需求拆出子问题，子问题写入对应需求文档，不在本表单独扩散。
6. 若某个 bug 暂时不适合归属到单需求，登记到 [bugs.md](bugs.md)。

## 使用规则

1. 新需求先登记到本文档，再创建对应需求文档。
2. 单需求状态变化后，先更新对应需求文档，再回写本文档。
3. 若状态面板与单需求文档不一致，以单需求文档为准，随后尽快修正本文档。
4. 跨需求 bug 或中断事件不在本文档展开，统一转到 [bugs.md](bugs.md)。
5. 本文档尽量保持一屏内可快速浏览，不写长段落分析。

## 需求状态总表

| 编号 | 名称 | 优先级 | 状态 | 当前阶段 | 需求文档 |
| --- | --- | --- | --- | --- | --- |
| S5-RQ-001 | 缺陷修复与稳定性收敛 | P0 | todo | M1 | [REQ-001](requirements/REQ-001-bug-and-stability.md) |
| S5-RQ-002 | 真实 1.1 配方与正式图标替换 | P0 | todo | M1 | [REQ-002](requirements/REQ-002-real-1-1-data-and-icons.md) |
| S5-RQ-003 | 可维护性清理与模块拆分 | P2 | todo | M3 | [REQ-003](requirements/REQ-003-maintainability-cleanup.md) |
| S5-RQ-004 | 仿真运行时动态调整能耗 | P1 | todo | M2 | [REQ-004](requirements/REQ-004-runtime-power-adjustment.md) |
| S5-RQ-005 | 物品准入口 | P1 | todo | M2 | [REQ-005](requirements/REQ-005-item-admission.md) |
| S5-RQ-006 | 起死回生机公共蓝图 | P1 | todo | M2 | [REQ-006](requirements/REQ-006-public-blueprint-revival.md) |
| S5-RQ-007 | 电力 / 电池折线图 | P1 | todo | M2 | [REQ-007](requirements/REQ-007-power-battery-chart.md) |
| S5-RQ-008 | Playwright CLI 自动化测试流程 | P0 | todo | M3 | [REQ-008](requirements/REQ-008-playwright-automation.md) |

## 当前阶段观察

### 当前排序

1. 优先完成 P0：S5-RQ-001、S5-RQ-002、S5-RQ-008。
2. 然后推进 P1：S5-RQ-004、S5-RQ-005、S5-RQ-006、S5-RQ-007。
3. S5-RQ-003 以“服务当前主线”为前提推进，不单独膨胀为全面重构。

### 当前阻塞

- 暂无已登记 `blocked` 项；后续若出现阻塞，必须在对应需求文档补充原因、影响与解除条件。

### 全局 bug 入口

- 跨需求 bug、中断问题与暂未归属问题，统一见 [bugs.md](bugs.md)。

## 更新日志

- 2026-03-09：Stage5 文档体系改造完成，建立需求索引总表。
- 2026-03-09：补充全局 bug 文档入口，并明确需求索引不承担 bug 流水记录。
