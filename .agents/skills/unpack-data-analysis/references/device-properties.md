# 设备属性来源

查询设备电力消耗、端口、渲染模板、占地等属性时，必须以 `buildings.buildingTable.<id>` 为主数据源。

| 子表 | 存放内容 | 不可用于推断 |
| --- | --- | --- |
| `buildingTable` | 设备主表：needPower、powerConsume、inputPorts、outputPorts、range、type 等 | — |
| `machineCrafterTable` | 制造设备模式分组 | 是否消耗电力 |
| `gasMinerTable` | 气体开采参数 | 是否消耗电力 |
| `fluidPumpInTable` | 流体泵取参数 | 是否消耗电力 |
| `fluidPumpOutTable` | 流体排放参数 | 是否消耗电力 |
| `minerTable` | 采矿参数 | 是否消耗电力 |
| 其他子表 | 领域特有补充参数 | 核心属性 |

子表缺少字段只说明该属性不由该子表管理，不能证明设备没有该属性。判断 `needPower`、端口等核心属性时必须查询 `buildingTable`，子表只作补充。

原表与当前 registry 已存在以下差异：

- `item_port_gas_reactor_1` 当前是 W 输入、E 输出，不是原表的 N/S。
- `liquid_purifier_1_gas` 当前已经是 E 输入、W 输出。
- `transmuter_1_liquidtrans` 当前已经是 E 输入、W 输出。
- `transmuter_2_solidtrans` 当前的气体输入已经在 E。
- `shaper_1_gas` 当前的气体输入已经在 E。

气体收集泵、储气罐、气体反应炉、提纯机、液气 / 固气转化机、气体散布机等设备不能仅凭原始 `x=0` 或 `x=width-1` 判定是否与 registry 相反，必须逐台校准或游戏内确认。
