---
name: unpack-data-analysis
description: 从 AKEData、本地 TableCfg raw table 或旧版 json-export 分析端口、设备、物品、配方、聚落及数据更新影响时使用；普通源码分析、不读取解包数据的 registry 检查或仅凭游戏现象推测数据时不得使用。
---

# 解包数据分析

## 能做什么

- 用户未指定解包来源时，先按 [数据源选择与 Raw Table 契约](references/data-sources.md) 使用结构化提问让用户选择；支持 `AskQuestion` 的客户端调用 `AskQuestion`。
- 读取或获取数据前必须固定单一来源和版本，并使用同一 reference 中的 manifest、hash 与无损整数规则。
- 分析端口与变体时读取 [端口坐标与变体规则](references/port-coordinates.md)。
- 分析 raw building 与项目实体的多对多关系时，必须以 `FactoryMachineCrafterTable.modeMap` 建立语义变体，再按 [设备对账脚本](references/reconciliation.md) 结合配方归属映射项目实体；`rendererTemplateMap` 只补充 renderer 证据。
- 查询设备核心属性时读取 [设备属性来源](references/device-properties.md)。
- 对账导出设备与当前 registry 时读取 [设备对账脚本](references/reconciliation.md)。
- 对账物品中英文名称时读取 [物品名称对账](references/item-reconciliation.md)，并使用其中的脚本区分普通物品、缺少直接翻译和项目组合命名物品。
- 取得解包数据后，必须读取并逐项输出 [项目数据更新 Checklist](references/update-checklist.md)。
- 端口朝向任务必须先完成“解包逻辑端口 → registry”的数据对账，再把精灵、mask、renderer 输出和 `spriteOffset` 作为修改后的视觉验收项。

## 不能做什么

- 不得把旧版 `json-export.json` 或任一项目业务 DTO 当作权威格式；AKEData / 本地来源必须保留原始 `TableCfg` 表名和结构。
- 不得在同一分析中静默混用来源、跟随 `latest` 漂移、hash 失败后回退，或把 AKEData 描述成游戏官方发布渠道。
- 不得用普通 `JSON.parse` 读取后再导出包含 Int64 的 raw table，也不得从 legacy 数据伪造已丢失字段或精度。
- 不得把解包三维坐标直接当成本项目二维坐标，也不得仅凭 `rotation.y` 或 renderer 变体推断端口方位或输入输出反转。
- 不得用精灵现状、renderer 输出、Git 历史或游戏内观感否定 `FactoryBuildingTable` 归一化后的逻辑端口差异；这些视觉资源是 registry 修改后的被校验对象。
- 不得把 `rendererTemplateMap` 当作第二套坐标变换；它只用于识别模式，端口子集还需结合配方、端口类型和 registry 变体确定，除非解包数据未来新增了可验证的数值变换字段。
- 不得把每个 renderer template 机械生成为项目设备，不得用 `{buildingId}_{mode}` 猜项目稳定 ID，也不得给 raw building 名称人工拼接 mode 后缀。
- 不得用领域子表缺少字段证明设备没有该属性。
- 不得把带 `container:` 与 `container-item:` tag 的项目组合名直接和 raw 罐装成品通用名比较；必须按项目“容器名称（内容物名称）”规则及正反配方映射验证。
- 不得把某语言缺少直接 registry 条目产生的默认语言回退当成该语言名称差异。
