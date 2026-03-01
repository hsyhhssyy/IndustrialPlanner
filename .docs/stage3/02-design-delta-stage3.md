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

## 2. 流体系统

- 新增连通管道系统标识与状态：
  - `lockedLiquidType?: ItemId`
  - `pipeBodyLength`
  - `equivalentCapacity`
- 注入规则：
  - 若 `lockedLiquidType` 存在且与输入液体不同，则阻塞。
- 排空规则：
  - 连通管道本体液量与连通储液罐液量均为 0 时解锁。

## 3. 抽水泵

- 新增 `pumpOutputRatePerSecond` 配置。
- 每 tick 产出按配置速率换算。
- 与当前管道速度与容量规则共同结算。

## 4. 瓶装液体

- UI：引入专用选择器组件。
- 领域层：组合物品可保留，但默认隐藏。
- 配方层：
  - 展示层聚合配方
  - 执行层展开配方
- 返瓶：从输入瓶型映射返回瓶子。

## 5. 反应池

- 输入缓存拆分：`solidSlots[3]`、`liquidSlots[2]`。
- 路由逻辑保持，槽位判定改为按类型独立容量。
- 并行推进沿用双配方 lane 模型。
