---
name: unpack-data-analysis
description: 分析 .temp/json-export.json 中的端口坐标、设备变体、渲染模板或设备属性时使用；普通源码分析、不读取解包数据的 registry 检查或仅凭游戏现象推测数据时不得使用。
---

# 解包数据分析

## 能做什么

- 分析端口与变体时读取 [端口坐标与变体规则](references/port-coordinates.md)。
- 查询设备核心属性时读取 [设备属性来源](references/device-properties.md)。
- 对账导出设备与当前 registry 时读取 [设备对账脚本](references/reconciliation.md)。
- 端口朝向任务必须先完成“解包逻辑端口 → registry”的数据对账，再把精灵、mask、renderer 输出和 `spriteOffset` 作为修改后的视觉验收项。

## 不能做什么

- 不得把解包三维坐标直接当成本项目二维坐标，也不得仅凭 `rotation.y` 或 renderer 变体推断端口方位或输入输出反转。
- 不得用精灵现状、renderer 输出、Git 历史或游戏内观感否定 `buildingTable` 归一化后的逻辑端口差异；这些视觉资源是 registry 修改后的被校验对象。
- 不得把 `rendererTemplateMap` 当作第二套坐标变换；它只用于识别模式，端口子集还需结合配方、端口类型和 registry 变体确定，除非解包数据未来新增了可验证的数值变换字段。
- 不得用领域子表缺少字段证明设备没有该属性。
