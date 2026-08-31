# 端口坐标与变体规则

## 目录

- [核心原则](#核心原则)
- [原始字段](#原始字段)
- [两套坐标](#两套坐标)
- [已确认案例](#已确认案例)
- [多变体设备](#多变体设备)
- [分析步骤](#分析步骤)
- [既有错误结论](#既有错误结论)

## 核心原则

`FactoryBuildingTable` 的端口位置和角色是 registry 默认朝向的逻辑真相源。解包三维坐标必须先按本页已校准的全局映射转换为项目二维坐标，不能原样抄入，也不能根据 `defaultRendererTemplate` 判断非默认变体需要反转输入和输出。

1. `inputPorts` / `outputPorts` 表示端口角色；没有证据表明非默认 renderer 变体会统一反转角色。
2. `position.x` / `position.z` 是游戏三维局部坐标中的平面位置，必须经过全局映射后才能与 registry 比较。
3. `rotation.y` 是端口 Transform 的游戏局部旋转角，不能单独一一映射成本项目的 `edge`。
4. 数据对账不以当前精灵或 renderer 的视觉朝向为前提；视觉资源必须在 registry 修改后跟随逻辑结果校验和调整。

## 原始字段

`FactoryBuildingTable.<id>` 中的 `inputPorts` / `outputPorts`：

- `position: { x, y, z }`：游戏三维局部坐标。
- `position.y`：端口高度；通常不参与本项目 `localCellX/localCellY` 计算，但分析原始数据时仍需保留。
- `isOutput: 0 | 1`：`0` 为输入，`1` 为输出，通常与所在数组一致。
- `isPipe: true | false`：`true` 为流体管道端口，`false` 为固体传送带端口。
- 解包数据的 `isPipe` 不能与项目 `RegistryQuery.isPipe(definitionId)` 混用；后者表示是否为三个管道节之一。
- `rotation.y`：游戏局部 Transform 的 Y 轴旋转角，不等价于本项目 `NORTH/EAST/SOUTH/WEST`。

`defaultRendererTemplate` 只表示默认 renderer 模式，不能证明它会改变端口角色，更不能推出所有非默认变体都要反转输入和输出。

## 两套坐标

### 项目注册表二维坐标

项目 `rotation=0` 时：

| 注册表坐标 | 方位 |
| --- | --- |
| `localCellX = 0` | W（西） |
| `localCellX = width - 1` | E（东） |
| `localCellY = 0` | N（北） |
| `localCellY = height - 1` | S（南） |

### 解包数据的全局归一化

以已确认和解包数据一致的气液转换机 `transmuter_1_liquidtrans` 为校准锚点，`FactoryBuildingTable` 中全部设备统一使用：

```text
localCellX = range.width - 1 - position.x
localCellY = position.z
```

因此原始 X 轴与项目横轴方向相反，原始 Z 轴与项目纵轴方向相同：

| 解包坐标 | registry 坐标 / 方位 |
| --- | --- |
| `position.x = 0` | E（东） |
| `position.x = width - 1` | W（西） |
| `position.z = 0` | N（北） |
| `position.z = depth - 1` | S（南） |

该映射是 `FactoryBuildingTable` 到 registry 的项目级坐标约定，不按设备类型重新校准。设备精灵可能存在预处理旋转，但这只影响修改后的视觉验收，不改变逻辑端口对账结论。

端口位于角点时，仅凭坐标不能唯一决定 `edge`。朝向审计应先以“角色、`isPipe`、坐标”的多重集识别设备整体旋转；registry 的端口坐标和 `edge` 再作为同一整体一起旋转，不能用 `rotation.y` 为单个角点另造方向规则。

## 已确认案例

| 设备 | 解包端口 | 注册表端口 | 结论 |
| --- | --- | --- | --- |
| 精炼炉液体输入 | `x=0, z=1, isOutput=0` | `(2,1), EAST, input` | 一致 |
| 精炼炉液体输出 | `x=2, z=1, isOutput=1` | `(0,1), WEST, output` | 一致 |
| 种植机液体输入 | `x=0, z=2, isOutput=0` | `(4,2), EAST, input` | 一致 |
| 灌装机液体输入 | `x=0, z=2, isOutput=0` | `(5,2), EAST, input` | 一致 |

精炼炉输入和输出管口在解包数据中都是 `rotation.y=90`，转换后却分别位于 E 和 W。这证明 `rotation.y=90` 不能脱离位置、角色和设备坐标基准解释为固定方位。

## 多变体设备

解包数据通常由一个 building 保存设备全部可能端口，项目则可能按配方模式拆成多个注册表实体。例如：

- `furnance_1` 对应普通精炼炉和液体精炼炉，液体口是 `isPipe: true` 端口。
- `planter_1` 对应普通种植机和液体种植机。
- `filling_powder_mc_1` 对应普通、液体等灌装模式。

`rendererTemplateMap`、配方 `formulaGroupId`、端口 `isPipe` 和原料 / 产物类型用于识别变体及其端口子集，但不能代替坐标归一化，也不能据此创建“非默认变体统一反转端口”的规则。当前解包文件中的 `rendererTemplateMap` 没有独立的数值坐标变换。

## 分析步骤

1. 通过 `FactoryBuildingItemTable` 从物品 ID 找到真实 `buildingId`。
2. 读取 `FactoryBuildingTable[buildingId]` 的 `range`、`inputPorts`、`outputPorts` 和 `rendererTemplateMap`。
3. 用 `isPipe` 区分管道和传送带端口，保留 `inputPorts` / `outputPorts` 的角色语义。
4. 对全部 `FactoryBuildingTable` 记录应用全局映射，得到项目 `(localCellX, localCellY)`；不要逐设备重新校准。
5. 用“角色、`isPipe`、坐标”的多重集匹配 registry。多变体实体允许匹配原始 building 全部端口的子集，但不得改变角色或管道类型来凑结果。
6. 按项目 `GridRotation` 约定（俯视坐标 Y 轴向下，90° 为顺时针）枚举 0°、90°、180°、270°。唯一非 0° 匹配表示 registry 默认朝向需要旋转；唯一 0° 匹配表示一致；多个匹配表示端口布局旋转对称，单靠端口不能确定视觉角度；无匹配表示映射、变体端口子集或 registry 相对布局存在其他问题。
7. 把“解包标准端口旋转到当前 registry”的唯一匹配角记为 `A`：registry 端口及其视觉资源的修正角是 `-A mod 360`；为了保持既有设备在世界中的朝向，蓝图和基地文档中保存的设备旋转迁移量是 `+A mod 360`。不得把这两个方向混用。
8. 修改完成后再校验精灵、mask、renderer 输出和 `spriteOffset`；发现视觉不一致时调整视觉资源，不得回头否定已经唯一确定的数据对账结果。
9. 只有数据结果为旋转对称或无匹配、且排除映射和变体问题后，视觉检查或游戏内实测才用于消除剩余歧义。

## 既有错误结论

“非默认变体应统一反转 W↔E”的结论无效，基于该结论生成的清单不能作为修改 registry 的依据。

“解包与 registry 不一致只表示未校准，必须先看精灵才能判断 registry 是否错误”的结论同样无效。全局坐标映射已经由校准锚点确定；唯一旋转差异本身就足以确定 registry 需要修改，精灵与 renderer 属于后续验收层。
