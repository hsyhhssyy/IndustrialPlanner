# Draft: v2 → v3 迁移模块设计

## 核心目标（一句话）

在同源部署环境下，将 v2 localStorage 中的用户地图设备、蓝图、模块配平数据迁移到 v3 IndexedDB + localStorage 存储体系，通过可复用的 `legacy-blueprint-import.ts` 作为唯一转换入口。

---

## Scope IN / Scope OUT

### Scope IN（本次迁移覆盖）
- **地图设备迁移**：v2 所有基地的已放置设备（DeviceInstance[]）及其完整配置 → v3 对应基地 WorldDocument
- **蓝图迁移**：v2 所有用户保存蓝图 → v3 "迁移的蓝图" 文件夹
- **模块配平迁移**：v2 的 BalanceCanvas[] 和 BalanceModule[] → v3 workbench.moduleBalancing
- **迁移对话框 UI**：首次访问自动弹出 + 设置中可重新打开 + 二次确认
- **Config 缺口补充**：在 `legacy-blueprint-import.ts` 中补全以下字段转换：admissionItemId, admissionAmount, portPriorityGroups, darkPipeInletMode, storageSlots, storagePreloadInputs
- **Vitest 单元测试**（独立 project，不与 normal/blueprint 混合）
- **Playwright E2E 测试**

### Scope OUT（明确排除）
- **产线规划器**：`stage2-planner-state` 不迁移 ✓（用户确认）
- **暗管连接迁移**：v2 DeviceLink[] → v3 SlotLinkDefinition[] 暂不实现（v3 功能未就绪，待完成后再分析）
- **v2 历史记录**：`stage6-layout-history-by-base` 不迁移内容，仅迁移当前地图状态 ✓（用户确认）
- **系统蓝图**：`stage3-blueprints-system` 不迁移
- **公共蓝图索引缓存**：不迁移

### v2 数据删除策略（精确边界）
- **可清除**：`stage6-layout-history-by-base`（撤销/重做历史，~1.5MB，用户明确允许在空间不足时清除以腾空间）
- **绝不删除**：`stage1-layouts-by-base`（当前地图）、`stage3-blueprints-user`（用户蓝图）、`modular-balance-*`（模块配平）、`settings`（用户设置）— 确保迁移失败时用户可回退 v2 继续使用

---

## 已确认决策

### 用户反馈
| # | 决策点 | 决定 |
|---|--------|------|
| 1 | 跨源数据访问 | 同源部署，v3 直接读取 v2 的 localStorage |
| 2 | 测试策略 | TDD + E2E，迁移测试独立放置（新增 vitest project `migration`），不与 normal/blueprint 混合 |
| 3 | 产线规划器 | 不需要迁移 |
| 4 | 幂等性 | 数据比对检测 — 检查 v3 中是否已有迁移数据来决定是否允许再次迁移 |
| 5 | 迁移逻辑复用 | **不另起一套迁移逻辑**，地图迁移复用 `legacy-blueprint-import.ts`。等效流程：提取 v2 设备 → 包装为 LegacyBlueprintJson → 调用 convertLegacyBlueprintJson() → 清空 v3 地图 → 摆放实体。如需修改迁移逻辑也修改在这个 .ts 文件里 |
| 6 | Config 缺口处理 | 全部需要补，用户会在执行前审核修改清单 |
| 7 | 暗管链接 | 需要实现链接迁移，但 v3 暗管功能未就绪，等完成后再分析 |

