# 03 仿真引擎实现指南

## 1. Tick 循环总览

Stage1 必须使用离散 Tick，并采用两阶段更新：

- **Phase A（Plan）**：计算本 tick 将发生的交接
- **Phase B（Commit）**：推进进度、执行交接、落地状态

禁止在单阶段中直接“读取并写入同一时刻下游状态”，否则会出现奇偶交替问题。

## 2. 通用握手接口

所有设备需实现统一端口协议：

- `canReceive(port, item)`
- `receive(port, item)`
- `canSend(port, item)`
- `send(port)`

Plan 阶段只做可行性判断与预留，Commit 阶段才真实变更容器。

## 3. 传送带双区间进度模型

## 3.1 区间定义

- `progress01 ∈ [0,1]`
- 入口段：`0.0 ~ 0.5`
- 出口段：`0.5 ~ 1.0`

## 3.2 入口段规则

- `slot != null` 即可推进至 `<= 0.5`
- 不依赖下游是否可接收

## 3.3 出口段规则

- 引入双状态握手：`可尝试（canTry）` 与 `可接收（canAccept）`
- `canAccept => canTry`，但 `canTry` 不必然 `canAccept`
- 上游物品在 `0.5~1.0` 的推进条件为：下游满足 `canTry`
- 上游物品达到 `1.0` 后，只有下游满足 `canAccept` 才允许提交（递交）
- 若下游在本 tick 由可尝试转为阻塞，则上游在 `0.5~1.0` 必须立即停在当前进度（不得“冲到 1 再停”）

双状态语义（传送带单槽位）：

- `0~0.5`：占用中，不可尝试
- `0.5(不含)~1`：可尝试，不可接收
- 物品提交离开后：可接收（空槽）

## 3.4 Plan 迭代收敛补充（避免 1 tick 间距漂移）

- Plan 循环的“继续迭代”条件不能只依赖“是否生成 transfer plan”。
- 当本轮出现“带道进度推进（如 `0.5 -> 0.525`）但尚未提交”时，也必须视为状态变化并触发下一轮 Plan。
- 否则会出现执行顺序偏置：上游只能在下一 tick 才感知下游可尝试状态，导致物品间距逐件增大（1 tick 级漂移）。
- 推荐口径：同一 tick 内，只要任一 lane 的 `progress01` 发生前进，Plan 迭代应继续，直到“无提交且无进度变化”再收敛。

## 4. Reservation 规则

下游“本 tick 可接收”定义：

1. 当前为空，或本 tick 末将腾空
2. 且入口尚未被其他上游预留
3. 冲突时停机，stallReason=OUTPUT_BLOCKED

补充：

- 下游“可尝试（canTry）”用于允许上游 `0.5~1` 推进，不代表可立即提交。
- 下游“可接收（canAccept）”才允许本 tick 递交。
- 推荐实现口径：Plan 阶段先判定 `canTry/canAccept`，Commit 阶段仅对 `canAccept` 的计划执行写入。

## 4.1 `CONFIG_ERROR` 判定时机

- 所有配置型错误在“进入仿真”时统一校验。
- 校验失败的设备在仿真开始即标记 `stallReason=CONFIG_ERROR`。
- 不等待运行到具体设备逻辑再触发。

## 4.2 取货口 `OUTPUT_BLOCKED` 判定口径

- 取货口不应在每个 tick 因“瞬时未发货”闪烁 `OUTPUT_BLOCKED`。
- 采用基于标准秒的时间窗判定：在一个运输间隔窗口（当前为 `2 秒`）内若一次都未成功出货，则标记 `OUTPUT_BLOCKED`。
- 成功出货后计数器立即清零。

## 4.3 取货口“无视库存”口径

- `pickupIgnoreInventory=false`：取货口仅在仓库库存可用时可出货，成功交接后扣减仓库库存。
- `pickupIgnoreInventory=true`：取货口可无视仓库库存持续出货，且成功交接后不扣减仓库库存。
- 当取货口选择了带 `矿石` tag 的物品时，`pickupIgnoreInventory` 视为强制开启（不可关闭）。

## 5. runtimeKind 运行逻辑

## 5.1 `processor`

- 输入端口共享 `inputBuffer`
- 输出端口共享 `outputBuffer`
- 满足配方输入后推进 `progress01`
- 完成周期时向 `outputBuffer` 生成产物
- `inputBuffer` / `outputBuffer` 的容量与槽位由设备类型属性定义：
	- `inputBufferSlots` / `outputBufferSlots`
	- `inputBufferSlotCapacities` / `outputBufferSlotCapacities`
- 缓存接收判定顺序：
	1) 先判定槽位绑定（已绑定沿用；未绑定需有空槽）
	2) 再判定该槽位独立容量（写入后不得超过该槽位上限）
- 关键约束：
	- 槽位上限**不共享**
	- 不同槽位上限可不一致（例如 `[20, 50]`）
- 当槽位=1时：
	- 缓存为空可接收任意兼容物品
	- 缓存非空仅接收已缓存的同类型物品
- 多槽位行为（例如槽位=2）：
	- 可并存最多 2 种物品
	- 第 3 种新物品在任一槽位腾空前不可进入
	- 同一物品始终写入其绑定槽位，并受该槽位上限约束
