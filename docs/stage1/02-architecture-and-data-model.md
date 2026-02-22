# 02 架构与数据模型指南

## 1. 技术边界

- 纯前端、可离线运行、无后端依赖
- 本地存档使用 `localStorage`
- 可部署至 GitHub Pages
- 不依赖游戏引擎

## 2. 推荐模块分层

建议采用“静态定义 + 运行时状态 + 系统服务”三层结构：

1. **Definition 层（静态定义）**
   - 设备类型定义（尺寸、端口、默认参数、`runtimeKind`）
   - 配方定义（输入输出、周期；周期字段使用标准秒，如 `cycleSeconds`）
   - 物品定义（id、显示名、UI 元信息）

2. **Domain 层（网格与拓扑）**
   - 地块、设备实例、朝向、占格
   - 端口旋转映射与邻接判定
   - 编辑态命令（放置、旋转、移动、删除、铺带）

3. **Runtime 层（仿真状态）**
   - 每设备运行态（`progress01`, `stallReason` 等）
   - Tick 调度与 Plan/Commit
   - 统计采样与聚合

4. **UI 层（展示与交互）**
   - 顶栏控制、左栏工具、画布、右栏信息
   - 编辑模式机与选中态管理
   - 状态可视化（阻塞/缺料/无电等）

## 3. 核心实体（建议字段）

## 3.1 设备类型定义 `DeviceTypeDef`

- `id: string`
- `runtimeKind: 'processor' | 'storage' | 'conveyor' | 'junction'`
- `requiresPower: boolean`
- `tags?: string[]`（可选；用于标记建筑特性，如“武陵”）
- `size: { width: number; height: number }`
- `inputBufferSlots?: number`（仅 `processor`；输入缓存可并存物品种类数）
- `outputBufferSlots?: number`（仅 `processor`；输出缓存可并存物品种类数）
- `inputBufferSlotCapacities?: number[]`（仅 `processor`；输入缓存按槽位容量上限）
- `outputBufferSlotCapacities?: number[]`（仅 `processor`；输出缓存按槽位容量上限）
- `ports0: PortDef[]`（仅 0°）
- `display: { shortName?: string }`

## 3.2 端口定义 `PortDef`

- `id: string`
- `localCellX: number`
- `localCellY: number`
- `edge: 'N' | 'S' | 'E' | 'W'`
- `direction: 'Input' | 'Output'`
- `allowedItems: { mode: 'recipe_items' | 'recipe_inputs' | 'recipe_outputs' | 'whitelist' | 'any'; whitelist: string[] }`
- `allowedTypes: { mode: 'whitelist' | 'solid' | 'liquid'; whitelist: string[] }`

## 3.3 设备实例 `DeviceInstance`

- `instanceId: string`
- `typeId: string`
- `origin: { x: number; y: number }`（左上角）
- `rotation: 0 | 90 | 180 | 270`
- `config: Record<string, unknown>`（如 pickup 选矿）
   - `pickupItemId?: ItemId`（取货口）
   - `submitToWarehouse?: boolean`（存储箱）
   - `preloadInputs?: Array<{ slotIndex: number; itemId: ItemId; amount: number }>`（processor 编辑态按槽位预置输入）

## 3.4 统一运行态 `RuntimeState`

所有设备至少包含：

- `progress01: number`（区间 `[0,1]`）
- `stallReason: 'NONE' | 'NO_POWER' | 'OVERLAP' | 'NO_INPUT' | 'OUTPUT_BLOCKED' | 'CONFIG_ERROR'`
- `isStalled: boolean`（派生）

按 `runtimeKind` 扩展：

- `processor`: `inputBuffer`, `outputBuffer`
   - 槽位由 `inputBufferSlots/outputBufferSlots` 约束
   - 每个槽位容量由 `inputBufferSlotCapacities/outputBufferSlotCapacities` 约束
   - 槽位容量**不共享**，并且不同槽位上限可不一致
   - 当槽位=1时，缓存非空后仅接受当前缓存物品类型