### 探索发现
| # | 发现 | 结论 |
|---|------|------|
| 1 | 基地 ID | 7/7 完全一致（valley4_protocol_core, wuling_protocol_core, wuling_tianwangping_aid, wuling_heart_repair_station, valley4_rebuilt_command, valley4_infra_outpost, valley4_refugee_shelter） |
| 2 | 设备类型 ID | 47/47 完全一致，LEGACY_DEVICE_REMAPPERS 仅做旋转修正（CW↔CCW交换、splitter/converger +90°、unloader +180°）。v3 新增 4 个设备（dumper, miner_2/3/4）不在 v2 中出现 |
| 3 | Config 映射（已覆盖） | 5 类设备：取货口、暗管出口、存储箱、反应池、预置物品 |
| 4 | Config 映射（缺口） | 7 项待补：admissionItemId, admissionAmount, portPriorityGroups, darkPipeInletMode, storageSlots, storagePreloadInputs, protocolHubOutputs 全量 |
| 5 | v3 存储 | IndexedDB `industrial-planner`（4 stores: worddocument, editorhistory, blueprints, planner-state）+ localStorage 3 keys |
| 6 | v2 存储 | 44 个 localStorage keys，全 JSON。最大键 `stage6-layout-history-by-base` ~1.5MB |
| 7 | v3 UI | DialogShell + DIALOG_KEYS，无首次访问检测，无 toast 系统 |

---

## 技术架构决策

### 地图迁移转换路径（关键设计）

v2 LayoutState 不是 LegacyBlueprintJson 格式。需要构建适配层：

```
v2 LayoutState (per base)
  │
  ├─ devices: DeviceInstance[]
  │     ├─ instanceId     → blueprintInstanceId (或新生成)
  │     ├─ typeId         → typeId (直接透传)
  │     ├─ origin         → origin (直接透传)
  │     ├─ rotation       → rotation (LEGACY_DEVICE_REMAPPERS 修正)
  │     └─ config         → config (convertLegacyDeviceConfig 转换)
  │
  ├─ links: DeviceLink[]  → 跳过（暗管暂不迁移）
  │
  └─ 包装为 LegacyBlueprintJson:
        schema: "industrial-planner-blueprint"
        name: `迁移-${baseId}`
        baseId: baseId
        devices: [...转换后的设备]
        links: [] (为空，避免被拒绝)
        createdAt: now
  │
  └─ convertLegacyBlueprintJson() → BlueprintDocument
       │
       └─ 提取 entities → 写入 v3 WorldDocument (worddocument store)
```

**为什么可工作**：
- v2 的地图设备 (DeviceInstance) 包含 typeId、origin、rotation、config — 与 LegacyBlueprintDeviceJson 字段语义一致
- 传送带/管道在 v2 中就是设备（belt_straight_1x1 等），会自然出现在 devices 数组中
- `links` 设为空数组（v2 的 DeviceLink 是暗管连接，暂不迁移，而腰带/管道是通过设备本身的 adjacent 关系表示的）
- `schema` 设置正确后可通过 normalizeLegacyBlueprintJson 验证

### UI 架构（迁移对话框）
- 新增 dialog key `"migration"` 到 DIALOG_KEYS（或利用 `Record<string, ...>` 索引签名）
- 创建 `src/app/shell/dialogs/migration-dialog.tsx`
- 在 `workbench-app.tsx` 挂载组件
- 首次访问检测：在 `storage-hook.ts` 初始化时检查 `v3-migration-completed` localStorage flag
- 设置中重新打开：在 settings 或 help 区域增加入口

### 模块隔离（遵循项目规范）
| 模块 | 修改内容 | 决策 |
|------|---------|------|
| `src/shared/storage/` | 迁移核心逻辑 + config 转换补充 | ✅ 实现 |
| `src/app/shell/dialogs/` | 迁移对话框 UI | ✅ 实现 |
| `src/app/state/` | DIALOG_KEYS + DialogState | ✅ 实现 |
| `src/editor/` | 清空地图 + 摆放实体 | ✅ **IndexedDB 直写**（迁移是批量替换操作，不走 editor contract 的增量快照管道。迁移后触发 editor 重新加载 WorldDocument 即可） |
| `src/domain/` | 新增类型定义 | ✅ **不需要**（迁移状态用 localStorage flag 管理，不引入新 domain 类型） |

### 边界问题应对
1. **localStorage 空间不足** → 迁移前清除 `stage6-layout-history-by-base`（最大 ~1.5MB）
2. **幂等性** → 检查每个基地的 WorldDocument 是否已有 entities，有则提示"已存在数据"
3. **v3 已被使用过** → 二次确认对话框明确警告"迁移会清空当前 v3 所有地图数据"
4. **大数据量性能** → 分批写入 IndexedDB，使用 async/await 避免阻塞 UI