- 周期完成时若输出缓存因容量或槽位不足无法写入整批产物，设备保持在完成点并标记 `OUTPUT_BLOCKED`

## 5.2 `conveyor` / `junction`

- `conveyor`：单槽位 `slot`，容量固定 1
- `junction`：按设备语义分配槽位
	- `splitter` / `merger`：单槽位
	- `bridge`：双通道双槽位（`nsSlot` 与 `weSlot` 独立）
- `bridge` 通道映射固定为：`N->S`、`S->N`、`W->E`、`E->W`
- 禁止同边回送与跨通道转向（如 `N->N`、`N->E`）
- `progress01` 表示槽内物品运输进度
- 到达提交点后执行向下游交付

供电规则补充：仅 `requiresPower=true` 的设备参与供电判定；Stage1 中仅 `item_port_grinder_1` 需要供电。

## 5.3 `storage`

- 提供仓库存取能力
- 可接入传送带或设备端口
- 不承担生产周期逻辑
- 当 `submitToWarehouse=true` 时，按仿真时间每 10 秒 触发一次批量提交，将该存储箱内所有物品一次性提交到仓库

## 6. 仿真控制行为

- **开始仿真**：初始化全部 runtime state、统计采样器，并重置仓库库存为统一初始值（`item_originium_ore=∞`，其他物品=`0`）
- **开始仿真（补充）**：对每个 `processor` 读取编辑态预置输入配置（`preloadInputs[]`），按槽位索引与该槽位容量上限进行夹取后注入 `inputBuffer`
- **退出仿真**：清空设备进度、仓库统计快照、仓库物品数量、临时队列
- **倍速切换**：仅影响单位真实时间内 tick 数，不改变单 tick 规则

速度口径补充（当前实现）：

- `tickRate = 20`
- 时间口径总则：在所有文档中，凡提到 X 秒 / X 分钟，均按仿真时间定义：`1 秒 = 20 tick`、`1 分钟 = 1200 tick`；该口径不受仿真倍速影响。
- 领域模型中的配方周期参数使用“标准秒”（如 `cycleSeconds`），引擎在运行时按 `tickRate` 换算为 tick。
- 传送带速度参数使用标准秒（当前为 `2 秒/格`），引擎按 `tickRate` 动态换算每 tick 进度。

## 7. 统计口径

统计面板至少输出：

- 仓库当前库存总量
- 仓库物品变化速率（/min）

统计口径约束：

- `/min` 按仿真时间计算，不受 `1x/2x/4x/16x` 影响。
- 统计仅基于仓库，不受当前地图设备增减直接影响。
- 孤立物流段不影响仓库统计；删除孤立物流仅触发拓扑重建，不需要额外统计补偿。

排序：矿物优先，其余按 `itemId` 字母序。

## 8. 性能优化实现（2026-02）

### 8.1 调度模型：`requestAnimationFrame + accumulator`

- 为降低高倍速（尤其 `4x/16x`）下的节拍抖动，仿真调度从固定间隔定时器改为：
	- 浏览器帧驱动（`requestAnimationFrame`）
	- 时间累积器（`accumulator`）
	- 每帧按累积时间批量执行多个 tick
- 建议增加“单帧最大 tick 上限”（例如 `maxTicksPerFrame`），防止掉帧后一次性补偿过多 tick 造成长任务。

推荐伪代码：

```text
onFrame(now):
	delta = now - last
	accumulator += delta
	ticksToRun = floor(accumulator / stepMs)
	ticksToRun = min(ticksToRun, maxTicksPerFrame)
	if ticksToRun > 0:
		accumulator -= ticksToRun * stepMs
		批量执行 tickSimulation(ticksToRun 次)
	requestAnimationFrame(onFrame)
```

说明：

- `stepMs = 1000 / (tickRateHz * speed)`。
- 该模型目标是“稳定吞吐 + 可控补偿”，而不是严格按固定毫秒触发回调。

### 8.2 统计窗口：环形缓冲（Ring Buffer）

- 旧实现问题：每 tick 通过 `[...]` 复制 `minuteWindowDeltas` 并全窗口重算，易在高倍速触发周期性 GC 抖动。
- 新口径：
	- 使用固定容量环形缓冲保存最近 60 秒 tick 增量
	- 写入新 tick 前先移除即将被覆盖槽位对累计值的影响
	- 增量加入当前 tick，再更新 `/min` 聚合值
- 推荐状态字段：
	- `minuteWindowDeltas`
	- `minuteWindowCursor`
	- `minuteWindowCount`
	- `minuteWindowCapacity`

该方案将统计更新复杂度稳定在 O(物品种类数)，避免与窗口长度线性相关。

### 8.3 Tick 内对象分配治理

- 继续建议（后续迭代可选）：
	- 减少“每 tick 全量 clone runtime”
	- 改为“按脏实例局部拷贝/局部写回”
- 目标：降低持续分配压力，进一步削弱高倍速下的 GC 峰值。

### 8.4 性能验收建议

- 复测场景固定：同布局下分别录制 `1x/2x/4x/16x`。
- 重点观察：
	- Main 线程长任务分布是否由“周期尖峰”转为平滑
	- React `beginWork` 占比是否下降
	- 实测 Tick/s 是否更贴近期望值

