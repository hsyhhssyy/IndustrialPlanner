# Stage1 数据字典（Draft）

## 1. 通用约定

- `id` 均为字符串且在其作用域内唯一。
- 坐标与尺寸使用网格单位（整数）。
- 数量默认非负。

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
type SimulationSpeed = 0 | 1 | 2 | 4
```

字段约束：

- `0` 表示暂停
- `1` 表示基准速率（配置数据基准）
- `2` 与 `4` 为倍速推进

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

## 2.11 RuntimeRule

```ts
type RuntimeRule = {
  needsPower?: boolean
  canExportOutside?: boolean
  exportRatePerMin?: number
  externalSourceItemFilter?: "any"
}
```

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

## 2.13 PowerCoverage

```ts
type PowerCoverage = {
  poleMachineId: string
  area: { width: 8; height: 8 }
  anchor: "center"
  metric: "rect"
}
```

字段约束：

- 供电范围为以供电桩中心为基准的 8x8 矩形格子
- 建筑任一格落在范围内即判定有电

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
  ore: 0,
  ingot: 0,
  gear: 0,
}
```

说明：

- `ore` 可视为无限来源，不因库存为 0 而阻塞采矿逻辑。
- 为便于统一统计，建议仍保留 `ore` 项进行消耗与产量展示。

## 5. 实现边界说明

- 本数据字典为引擎无关定义，不依赖任何游戏引擎对象模型。
- Stage1 按浏览器前端运行约束设计，不引入游戏引擎运行时字段。
