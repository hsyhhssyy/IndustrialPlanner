# Stage3 冻结决议（2026-03-05）

> 状态：Approved / Frozen

## 1. 冻结结论

- Stage3 自 2026-03-05 起冻结，不再接收 Stage3 范围内新增开发。
- Stage3 需求状态以 `08-stage3-requirements-and-backlog.md` 为准。

## 2. 需求状态总览

- 已完成：S3-RQ-001、S3-RQ-002、S3-RQ-007、S3-RQ-008、S3-RQ-009、S3-RQ-011、S3-RQ-012、S3-RQ-013、S3-RQ-014、S3-RQ-015、S3-RQ-016。
- 废弃：S3-RQ-010（自动布线）。

## 3. 废弃与迁移

- 废弃（不迁移 Stage4）：
  - 自动布线（Auto Routing）
  - 电力 10 分钟 / 1 小时窗口统计
- 迁移 Stage4：
  - S4-RQ-001 设备详情功率字段展示（发电设备展示 `powerDemand=0`）

## 4. 口径优先级

发生冲突时，以下文档优先级从高到低：

1. 本冻结决议
2. `08-stage3-requirements-and-backlog.md`
3. 其他 Stage3 草案文档

## 5. Stage4 启动边界

- Stage4 以 S4-RQ-001 作为首个承接项。
- Stage3 已冻结项仅允许修订文档，不再扩展实现范围。
