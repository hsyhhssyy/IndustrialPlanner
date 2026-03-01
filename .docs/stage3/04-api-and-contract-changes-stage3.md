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

### 1.3 反应池口径确认

- 反应池维持“5 共享槽位”既有契约。
- Stage3 不引入反应池槽位结构升级的 API 变更。

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
- 其他既有阻塞语义保持不变。

## 3. 废弃项契约说明

- 以下需求已废弃，不产生 API/契约变更：
  - 管道等效容量（`2 × 连通长度`）与单液体锁定/排空切换。
  - 瓶装液体“隐藏组合 + 专用选择器 + 单展示多展开”。

## 4. 破坏性变更说明

- 当前未确认硬 Breaking API。
