---
name: unpack-data-analysis
description: 分析 .temp/json-export.json 解包数据（端口坐标、设备变体、渲染模板等）时使用。防止错误的端口反转或坐标映射结论，规定两套坐标的转换方法与设备属性查找优先级。
---

# 解包数据分析规范

## 核心原则

解包 JSON 中的端口坐标不能直接当作本项目注册表的俯视坐标，也不能根据 `defaultRendererTemplate` 判断非默认变体需要反转输入/输出。

1. `inputPorts` / `outputPorts` 表达端口的输入、输出角色；没有证据表明非默认 renderer 变体会统一反转这两个角色。
2. `position.x` / `position.z` 是游戏三维局部坐标中的平面位置，不能在未归一化时直接标成 W/E/N/S。
3. `rotation.y` 是游戏端口 Transform 的旋转角，不能单独一一映射成本项目的 `edge`。
4. 比较端口时，必须先统一设备 `rotation=0` 的视觉朝向和二维坐标基准，再比较端口语义。

---

## 解包 JSON 中端口字段的含义

`buildings.buildingTable.<id>` 中的 `inputPorts` / `outputPorts`：

- `position: { x, y, z }`：游戏使用的三维局部坐标。
- `position.y`：端口高度；转换为本项目的二维格子端口时通常不参与 `localCellX/localCellY` 计算，但原始数据分析时仍应保留。
- `isOutput: 0 | 1`：`0` 表示输入，`1` 表示输出；它通常与端口所在的 `inputPorts` / `outputPorts` 数组一致。
- `isPipe: true | false`：`true` 表示流体管道端口，`false` 表示固体传送带端口。
- 此处的 `isPipe` 是外部解包 JSON 的原始布尔字段，不是本项目 `RegistryQuery.isPipe(definitionId)`。后者表示"是否为三个管道节之一"；两者不得混用。
- `rotation.y`：游戏局部 Transform 的 Y 轴旋转角，不等价于本项目的 `NORTH/EAST/SOUTH/WEST`。

`defaultRendererTemplate` 只表示默认 renderer 模式。现有数据不足以证明它会改变 `inputPorts` / `outputPorts` 的角色，更不能推出"所有非默认变体都要反转输入输出"。

---

## 两套坐标不能直接比较

### 本项目注册表的二维坐标

本项目 `rotation=0` 时使用：

| 注册表坐标 | 方位 |
|---|---|
| `localCellX = 0` | W（西） |
| `localCellX = width - 1` | E（东） |
| `localCellY = 0` | N（北） |
| `localCellY = height - 1` | S（南） |

### 解包数据中的边界坐标

在没有完成坐标归一化前，只能把解包位置称为原始边界，不能提前赋予本项目的东、西、南、北语义：

| 解包坐标 | 安全表述 |
|---|---|
| `position.x = 0` | 原始 X 最小边界 |
| `position.x = width - 1` | 原始 X 最大边界 |
| `position.z = 0` | 原始 Z 最小边界 |
| `position.z = depth - 1` | 原始 Z 最大边界 |

### 已确认设备组的转换

对精炼炉、种植机、灌装机及其液体端口，当前证据符合：

```text
localCellX = width - 1 - position.x
localCellY = position.z
```

也就是这个设备组的原始 X 轴与本项目横轴方向相反：

| 解包坐标 | 转换后的注册表方位 |
|---|---|
| `position.x = 0` | E（东） |
| `position.x = width - 1` | W（西） |
| `position.z = 0` | N（北） |
| `position.z = depth - 1` | S（南） |

这个转换由三个同类设备交叉验证，但不能在没有校准的情况下直接推广到所有设备。项目中的设备精灵存在 0°、90°、180° 等不同的预处理旋转，其他设备应先确认其 `rotation=0` 视觉基准。

---

## 已确认案例

