# Stage3 开发文档集（含 Stage2 未落地项与 Stage3 新增需求）

Stage3 用于承接 Stage2 冻结后未落地能力，原则为“契约先行、口径一致、可回归、可回滚”。

## 阶段定位

- 来源：Stage2 冻结移交
- 启动日期：2026-02-26
- 阶段目标：完成 Stage2 未落地高优先级能力，并落地 Stage3 新增需求

## Stage3 主目标

1. 电力模型补齐
   - 引入设备 `powerDemand/powerSupply`
   - 引入净功率计算
   - 引入即时/10 分钟/1 小时统计（标准秒）
   - 运行语义改造为：以当前 `NO_POWER`（阻塞）为基线，在 Stage3 内完成拆分为 `LOW_POWER/OUT_OF_POWER_RANGE`（均阻塞），并移除 `NO_POWER`

2. 自动布线能力落地
   - 自动布线（Auto Routing）作为 Stage3 必做项完成交付
   - 后台队列状态机包含 `queued -> running -> done | failed | canceled`

3. 设备功率字段补齐与展示
   - `powerDemand/powerSupply` 全设备显式补齐
   - 设备属性页展示功率字段；发电设备 `powerDemand` 显示为 `0`

## 文档索引

1. `00-change-log-and-goals-stage3.md`
2. `01-scope-and-dod-stage3.md`
3. `02-design-delta-stage3.md`
4. `03-migration-guide-stage2-to-stage3.md`
5. `04-api-and-contract-changes-stage3.md`
6. `05-regression-test-plan-stage3.md`
7. `06-risk-and-rollback-stage3.md`
8. `07-release-notes-stage3.md`
9. `08-stage3-requirements-and-backlog.md`
10. `09-auto-routing-algorithm-design.md`

## 与 Stage2 的边界

- Stage2：冻结，不再新增需求。
- Stage3：可同时承接 Stage2 未落地条目与 Stage3 新增需求，不反向修改 Stage2 冻结验收结论。

## 基线确认（2026-03-01）

- 已确认：反应池已完成验收，正确口径为“5 共享槽位”。

## 代码核对口径（2026-03-01）

- 核对范围：`src/` 当前实现 + `.docs/stage2` 冻结文档。
- 结论：Stage2 主能力可用；Stage3 活跃项（含新增需求）已统一归集到 `08-stage3-requirements-and-backlog.md`。
- 后续新增需求与细节，统一在 `08` 文档追加，避免散落到多份草案。

## 时间口径补充（沿用 Stage1）

- `标准秒` 沿用 Stage1 定义：领域模型时间常量口径，`1 标准秒 = X Tick`（当前实现 `X=20`）。
- Stage3 中的 10 分钟/1 小时窗口按标准秒换算为 Tick，不受仿真倍速影响。
