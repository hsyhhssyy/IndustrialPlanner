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

解包 JSON 的端口坐标不能直接当作本项目注册表的俯视坐标，也不能根据 `defaultRendererTemplate` 判断非默认变体需要反转输入和输出。

1. `inputPorts` / `outputPorts` 表示端口角色；没有证据表明非默认 renderer 变体会统一反转角色。
2. `position.x` / `position.z` 是游戏三维局部坐标中的平面位置，未归一化前不能直接标成 W/E/N/S。
3. `rotation.y` 是端口 Transform 的游戏局部旋转角，不能单独一一映射成本项目的 `edge`。
4. 比较端口前必须统一设备 `rotation=0` 的视觉朝向和二维坐标基准。

## 原始字段

`buildings.buildingTable.<id>` 中的 `inputPorts` / `outputPorts`：

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

### 解包数据边界坐标

坐标归一化前只能描述原始边界：

| 解包坐标 | 安全表述 |
| --- | --- |
| `position.x = 0` | 原始 X 最小边界 |
| `position.x = width - 1` | 原始 X 最大边界 |
| `position.z = 0` | 原始 Z 最小边界 |
| `position.z = depth - 1` | 原始 Z 最大边界 |

### 已确认设备组

精炼炉、种植机、灌装机及其液体端口的现有证据符合：

```text
localCellX = width - 1 - position.x
localCellY = position.z
```

该设备组的原始 X 轴与项目横轴方向相反：

| 解包坐标 | 转换后方位 |
| --- | --- |
| `position.x = 0` | E（东） |
| `position.x = width - 1` | W（西） |
| `position.z = 0` | N（北） |
| `position.z = depth - 1` | S（南） |

该转换由三个同类设备交叉验证，但不能推广到未校准设备。设备精灵可能存在 0°、90°、180° 等预处理旋转，必须先确认对应设备 `rotation=0` 的视觉基准。

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

`rendererTemplateMap`、配方 `formulaGroupId`、端口 `isPipe` 和原料 / 产物类型可以辅助识别变体，但不能代替坐标归一化，也不能据此创建“非默认变体统一反转端口”的规则。

## 分析步骤

1. 通过 `buildingItemTable` 从物品 ID 找到真实 `buildingId`。
2. 读取 `buildingTable[buildingId]` 的 `range`、`inputPorts`、`outputPorts` 和 `rendererTemplateMap`。
3. 用 `isPipe` 区分管道和传送带端口，保留 `inputPorts` / `outputPorts` 的角色语义。
4. 确认项目对应注册表实体及其 `rotation=0` 精灵朝向，注意精灵同步过程可能预旋转。
5. 用至少两个不重合端口建立转换，优先同时覆盖输入和输出。
6. 转换为项目 `(localCellX, localCellY, edge)` 后再比较。
7. 数据、精灵和 registry 仍不能形成唯一解释时，进行游戏内实测；不得使用“非默认变体反转”兜底。

## 既有错误结论

“非默认变体应统一反转 W↔E”的结论无效，基于该结论生成的清单不能作为修改 registry 的依据。
