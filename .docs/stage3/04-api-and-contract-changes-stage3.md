# Stage3 API 与契约变更

## 1. 领域模型契约

### 1.1 设备功率字段

- `DeviceConfig` 新增：
  - `powerDemand?: number`
  - `powerSupply?: number`

约束：
- 二者默认 `0`。
- 消费设备仅设置 `powerDemand`。
- 发电设备仅设置 `powerSupply`。
- 复合设备可同时存在。

### 1.2 抽水泵

- 抽水泵配置新增：
  - `pumpOutputRatePerSecond: number`

约束：
- 必须为正数。
- 参与每 tick 产出结算。

### 1.3 管道系统状态

- 新增系统级状态：
  - `lockedLiquidType?: ItemId`
  - `pipeBodyLength: number`
  - `equivalentCapacity: number`

约束：
- `equivalentCapacity = 2 * pipeBodyLength`
- `pipeBodyLength` 仅统计管道本体，不含储液罐。

### 1.4 反应池槽位

- 输入槽位改为：
  - `solidSlots: [Slot, Slot, Slot]`
  - `liquidSlots: [Slot, Slot]`

## 2. 仿真事件与状态

### 2.1 电力观测

- 观测输出新增：
  - `powerNow`
  - `powerAvg10m`
  - `powerAvg1h`
  - `totalDemand`
  - `totalSupply`
  - `netPower`

### 2.2 运行阻塞码

- `NO_POWER` 从硬阻塞集合中移除。
- `NOT_CONNECTED` 继续保留。

## 3. UI 契约

- 通用物品选择器：隐藏瓶装组合项。
- 瓶装液体选择器：
  - 输入：瓶型、液体
  - 输出：标准 itemId
- 配方显示层与执行层口径一致：
  - 显示聚合
  - 执行展开

## 4. 破坏性变更说明

- 反应池旧槽位结构不再作为运行时主结构。
- 依赖旧结构的代码需迁移适配层。
