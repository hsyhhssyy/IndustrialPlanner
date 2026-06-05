# Draft: v2 → v3 迁移模块设计

## 需求确认

### 核心目标
当用户访问 v3 时，自动显示迁移对话框，允许将 v2 数据迁移到 v3。

### 迁移内容
1. **地图设备迁移**：v2 所有地图中布置的设备和配置项 → v3 对应地图
2. **蓝图迁移**：v2 所有用户保存的蓝图 → v3 "迁移的蓝图" 文件夹
3. **模块配平迁移**：v2 模块配平工具箱的画布和模块配置 → v3 对应工具

### UI 需求
- 首次访问 v3 自动弹出迁移对话框
- 后续可从设置中重新打开
- 迁移说明 + 迁移按钮
- 二次确认（迁移会清空当前 v3 数据）
- 不可删除 v2 的任何数据

### 边界问题
1. **localStorage 空间**：v2 不使用 IndexedDB，localStorage 可能很大（最大键 `stage6-layout-history-by-base` ~1.5MB），需在迁移前清理 v2 历史数据腾空间
2. **幂等性**：重复迁移不能重复创建数据
3. **数据安全**：迁移可能失败，v2 数据必须保留以便回退

### 测试需求
- Playwright 端到端测试
- 具体测试：v2 摆放所有设备，修改每个配置，v3 触发迁移，验证正确性，跑仿真验证功能

---

## 技术发现

### v3 存储架构（IndexedDB + localStorage）
- **IndexedDB** 数据库 `industrial-planner`，4 个 object store：
  - `worddocument`：WorldDocument（键=documentKey UUID），包含 entities、slotLinks、documentSettings
  - `editorhistory`：撤销/重做记录
  - `blueprints`：BlueprintRecord + BlueprintFolderRecord（键前缀 `blueprint:<id>` / `folder:<id>`），支持软删除
  - `planner-state`：产线规划器状态（键="v2"）
- **localStorage** 3 个活跃键：
  - `v1-editor-persist-state`：编辑器最后文档ID
  - `v3-app-settings`：用户设置（18个字段）
  - `v4-workbench-state`：工作台布局 + 模块配平状态

### v2 存储架构（纯 localStorage）
- **44 个 localStorage 键**，全部 JSON 序列化
- **核心数据键**：
  - `stage1-layouts-by-base`：每个基地一个 LayoutState（DeviceInstance[] + DeviceLink[]），48 种设备类型
  - `stage6-layout-history-by-base`：撤销/重做历史，**最大 ~1.5MB**
  - `stage3-blueprints-user`：用户蓝图 BlueprintSnapshot[]
  - `modular-balance-modules`：BalanceModule[]（自定义模块定义）
  - `modular-balance-canvases`：BalanceCanvas[]（配平画布与阶段）
  - `stage2-planner-state`：产线规划器状态
  - `settings`：应用设置 UI 偏好
- **DeviceConfig 完整字段**：pickupItemId, admissionItemId, portPriorityGroups, pumpOutputItemId, preloadInputs, storageSlots, darkPipeInletMode, darkPipeOutletMode, reactorPool 等

### v3 UI 系统
- **自定义 DialogShell** 组件（非第三方UI库），纯 React+MobX+SCSS
- **对话框注册**：在 `DIALOG_KEYS` 数组中添加 key → openDialog/closeDialog 控制
- **i18n**：自定义系统，翻译键在 `messages.ts` 的 MessageKey 类型中定义
- **无首次访问检测**：需新建 localStorage 标志
- **无 Toast 系统**：通知直接内联在对话框中

### 现有迁移相关代码
- v3 已有 `shared/storage/legacy-blueprint-import.ts`：v2→v3 蓝图导入器，含设备重映射和配置键映射逻辑
- v3 已有 `shared/storage/migration.ts`：版本化存储迁移框架
- v2 有 `migrations/versioning.ts`：normalize 函数处理旧数据清洗

---

## 待澄清问题
（由访谈回答填充）
