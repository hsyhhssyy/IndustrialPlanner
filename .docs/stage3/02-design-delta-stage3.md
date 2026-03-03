# Stage3 增量设计（相对 Stage2 冻结版）

## 1. 电力子系统

- 新增设备功率字段：
  - `powerDemand: number`
  - `powerSupply: number`
- 新增功率聚合计算：
  - `totalDemand`
  - `totalSupply`
  - `netPower = totalSupply - totalDemand`
- 新增滚动窗口缓存：
  - `powerNow`
  - `powerAvg10m`（600 标准秒）
  - `powerAvg1h`（3600 标准秒）
- 运行判定：
  - 现状为 `NO_POWER`（阻塞）
  - Stage3 目标：移除 `NO_POWER`
  - 新增 `LOW_POWER`（阻塞）
  - 新增 `OUT_OF_POWER_RANGE`（阻塞）
- 新增全局电池模型（非设备）用于供需不足判定数据源。
- 设备属性展示：
  - 展示 `powerDemand/powerSupply`
  - 发电设备 `powerDemand` 固定显示 `0`

## 2. 自动布线（Auto Routing）

- 自动布线模块纳入 Stage3 必做项。
- 采用后台任务队列异步运行，支持进度上报。
- 状态机为 `queued -> running -> done | failed | canceled`。
- `done` 必须满足“所有连接均已正确路由完成”。
- 生成蓝图必须满足当前基地尺寸边界约束。

## 3. 反应池口径说明

- 反应池当前正确口径为“5 共享槽位”，且已完成验收。
