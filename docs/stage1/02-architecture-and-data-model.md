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
- `size: { width: number; height: number }`
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

## 3.4 统一运行态 `RuntimeState`

所有设备至少包含：

- `progress01: number`（区间 `[0,1]`）
- `stallReason: 'NONE' | 'NO_POWER' | 'OVERLAP' | 'NO_INPUT' | 'OUTPUT_BLOCKED' | 'CONFIG_ERROR'`
- `isStalled: boolean`（派生）

按 `runtimeKind` 扩展：

- `processor`: `inputBuffer`, `outputBuffer`
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
