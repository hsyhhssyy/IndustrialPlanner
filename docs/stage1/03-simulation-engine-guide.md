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

- 仅当下游在 Commit 后将有容量，才允许推进到 `> 0.5`
- 下游不可接收时，停靠在 `0.5`

## 4. Reservation 规则

下游“本 tick 可接收”定义：

1. 当前为空，或本 tick 末将腾空
2. 且入口尚未被其他上游预留
3. 冲突时停机，stallReason=OUTPUT_BLOCKED

## 4.1 `CONFIG_ERROR` 判定时机

- 所有配置型错误在“进入仿真”时统一校验。
- 校验失败的设备在仿真开始即标记 `stallReason=CONFIG_ERROR`。
- 不等待运行到具体设备逻辑再触发。

## 5. runtimeKind 运行逻辑

## 5.1 `processor`

- 输入端口共享 `inputBuffer`
- 输出端口共享 `outputBuffer`
- 满足配方输入后推进 `progress01`
- 完成周期时向 `outputBuffer` 生成产物

## 5.2 `conveyor` / `junction`

- `conveyor`：单槽位 `slot`，容量固定 1
- `junction`：按设备语义分配槽位
	- `splitter` / `merger`：单槽位
	- `bridge`：双通道双槽位（`nsSlot` 与 `weSlot` 独立）
- `bridge` 通道映射固定为：`N->S`、`S->N`、`W->E`、`E->W`
- 禁止同边回送与跨通道转向（如 `N->N`、`N->E`）
- `progress01` 表示槽内物品运输进度
- 到达提交点后执行向下游交付

供电规则补充：仅 `requiresPower=true` 的设备参与供电判定；Stage1 中仅 `crusher_3x3` 需要供电。

## 5.3 `storage`

- 提供仓库存取能力
- 可接入传送带或设备端口
- 不承担生产周期逻辑
- 当 `submitToWarehouse=true` 时，按仿真时间每 10 秒 触发一次批量提交，将该存储箱内所有物品一次性提交到仓库

## 6. 仿真控制行为

- **开始仿真**：初始化全部 runtime state、统计采样器，并重置仓库库存为统一初始值（`originium_ore=∞`，其他物品=`0`）
- **退出仿真**：清空设备进度、仓库统计快照、仓库物品数量、临时队列
- **倍速切换**：仅影响单位真实时间内 tick 数，不改变单 tick 规则

## 7. 统计口径

统计面板至少输出：

- 仓库当前库存总量
- 仓库物品变化速率（/min）

统计口径约束：

- `/min` 按仿真时间计算，不受 `1x/2x/4x/16x` 影响。
- 统计仅基于仓库，不受当前地图设备增减直接影响。
- 孤立物流段不影响仓库统计；删除孤立物流仅触发拓扑重建，不需要额外统计补偿。

排序：矿物优先，其余按 `itemId` 字母序。