| 设备 | 解包端口 | 注册表端口 | 结论 |
|---|---|---|---|
| 精炼炉液体输入 | `x=0, z=1, isOutput=0` | `(2,1), EAST, input` | 一致 |
| 精炼炉液体输出 | `x=2, z=1, isOutput=1` | `(0,1), WEST, output` | 一致 |
| 种植机液体输入 | `x=0, z=2, isOutput=0` | `(4,2), EAST, input` | 一致 |
| 灌装机液体输入 | `x=0, z=2, isOutput=0` | `(5,2), EAST, input` | 一致 |

精炼炉的输入管口和输出管口在解包数据中都是 `rotation.y=90`，但转换到本项目后分别位于 E 和 W。这进一步说明：`rotation.y=90` 不能脱离端口位置、端口角色和设备坐标基准直接解释成某个固定方位。

---

## 多变体设备的正确理解

游戏解包数据通常以一个 building 保存设备可能使用的全部端口，本项目则可能按照配方模式拆成多个注册表实体。例如：

- 游戏中的 `furnance_1` 对应本项目的普通精炼炉和液体精炼炉；液体口是 `isPipe: true` 的端口。
- 游戏中的 `planter_1` 对应普通种植机和种植机液体变体。
- 游戏中的 `filling_powder_mc_1` 对应普通、液体等灌装模式。

`rendererTemplateMap`、配方的 `formulaGroupId`、端口的 `isPipe` 和原料/产物类型可以帮助识别变体，但它们不能替代坐标归一化，也不能据此发明"非默认变体统一反转端口"的规则。

---

## 推荐分析步骤

1. 通过 `buildingItemTable` 从物品 ID 找到真实 `buildingId`。
2. 读取 `buildingTable[buildingId]` 的 `range`、`inputPorts`、`outputPorts` 和 `rendererTemplateMap`。
3. 用 `isPipe` 区分管道端口与传送带端口，保留 `inputPorts` / `outputPorts` 的角色语义。
4. 确认本项目对应注册表实体及其 `rotation=0` 精灵朝向；注意精灵同步过程可能包含预旋转。
5. 用至少两个不重合的端口建立该设备的坐标转换，优先同时覆盖输入与输出。
6. 转换为本项目的 `(localCellX, localCellY, edge)` 后再比较。
7. 如果解包数据、精灵朝向和注册表仍不能形成唯一解释，再进行游戏内实测；不能用"非默认变体反转"作为兜底规则。

---

## 对原端口比对结论的订正

"非默认变体应统一反转 W↔E"结论无效，基于它生成的修正清单也不能作为修改注册表的依据。

---

## 设备属性查找优先级

查询任何设备的属性（电力消耗、端口、渲染模板、占地面积等）时，必须以 `buildings.buildingTable.<id>` 作为主数据源。

`buildings` 下的其他子表职责如下：

| 子表 | 存放内容 | 不可用于推断 |
|---|---|---|
| `buildingTable` | **设备主表**：needPower、powerConsume、inputPorts、outputPorts、range、type 等核心属性 | — |
| `machineCrafterTable` | 制造设备的模式分组 | 是否消耗电力 |
| `gasMinerTable` | 气体开采参数（可采气体、开采周期） | 是否消耗电力 |
| `fluidPumpInTable` | 流体泵取参数（可用液体、泵取周期） | 是否消耗电力 |
| `fluidPumpOutTable` | 流体排放参数 | 是否消耗电力 |
| `minerTable` | 采矿参数 | 是否消耗电力 |
| 其他子表 | 领域特有补充参数 | 核心属性 |

**规则**：子表中缺少某字段不代表该设备没有该属性，只能说明该属性不由该子表管理。判断 `needPower`、端口等核心属性时必须查阅 `buildingTable`，子表仅作补充。

另外，原表与当前注册表已经不一致：

- `item_port_gas_reactor_1` 当前是 W 输入、E 输出，不是原表所写的 N/S。
- `liquid_purifier_1_gas` 当前已经是 E 输入、W 输出。
- `transmuter_1_liquidtrans` 当前已经是 E 输入、W 输出。
- `transmuter_2_solidtrans` 当前的气体输入已经在 E。
- `shaper_1_gas` 当前的气体输入已经在 E。

