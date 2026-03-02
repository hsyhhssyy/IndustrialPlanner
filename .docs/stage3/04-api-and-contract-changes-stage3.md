# Stage3 API 与契约变更

## 1. 领域模型契约

### 1.1 设备功率字段

- `DeviceConfig` 新增：
  - `powerDemand: number`
  - `powerSupply: number`

约束：
- 全设备必须显式配置二者。
- 设备功率基础单位统一为 `kW`（`powerDemand/powerSupply` 均按 `kW` 录入与展示）。
- 未使用字段一律显式填 `0`，禁止省略。
- 消费设备 `powerSupply` 显式为 `0`，`powerDemand` 按设备口径给出。
- 发电设备 `powerDemand` 显式为 `0`，`powerSupply` 按设备口径给出。
- 复合设备可同时存在。

### 1.2 反应池口径确认

- 反应池维持“5 共享槽位”既有契约。
- Stage3 不引入反应池槽位结构升级的 API 变更。

### 1.3 自动布线任务契约

- 队列状态：`queued`、`running`、`done`、`failed`、`canceled`
- 任务参数必须包含基地尺寸边界定义。
- `done` 任务必须满足“所有连接均已正确路由完成”，并产出可识别的摆放蓝图结果对象。
- `failed` 任务至少产出可观测失败原因；是否附带“部分可行蓝图对象”为开发阶段待定项，需在实现前固化。
- 任务队列持久化策略：仅会话级；关闭浏览器后任务进度与结果全部丢失。

### 1.4 全局电池模型契约（Stage3 开发中定义）

- 电池在 Stage3 中定义为全局属性（非设备）。
- `LOW_POWER` 判定依赖“全局供需差 + 全局电池状态”。
- 字段与数据源由 Stage3 开发阶段补齐并在实现文档中固化。

## 2. 仿真事件与状态

### 2.1 电力观测

- 观测输出新增：
  - `powerNow`
  - `powerAvg10m`
  - `powerAvg1h`
  - `totalDemand`
  - `totalSupply`
  - `netPower`
- 时间口径沿用 Stage1：`1 标准秒 = X Tick`（当前实现 `X=20`），统计窗口按标准秒换算。

### 2.2 运行阻塞码

- 当前实现仍为 `NO_POWER`（阻塞）。
- Stage3 目标：`NO_POWER` 移除。
- 新增 `LOW_POWER`：系统用电量超过发电量且全局电池已耗尽（阻塞）。
- 新增 `OUT_OF_POWER_RANGE`：设备不在供电范围内（阻塞）。
- 运行形态仅有“运转 / 停机”，无“降速”语义。

## 3. 破坏性变更说明

- 状态码枚举从 `NO_POWER` 拆分为 `LOW_POWER/OUT_OF_POWER_RANGE`，对直接消费旧枚举的调用方属于潜在 Breaking 变更。
- Stage3 实施中需提供兼容迁移说明（映射策略与过渡期处理）。
