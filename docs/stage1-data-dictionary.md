# Stage1 数据字典（Draft）

## 1. 通用约定

- `id` 均为字符串且在其作用域内唯一。
- 坐标与尺寸使用网格单位（整数）。
- 数量默认非负。

## 1.1 地块尺寸

```ts
type GridSize = 60 | 80 | 100

type PlotId = string
```

字段约束：

- Phase1 仅允许 `60x60`、`80x80` 与 `100x100`
- 默认地块尺寸为 `60x60`
- Phase1 暂以尺寸值作为 `PlotId`（如 `"60"`、`"80"`、`"100"`）
- 未来可扩展为“地块名（PlotId） + 尺寸（GridSize）”，允许多个同尺寸地块

## 2. 核心实体

## 2.1 Machine

```ts
type Machine = {
  id: string
  prototypeId: string
  x: number
  y: number
  w: number
  h: number
  rotation: 0 | 90 | 180 | 270
  recipeId: string
  speed: number
  enabled: boolean
  progress: number
  placementState: "valid" | "overlap" | "invalid_boundary"
  statusIcon?: "starved" | "blocked_overlap" | "unpowered"
  ports: Port[]
}
```

字段约束：

- `w`, `h` > 0
- `rotation` 仅允许 0/90/180/270
- `speed` > 0，默认 1
- `progress` >= 0，范围建议 `[0, recipe.time)`
- `placementState = overlap` 或 `invalid_boundary` 时机器不可结算生产

## 2.2 Port

```ts
type Port = {
  id: string
  type: "in" | "out"
  offsetX: number
  offsetY: number
}
```

字段约束：

- `offsetX`, `offsetY` 为机器局部坐标
- `type` 仅允许 `in` 或 `out`

## 2.3 Edge

```ts
type Edge = {
  id: string
  mode: "belt" | "pipe"
  from: { machineId: string; portId: string }
  to: { machineId: string; portId: string }
  path: Array<{ x: number; y: number }>
}
```

字段约束：

- `from` 必须引用 `out` 端口
- `to` 必须引用 `in` 端口
- 不允许重复边（同 `from` + `to`）
- `path` 为用户手绘网格路径点序列
- `mode` 对应物流模式

## 2.4 Recipe

```ts
type RecipeOutput = {
  itemId: string
  amount: number
  outPortId?: string
}

type Recipe = {
  id: string
  name: string
  time: number
  inputs: Record<string, number>
  outputs: RecipeOutput[]
  oreCost?: number
  powerCost?: number
  stage1Enabled: boolean
}
```

字段约束：

- `time` > 0
- `inputs` 中数量为正整数
- `outputs` 数组至少 1 项，`amount` 为正整数
- `outputs.length > 1` 代表多产物配方；Stage1 仅兼容读取，不启用结算
- `oreCost`、`powerCost` 若存在则为非负数
- `stage1Enabled = true` 才允许在 Stage1 运行

## 2.5 Inventory

```ts
type Inventory = Record<string, number>
```

字段约束：

- `Inventory` 在 Stage1 表示系统外仓库库存（全局库存）
- 不包含工业地块内机器、物流系统与仓储建筑中的物品
- key 为 `itemId`
- value 为整数且 >= 0

## 2.5A ItemDefinition

```ts
type ItemDefinition = {
  id: string
  name: string
  source: "external_pickup_only" | "recipe_output"
}
```

字段约束：

- `originium_ore` 的 `source` 必须为 `external_pickup_only`
- `originium_powder` 的 `source` 必须为 `recipe_output`

## 2.6 MachineRuntimeState

```ts
type MachineRuntimeState = {
  machineId: string
  status: "running" | "starved" | "paused" | "disabled" | "blocked_overlap" | "blocked_boundary" | "unpowered"
  missingInputs?: string[]
}
```

字段约束：

- `status = starved` 时建议提供 `missingInputs`
- `status = blocked_overlap` 表示因重叠导致停机
- `status = blocked_boundary` 表示边缘摆放规则不满足

## 2.7 SimulationSpeed

```ts
type SimulationSpeed = 1 | 2 | 4
```

字段约束：

- `1` 表示基准速率（配置数据基准）
- `2` 与 `4` 为倍速推进

## 2.7A AppMode

```ts
type AppMode = "edit" | "simulate"
```

字段约束：

- `edit`：允许编辑工业区内容
- `simulate`：锁定编辑，仅允许仿真控制（退出仿真、1x/2x/4x）

## 2.8 BuildingPrototype

```ts
type BuildingPrototype = {
  id: string
  name: string
  category: "io" | "production" | "logistics" | "power"
  size: { w: number; h: number }
  rotatable: boolean
  placementRule: PlacementRule
  portLayout: PortLayout
  runtimeRule?: RuntimeRule
}
```

## 2.8A PickupPortConfig

```ts
type PickupPortConfig = {
  machineId: string
  selectedItemId: string | null
  showUnselectedIcon: boolean
  outputSide?: "top" | "right" | "bottom" | "left"
}
```

字段约束：

- 物品取货口放置后默认 `selectedItemId = null`
- 仅在用户于右下详情面板选择后开始出货
- `selectedItemId = null` 时 `showUnselectedIcon = true`
- `outputSide` 为可选方向字段，Phase1 可不配置；若配置则用于显式指定出口朝向

## 2.9 PlacementRule

