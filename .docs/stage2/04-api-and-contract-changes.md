# Stage2 接口与契约变化

## 1. 文档目的

- 记录 Stage2 对状态模型、交互事件、可选集合规则的增量变化。
- 为后续新需求评审提供“兼容边界”参考。

## 2. 变更清单（v0）

| 类型 | 名称 | 变更类型 | 兼容级别 | 说明 |
|---|---|---|---|---|
| State | 规划器目标列表 | 新增 | 兼容 | 新增目标物品与吞吐集合，不影响 Stage1 状态 |
| State | 规划器地区上下文 | 新增 | 兼容 | 新增地区筛选上下文，支持四号谷地/武陵 |
| State | 规划器配方选择映射 | 新增 | 兼容 | 按物品记录手动选择配方，未设置时走默认 |
| State | 浮窗位置与显示状态 | 新增 | 兼容 | 支持关闭重开保留状态 |
| State | 设备电力属性 | 新增 | 兼容 | 所有设备新增耗电属性，部分设备新增发电属性 |
| State | 电力统计窗口 | 新增 | 兼容 | 发电/耗电新增即时值、10 分钟均值、1 小时均值 |
| State | 流体工业要素 | 新增 | 部分兼容 | 新增管道实体、管道端口元数据、流体配方标记 |
| State | 抽水泵扩展区状态 | 新增 | 部分兼容 | 新增抽水泵（清水无限资源）与扩展区域放置标记 |
| State | 抽水泵效率与接网属性 | 新增 | 部分兼容 | 抽水泵输出效率由领域模型提供；具备耗电属性且可凭空接入电网 |
| State | 物品分类修正（紫晶矿） | 修改 | 兼容 | 紫晶矿补充为矿物（固体）分类 |
| State | 瓶装液体组合物品 | 新增 | 部分兼容 | 新增 20 个隐藏组合物品（4 瓶型 × 5 液体） |
| State | 瓶装液体选择器状态 | 新增 | 兼容 | 新增瓶型/液体选择状态，不改变旧选择器结构 |
| State | 武陵建筑上限状态 | 新增 | 部分兼容 | 新增地区建筑上限配置与已放置计数状态 |
| State | 武陵建筑上限来源 | 新增 | 兼容 | 上限 `N` 由领域模型配置提供 |
| State | 管道系统液体锁定 | 新增 | 部分兼容 | 新增管道系统当前液体类型锁定与排空状态 |
| State | 反应池缓存与路由状态 | 新增 | 部分兼容 | 新增 3 固体缓存位、2 液体缓存位、配方选择与产物路由配置 |
| State | 水培设备注册状态 | 新增 | 部分兼容 | 新增水培设备实体注册（当前为待补领域模型） |
| Rule Contract | 配方候选过滤规则 | 修改 | 部分兼容 | 可选配方受地区与条件配方规则共同约束 |
| Rule Contract | 地区流体可用性规则 | 新增 | 部分兼容 | 武陵地区开放流体工业内容，四号谷地过滤武陵专属内容 |
| Rule Contract | 管道传染规则 | 新增 | 部分兼容 | 同一管道系统单液体锁定，异液输入在排空前阻塞 |
| Rule Contract | 扩展区域流体放置规则 | 新增 | 部分兼容 | 武陵扩展区域允许放置抽水泵/管道/储水罐/管路设备 |
| Rule Contract | 抽水泵放置规则 | 新增 | 部分兼容 | 抽水泵仅允许放置在扩展区域，基地内放置失败 |
| Rule Contract | 紫晶矿分类规则 | 修改 | 兼容 | 紫晶矿按矿物（固体）规则参与过滤与运输判定 |
| Rule Contract | 瓶装液体可见性规则 | 新增 | 部分兼容 | 瓶装液体组合项默认隐藏，不在通用列表平铺 |
| Rule Contract | 瓶装液体匹配规则 | 新增 | 部分兼容 | 特定瓶型配方需精确匹配组合项；瓶型无关配方允许任意瓶型 |
| Rule Contract | 瓶型无关配方展开规则 | 新增 | 部分兼容 | UI 单条展示，执行层按瓶型展开为隐藏配方集合 |
| Rule Contract | 带瓶配方匹配规则 | 新增 | 部分兼容 | 除反应池外，设备按收到输入物品匹配配方；反应池不使用带瓶配方 |
| Rule Contract | 返瓶规则 | 新增 | 部分兼容 | 返瓶配方按输入瓶型返还对应瓶子 |
| Rule Contract | 武陵建筑上限规则 | 新增 | 部分兼容 | 特定建筑在武陵受 N 上限约束，超限放置失败 |
| Rule Contract | 武陵上限地区隔离规则 | 新增 | 部分兼容 | 武陵上限不影响四号谷地同类建筑放置 |
| Rule Contract | 桥接器通道隔离规则 | 新增 | 部分兼容 | 桥接器两通道独立，不跨通道传染 |
| Rule Contract | 反应池执行规则 | 新增 | 部分兼容 | 放置时手动选配方，未选不生产，多配方可并行 |
| Rule Contract | 反应池产物路由规则 | 新增 | 部分兼容 | 产物按用户指定缓存/端口送出，三条输出通道不共享 |
| Rule Contract | 水培设备建模规则 | 新增 | 部分兼容 | 形态切换能力以独立设备实现，不支持运行时切换 |
| Rule Contract | 循环处理规则 | 修改 | 部分兼容 | 农业闭环不视为异常，其余循环仍截断处理 |
| Rule Contract | 已知循环白名单规则 | 新增 | 部分兼容 | 已知循环按专项规则处理（当前：种植闭环、蓝铁块/蓝铁粉末互转），未知循环才截断 |
| Rule Contract | 电力运行规则 | 修改 | 部分兼容 | 电力不足不触发停机/降速，但接入电网前置约束保留 |
| Rule Contract | 电力时间口径 | 新增 | 部分兼容 | 电力统计统一基于标准秒，不使用现实时间 |
| Rule Contract | 标准秒换算口径 | 新增 | 兼容 | 沿用 Stage1：`1 秒 = 20 tick`、`1 分钟 = 1200 tick`，不受倍速影响 |
| UX Contract | Toast 触发策略 | 修改 | 兼容 | 高频显式操作静默，失败/异常/关键成功保留 |