气体收集泵、储气罐、气体反应炉、提纯机、液气/固气转化机、气体散布机等设备不能仅凭原始 `x=0` / `x=width-1` 判定是否与注册表相反；应按上面的步骤逐台校准或游戏内确认。

---

## compare-exported-devices 脚本使用说明

### 用途

`src/scripts/compare-exported-devices.mjs` 根据解包 JSON 自动生成期望的设备 ID、中英文名称，并与项目当前注册的 `entity-definition.ts` 及 i18n 翻译做对账，输出应新增、应移除的设备清单。

### 运行方式

```bash
node src/scripts/compare-exported-devices.mjs [导出文件路径] [--all-exported] [--help]
```

- 默认读取 `.temp/json-export.json`
- 可传入自定义 JSON 路径或目录（目录下需含 `json-export.json`）
- `--all-exported`：对账导出文件中全部具备 buildingItem 映射和 renderer template 的设备（默认只对账当前 registry 已覆盖的原始设备族）
- `--help` / `-h`：打印帮助

### 核心逻辑

1. 解析 `buildings.buildingTable`，逐个设备读取 `rendererTemplateMap`，从中提取 mode（`normal` / `gas` / `liquid` / `gastrans` / `liquidtrans` / `solidtrans` / `gasliquid`）和分组序号。
2. 从 `buildings.buildingItemTable` 建立物品 ID → 设备 ID 的映射。
3. 从解包数据的 `_name` / `_nameEn` 或 `i18n.buildings` 中读取基础中英文名称。
4. 按 mode 生成设备 ID 和带后缀的名称：

| mode | deviceId 格式 | 中文后缀 | 英文后缀 |
|---|---|---|---|
| `normal` | `{buildingId}` | 无 | 无 |
| `gas` | `{buildingId}_gas` | (气体) | (Gas) |
| `liquid` | `{buildingId}_liquid` | (液体) | (Liquid) |
| `gastrans` | `{buildingId}_gastrans` | (气体) | (Gas) |
| `liquidtrans` | `{buildingId}_liquidtrans` | (液体) | (Liquid) |
| `solidtrans` | `{buildingId}_solidtrans` | (固体) | (Solid) |
| `gasliquid` | `{buildingId}_gasliquid` | (气液) | (Gas/Liquid) |

同名 mode 下存在多个变体时，deviceId 追加 `_{groupIndex}`。

5. 使用 TypeScript Compiler API 解析项目中的 `entity-definition.ts`（提取 `createEntityDefinition` 调用中的 `id`、`nameKey`、`tags`）和 i18n 文件（提取 `REGISTRY` 对象中的翻译条目）。
6. 通过设备的 `alter:` / `alter-variant:` tag 将当前实体的 id 映射回原始设备 ID 和对应 mode，然后对账。

### 输出示例

```
# 设备导出对账

- 导出文件：.temp/json-export.json
- 对账范围：当前 registry 已覆盖的原始设备族
- 原始设备族：42
- 当前设备记录：128
- 期望设备记录：130
- 结果：不一致

## 应移除的设备（0）

（无）

## 应新增的设备（2）

| id | 中文 | 英文 | 原始设备 ID | mode | template ID |
| --- | --- | --- | --- | --- | --- |
| furnace_1_gas | 精炼炉(气体) | Furnace (Gas) | furnace_1 | gas | gas__1 |
| planter_1_liquid | 种植机(液体) | Planter (Liquid) | planter_1 | liquid | liquid__1 |
```

### 注意事项

- 脚本假设项目文件的命名规范和 tag 约定不变；如果 `entity-definition.ts` 的结构或 `alter:` tag 规则调整，脚本可能需要同步更新。
- `generateDeviceI18n` 的名称生成逻辑是固定的后缀规则，不能覆盖需要特殊命名的设备。
- 该脚本只做"对账"，不会自动修改任何源文件。
