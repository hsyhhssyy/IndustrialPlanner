# 设备属性来源

查询设备电力消耗、端口、渲染模板、占地等属性时，必须以 `FactoryBuildingTable.<id>` 为主数据源。

| 子表 | 存放内容 | 不可用于推断 |
| --- | --- | --- |
| `FactoryBuildingTable` | 设备主表：needPower、powerConsume、inputPorts、outputPorts、range、type 等 | — |
| `FactoryMachineCrafterTable` | 制造设备模式分组 | 是否消耗电力 |
| `FactoryGasMinerTable` | 气体开采参数 | 是否消耗电力 |
| `FactoryFluidPumpInTable` | 流体泵取参数 | 是否消耗电力 |
| `FactoryFluidPumpOutTable` | 流体排放参数 | 是否消耗电力 |
| `FactoryMinerTable` | 采矿参数 | 是否消耗电力 |
| 其他子表 | 领域特有补充参数 | 核心属性 |

子表缺少字段只说明该属性不由该子表管理，不能证明设备没有该属性。判断 `needPower`、端口等核心属性时必须查询 `FactoryBuildingTable`，子表只作补充。

端口朝向不在本页维护静态差异清单。必须按 [端口坐标与变体规则](port-coordinates.md) 对当前解包文件和当前 registry 重新审计，不能为气体设备或其他设备类型设置逐台校准例外。

`rendererTemplateMap` 是变体选择信息，不是设备属性坐标的第二真相源。精灵、mask、renderer 输出和 `spriteOffset` 仅在 registry 逻辑端口修改后执行视觉验收。