## 3. Breaking Changes（当前结论）

- 当前未确认硬 Breaking API。
- 风险项：若外部调用依赖“未过滤配方全集”“统一循环异常提示”或“电力缺口即停机”语义，则在 Stage2 上属于行为变化。

## 4. 兼容窗口

- 过渡版本：Stage2 全周期内保留 Stage1 主流程兼容。
- 废弃截止：待后续 Stage3 规划确定。
- 清理计划：已废弃的 toast 文案键进入分批清理，避免一次性大规模删除影响排查。

## 5. 契约示例（伪代码）

### 5.1 旧行为（Stage1）

```ts
// Stage1 不涉及规划器目标、地区切换、流体工业要素与配方手动切换
const recipes = getAllRecipesForItem(itemId)
const result = simulateOrCalculate(recipes)
```

### 5.2 新行为（Stage2）

```ts
const candidateRecipes = getAllRecipesForItem(itemId)
const regionFiltered = filterRecipesByRegion(candidateRecipes, region)
const conditionalFiltered = filterConditionalRecipes(regionFiltered, aggregatedDemand)
const recipe = pickUserSelectedOrDefault(itemId, conditionalFiltered)
const fluidReady = validateFluidTopology(pipes, machines, recipe)
const fluidLock = resolveFluidSystemLock(fluidSystem)
const canInject = canInjectFluid(fluidSystem, inputFluid, fluidLock) // 异液且未排空 => false
const canPlacePump = validatePlacementRegion('water_pump', tileRegion) // 仅扩展区域 => true
const extensionFluidAllowed = validateExtensionFluidPlacement(region, deviceType) // 武陵扩展区域放置流体设施
const amethystOreCategory = getItemCategory('item_amethyst_ore') // mineral(solid)
const bottledItem = resolveBottledLiquidItem(bottleType, liquidType) // hidden item
const displayRecipes = collapseBottleInsensitiveRecipes(rawRecipes) // UI 单条
const runtimeRecipes = expandBottleInsensitiveRecipes(displayRecipes, bottleTypes) // 执行层按瓶型展开
const limitN = getRegionalPlacementLimit('wuling', 'building_tianyou_furnace') // N
const canPlaceTianyou = canPlaceByRegionLimit('wuling', 'building_tianyou_furnace', placedCount, limitN)
const canPlaceTianyouInValley = canPlaceByRegionLimit('valley4', 'building_tianyou_furnace', placedCount, null) // 武陵上限不外溢
const reactorPlan = getReactorSelectedRecipes(reactorId)
const reactorActive = reactorPlan.length > 0
const routedOutputs = routeReactorOutputs(reactorId, reactorPlan, outputRoutingConfig)
const hydroponicEnabled = isDeviceRegistered('item_farmer_hydroponic')
const result = calculatePlan(recipe, aggregatedDemand)
const powerNow = summarizePowerNow(result.machines)
const powerAvg10m = summarizePowerRolling(result.machines, 600)   // 600 标准秒
const powerAvg1h = summarizePowerRolling(result.machines, 3600)   // 3600 标准秒

// 注意：电力信息用于展示，不参与停机判定
const canRun = isConnectedToGrid(machine) // 仅保留接网前置约束
```
