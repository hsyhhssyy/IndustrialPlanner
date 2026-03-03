# Stage3 范围与完成定义（DoD）

## 1. In Scope

### 1.1 电力模型

- 为全设备显式补齐 `powerDemand/powerSupply` 字段。
- 提供设备级与全局级耗电/发电/净功率展示。
- 提供即时值、10 分钟均值、1 小时均值（标准秒）统计。
- 基线当前缺电语义为阻塞停机（`NO_POWER`）；Stage3 内完成状态码拆分。
- 状态码改造目标：`NO_POWER` 拆分为 `LOW_POWER`（阻塞）与 `OUT_OF_POWER_RANGE`（阻塞）。
- 设备属性页展示功率字段；发电设备 `powerDemand` 显示为 `0`。
- 新增全局电池模型字段与数据源定义（电池为全局属性，非设备）。

时间口径：沿用 Stage1 标准秒定义，`1 标准秒 = X Tick`（当前实现 `X=20`）。

### 1.2 自动布线（Auto Routing）

- 自动布线作为 Stage3 必做项完成。
- 提供后台任务队列与进度可观测。
- 状态机支持：`queued -> running -> done | failed | canceled`。

### 1.3 文档口径收口

- 统一反应池口径为“5 共享槽位（已验收）”。

## 2. Out of Scope

- 自动布局、寻路、自动落盘。
- 全局优化求解。
- 复杂物理流体求解。

## 3. DoD

1. `powerDemand/powerSupply` 完整进入领域模型与展示。
2. 缺电场景下设备阻塞停机；接网前置不被放宽。
3. 电力三窗口统计按标准秒正确滚动。
4. `NO_POWER` 已移除，并由 `LOW_POWER` / `OUT_OF_POWER_RANGE` 替代。
5. 设备属性页可展示功率字段；发电设备 `powerDemand=0` 展示正确。
6. 自动布线能力达到 Stage3 验收口径。
7. 反应池口径统一为“5 共享槽位（已验收）”。
8. Stage2 冻结能力无 P0/P1 回归。
