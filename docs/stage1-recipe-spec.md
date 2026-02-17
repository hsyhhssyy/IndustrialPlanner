# Stage1 配方规范（Draft）

## 1. 目标

- 支持“每个物品可对应多个配方”。
- 配方统一表达为：`xA + yB + z... -> n 秒 -> m 个目标产物`。
- 数据结构需兼容“一个配方产出两种物品且走不同出口”的未来能力。

## 1.1 首批冻结物品

- `originium_ore`（源石矿）：只能由物品取货口提供。
- `originium_powder`（原矿粉末）：由粉碎机配方产出。

## 2. 数据结构

```ts
type RecipeIO = {
  itemId: string
  amount: number
}

type RecipeOutput = {
  itemId: string
  amount: number
  outPortId?: string
}

type Recipe = {
  id: string
  name: string
  machinePrototypeId: string
  timeSec: number
  inputs: RecipeIO[]
  outputs: RecipeOutput[]
  oreCost?: number
  powerCost?: number
  stage1Enabled: boolean
}

type ProductRecipeIndex = Record<string, string[]>
```

说明：

- `outputs.length = 1`：Stage1 可直接运行。
- `outputs.length = 2`：视为“多产物兼容配方”，Stage1 先不启用运行（`stage1Enabled = false`）。
- `outPortId` 用于未来将产物绑定到指定出口。

## 3. Stage1 运行约束

- Stage1 仅执行 `stage1Enabled = true` 且自动匹配成功的配方。
- Stage1 不提供手动选配方；机器根据输入物品自动决定可执行配方。
- 同一机器类型下，输入物品组合必须唯一决定 1 个配方。
- 若自动匹配结果为 0 个或大于 1 个，机器必须报错并停止该机结算。
- Stage1 运行时仅处理单产物输出配方。
- 多产物配方必须能被读取、展示与存档，但不进入结算执行。

推荐错误文案（可本地化调整）：

- 0 个匹配：`配方决策失败：当前输入无法匹配配方`
- 多个匹配：`配方决策冲突：当前输入匹配到多个配方`

## 4. 首批示例（可调整）

## 4.1 物品与配方索引

```ts
const productRecipeIndex: ProductRecipeIndex = {
  originium_powder: ["r_crusher_originium_powder_basic"],
}
```

## 4.2 配方样例

```ts
const recipes: Recipe[] = [
  {
    id: "r_crusher_originium_powder_basic",
    name: "原矿粉碎（基础）",
    machinePrototypeId: "crusher_3x3",
    timeSec: 2,
    inputs: [{ itemId: "originium_ore", amount: 1 }],
    outputs: [{ itemId: "originium_powder", amount: 1 }],
    powerCost: 1,
    stage1Enabled: true,
  },
  {
    id: "r_future_dual_output",
    name: "未来双产物示例",
    machinePrototypeId: "crusher_3x3",
    timeSec: 6,
    inputs: [{ itemId: "originium_ore", amount: 2 }],
    outputs: [
      { itemId: "originium_powder", amount: 1, outPortId: "out_main" },
      { itemId: "slag", amount: 1, outPortId: "out_side" },
    ],
    powerCost: 2,
    stage1Enabled: false,
  },
]
```

## 4.3 物品来源约束

```ts
const items = [
  { id: "originium_ore", name: "源石矿", source: "external_pickup_only" },
  { id: "originium_powder", name: "原矿粉末", source: "recipe_output" },
]
```

说明：

- `originium_ore` 不允许被任何配方产出。
- `originium_ore` 仅允许由物品取货口输入系统。

## 5. 兼容性与迁移

- 现阶段 UI 可展示双产物配方条目，但应标注“暂未开放”。
- 当未来启用双产物时，仅需打开 `stage1Enabled` 或阶段开关，不需要改动基础 schema。