```ts
type PlacementRule = {
  allowOverlap: boolean
  requireLongEdgeOnBoundary?: boolean
  requiredBoundarySide?: "top" | "right" | "bottom" | "left" | "any"
}
```

## 2.10 PortLayout

```ts
type PortLayout = {
  inPorts: Array<{ id: string; offsetX: number; offsetY: number }>
  outPorts: Array<{ id: string; offsetX: number; offsetY: number }>
}
```

字段约束：

- 配置文件仅保存 0° 朝向端口坐标
- 90°/180°/270° 端口坐标由运行时旋转计算

## 2.10A PortRotationTransform

```ts
type PortRotationTransform = {
  baseRotation: 0
  allowedRotations: [0, 90, 180, 270]
}
```

计算约束（局部坐标，建筑尺寸为 `w x h`）：

- 0°：`(x, y)`
- 90°：`(h - 1 - y, x)`
- 180°：`(w - 1 - x, h - 1 - y)`
- 270°：`(y, w - 1 - x)`

说明：

- 仅支持 90° 步进旋转，因此端口坐标计算结果保持整数网格。

## 2.11 RuntimeRule

```ts
type RuntimeRule = {
  needsPower?: boolean
  canExportOutside?: boolean
  exportRatePerMin?: number
  externalSourceItemFilter?: "any"
}
```

## 2.11A ExternalWarehouse

```ts
type ExternalWarehouse = {
  inventory: Record<string, number>
  infiniteItems: string[]
}
```

字段约束：

- 系统外仓库容量无限
- `originium_ore` 必须在 `infiniteItems` 中
- 其他物品由存储箱提交量累积，不可无限取用
- Phase1 不提供仓库手动清空操作
- 退出仿真或执行重置库存时，`inventory` 必须被清空到初始状态

## 2.12 ConveyorCellRule

```ts
type ConveyorCellRule =
  | { kind: "cross"; links: [["N", "S"], ["W", "E"]] }
  | { kind: "split"; in: "N" | "E" | "S" | "W"; out: ["N" | "E" | "S" | "W", "N" | "E" | "S" | "W", "N" | "E" | "S" | "W"] }
  | { kind: "merge"; in: ["N" | "E" | "S" | "W", "N" | "E" | "S" | "W", "N" | "E" | "S" | "W"]; out: "N" | "E" | "S" | "W" }
```

字段约束：

- 传送带格子不允许重叠
- 仅允许 `cross`、`split`、`merge` 三种操作
- `split` 与 `merge` 的三路顺序采用左/中/右轮询
- 左/中/右顺序以顺时针方向定义

## 2.12A ConveyorSpec

```ts
type ConveyorSpec = {
  secondsPerCell: 2
}
```

字段约束：

- 传送带速度固定为每 2 秒移动 1 格

## 2.12B ConveyorDeleteMode

```ts
type ConveyorDeleteMode = "by_cell" | "by_connected_component"
```

字段约束：

- `by_cell`：逐格删除
- `by_connected_component`：删除联通传送带整体
- 联通采用 4 邻接（上/下/左/右）

## 2.14 PanelDisplayRule

```ts
type PanelDisplayRule = {
  itemSort: "ore_first_then_powder_then_itemId"
  unselectedPickupIcon: "?"
}
```

字段约束：

- 物品排序：`originium_ore` 优先，其次 `originium_powder`，其余按 `itemId` 字母序
- 取货口未选图标固定为 `?`

## 2.13 PowerCoverage

```ts
type PowerCoverage = {
  poleMachineId: string
  area: { width: 12; height: 12 }
  anchor: "center"
  metric: "rect"
}
```

字段约束：

- 供电范围为以供电桩中心为基准的 12x12 矩形格子
- 供电桩 2x2 本体位于该 12x12 矩形中心区域
- 建筑任一格落在范围内即判定有电
- 若供电桩左上角为 `(x, y)`，则供电范围左上角固定为 `(x - 5, y - 5)`，宽高固定为 `12x12`
- 覆盖范围超出工业区域边界时，按工业区域边界裁剪后再做“任一格落入”判定

## 3. 典型建筑模板（首批）

### 3.1 物品取货口（唯一外部进料口）

- 尺寸：3x1
- 摆放：长边必须贴工业区域边缘
- 端口：中间格唯一 `out` 端口
- 行为：可配置输出任意一种物品

### 3.2 粉碎机

- 尺寸：3x3
- 端口：一整边 3 个 `in`，对边 3 个 `out`

### 3.3 供电桩

- 尺寸：2x2
- 行为：为范围内建筑提供通电状态

### 3.4 物流存储箱

- 尺寸：3x3
- 端口：一整边 `in`，对边 `out`
- 行为：存储 + 可配置每分钟向系统外提交

### 3.5 灌装机

- 尺寸：6x4
- 端口：两条长边共 12 个端口，一侧 `in` 一侧 `out`

### 3.6 传送带节点

- 不允许重叠
- 支持交叉、分流、汇流

## 4. Stage1 最小示例

```ts
const inventory: Inventory = {
  originium_ore: 0,
  originium_powder: 0,
}
```

说明：

- `ore` 可视为无限来源，不因库存为 0 而阻塞采矿逻辑。
- 为便于统一统计，建议仍保留 `ore` 项进行消耗与产量展示。

## 5. 实现边界说明

- 本数据字典为引擎无关定义，不依赖任何游戏引擎对象模型。
- Stage1 按浏览器前端运行约束设计，不引入游戏引擎运行时字段。
