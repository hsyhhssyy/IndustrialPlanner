# Stage4 开发文档集

> 状态：Completed / Frozen（启动于 2026-03-05，代码实现闭合于 2026-03-07，阶段关闭于 2026-03-09）

## 阶段定位

- 来源：独立新阶段（持续承接后续新增需求）。
- 衔接说明：当前已确认需求中，S4-RQ-001 来自历史遗留。
- 核心原则：范围清晰、口径一致、可回归、可回滚。

## Stage4 当前已确认目标

1. S4-RQ-001 设备详情功率字段展示
   - 在设备详情中展示 `powerDemand`。
   - 发电设备展示 `powerDemand=0`。
2. S4-RQ-002 协议储存箱六格库存化
   - 仿真开始时支持置入初始物品。
   - 固定 6 格，每格容量 50。
   - 输入/输出按第 1 格到第 6 格顺序检索。
3. S4-RQ-003 下游接收前置判定传递物品ID（方案A）
   - `canReceiveOnPortWithPlan` 支持 itemId 透传。
   - 前置判定可反映目标设备对当前物品的接收能力。
   - 本需求独立追踪，不作为准入口需求附属。
4. S4-RQ-004 统一缓冲组与槽位顺序规则重构
   - 单设备支持多组端口-缓冲区映射，分组独立搜索与仲裁。
   - 槽位支持 `free/pinned`，输入按 `sequential` 选择首个可接收位。
   - 协议储存箱（S4-RQ-002）具体实现机制复用本能力。
5. S4-RQ-005 超时空内容可见性门禁（Tag 驱动）
   - 顶栏“超时空配方”开关支持发布策略：`用户可控` / `强制关闭`。
   - 开关关闭时，`超时空` 标签内容在左侧设备列表、合成百科、产线规划器、物品选择器不可见。
   - 发布切到“强制关闭”后，刷新自动将历史开启配置收敛为关闭。
   - 产线规划器已补充基础供给优先级与强制处置节点规则，避免副产物流被误判为默认供给来源，并确保废弃物流被显式纳入流程图。

## 当前完成状态（2026-03-07）

- S4-RQ-001：已完成。
- S4-RQ-002：已完成。
- S4-RQ-003：已完成。
- S4-RQ-004：已完成（含缓冲组/RR/槽位规则、协议储存箱与反应池实例化、belt 0→1 缓冲运输语义、world 分层渲染支撑、splitter/converger 内部运输可视化）。
- S4-RQ-005：已完成（含顶栏开关、发布策略强制关闭自愈、五处界面 `超时空` 标签可见性门禁，以及产线规划器的基础供给/处置规则补强）。
- 阶段结论：Stage4 范围内已确认需求全部完成，文档已冻结归档。

## 关闭说明（2026-03-09）

- Stage4 需求项已全部标记完成并作为交付基线冻结。
- Stage4 目录中的专项草案/讨论文档保留为历史记录，不再作为 Stage4 未完成项追踪。
- 后续新需求与新方案统一进入 Stage5 文档集维护。

## 文档索引

1. `00-kickoff-and-goals-stage4.md`
2. `01-scope-and-dod-stage4.md`
3. `02-design-delta-stage4.md`
4. `03-migration-guide-stage3-to-stage4.md`
5. `04-api-and-contract-changes-stage4.md`
6. `05-regression-test-plan-stage4.md`
7. `06-risk-and-rollback-stage4.md`
8. `07-release-notes-stage4.md`
9. `08-stage4-requirements-and-backlog.md`
10. `09-device-detail-power-display-design.md`
11. `10-stage4-delivery-plan.md`
12. `11-stage4-checklist.md`
13. `12-protocol-storage-box-inventory-design.md`
14. `13-item-aware-receive-plan-design.md`
15. `14-unified-buffer-group-and-slot-rule-design.md`
16. `15-s4-rq-004-execution-contract-and-risk-mitigation.md`
17. `16-stage4-conversation-notes-arbitration-and-buffer-rules.md`
18. `17-pull-driven-simulation-refactor-spec.md`
19. `18-pull-driven-followup-belt-and-scheduling-notes.md`

## 口径优先级

发生冲突时按以下优先级执行：

1. `08-stage4-requirements-and-backlog.md`
2. 本目录其余 Stage4 文档
3. 历史阶段文档（Stage1/2/3）