- `conveyor`: `slot`（容量 1）
- `junction`: 按设备语义定义槽位（`splitter/merger` 为单 `slot`，`bridge` 为 `nsSlot + weSlot`）
- `storage`: `inventory`

供电扩展约束：

- 仅当设备 `requiresPower=true` 时，才参与 `NO_POWER` 判定。
- Stage1 当前仅 `item_port_grinder_1` 为 `requiresPower=true`。

## 4. 坐标与旋转

- 所有端口定义只维护 0° 基准。
- 运行时按旋转角度计算端口落点与朝向。
- 旋转中心为设备几何中心。
- 设备文本不跟随旋转翻转（仅图形逻辑旋转）。

## 5. 拓扑与连接缓存

建议在编辑态变更后重建以下缓存，以降低 Tick 成本：

- `occupiedCell -> instanceId`
- `portEndpoint -> neighborEndpoint?`
- `instanceId -> runtimeNeighbors`（入邻居、出邻居）

重建触发：放置、删除、旋转、移动、铺带。

## 6. 存档模型（localStorage）

建议最小存档内容：

- 地块基础信息
- 设备实例列表
- 用户配置（如默认模式、最近速度）

不建议持久化运行中瞬态（如本 tick 计划队列）。

## 7. 错误处理策略

- 配置非法：标记 `CONFIG_ERROR`
- 设备重叠：标记 `OVERLAP`
- 输入不足：`NO_INPUT`
- 输出阻塞：`OUTPUT_BLOCKED`
- 未被供电覆盖或供电条件异常：`NO_POWER`

供电边界补充（Stage1）：供电桩 `2x2` 位于一个 `12x12` 供电正方形区域的几何中心，建筑任意占格落入该区域即视为有电。

错误来源应可追踪到设备级，供右侧面板展示。

## 8. 项目级领域数据源

项目统一领域数据定义请以 [docs/domain-model-data.yaml](../domain-model-data.yaml) 为准。

- Stage1 文档负责说明实现原则与边界。
- 项目级数据文件负责承载可直接编码消费的设备/端口/规则数据。

## 9. 性能架构实践（2026-02）

本节沉淀 Stage1 在仿真高倍速场景（`4x/16x`）下的性能改造口径。

### 9.1 UI 渲染分层（避免每 tick 全量重渲）

- 画布渲染拆分为“静态层 + 运行态层”：
   - 静态层：设备几何、纹理、名称、固定端口视觉（仅依赖 `layout`）
   - 运行态层：在途物品、停机覆盖、调试态信息（依赖 `sim.runtimeById`）
- 静态层组件使用 memo 化（如 `React.memo`），确保仿真 tick 变化不触发静态设备节点重建。
- 运行态异常高亮采用覆盖层实现，避免把“停机样式判定”耦合回静态设备大循环。

### 9.2 布局级缓存（Layout-Scoped Cache）

- 对与 `layout` 强相关、且在仿真运行期间基本不变的结构进行缓存：
   - `layout -> neighbors graph`
   - `layout -> deviceById`
- 建议实现为弱引用缓存（如 `WeakMap<LayoutState, ...>`），并遵循：
   - `layout` 对象引用变化时自动失效
   - 同一 `layout` 引用下重复 tick 复用缓存

### 9.3 复杂度治理口径

- Tick 主循环中禁止反复线性查找设备（`find`），统一改为 O(1) 映射读取。
- 渲染阶段避免在 `devices.map` 内重复做高频几何推导（端口旋转、路径构造等），应优先预计算或按层拆分。
- 性能问题优先排查顺序：
   1. 是否每 tick 触发根组件重渲
   2. 是否存在 tick 内 O(n²) 级查找/重建
   3. 是否存在周期性对象分配导致 GC 抖动
