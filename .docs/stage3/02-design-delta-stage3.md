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
  - `NO_POWER` 不再作为硬阻塞
  - 仍保留“未接网不可运行”

## 2. 抽水泵

- 新增 `pumpOutputRatePerSecond` 配置。
- 每 tick 产出按配置速率换算。
- 与当前物流链路保持兼容。

## 3. 反应池与已废弃项说明

- 反应池当前正确口径为“5 共享槽位”，且已完成验收。
- 管道等效容量/液体锁定切换需求已废弃，不在 Stage3 设计实现范围。
- 瓶装液体专用选择器与隐藏组合方案已废弃，不在 Stage3 设计实现范围。
