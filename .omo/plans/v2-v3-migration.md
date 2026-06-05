# v2 → v3 数据迁移模块

## TL;DR

> **Quick Summary**：在同源部署下，新增迁移对话框让用户将 v2 localStorage 数据（地图设备、蓝图、模块配平）迁移到 v3 IndexedDB 体系。所有转换逻辑复用并扩展 `legacy-blueprint-import.ts` 作为唯一入口，地图迁移等效于"全选设备→创建蓝图→转换→清空地图→摆放"流程。
>
> **Deliverables**：
> - 迁移对话框 UI（首次自动弹出 + 设置中重新打开 + 二次确认）
> - `legacy-blueprint-import.ts` 扩展（补全 7 项 config 字段转换）
> - 地图迁移编排器（v2 LayoutState → v3 WorldDocument）
> - 蓝图迁移编排器（v2 → v3 "迁移的蓝图"文件夹）
> - 模块配平迁移编排器（v2 BalanceCanvas/Module → v3 ModuleBalancingState）
> - 独立 vitest `migration` 项目（TDD 单元测试）
> - Playwright E2E 测试
>
> **Estimated Effort**：Large
> **Parallel Execution**：YES — 4 waves
> **Critical Path**：Task 1 → Task 5-10 (config gaps) → Task 11 (map orchestrator) → Task 14-17 (UI) → Task 18-19 (E2E) → F1-F4

---

## Context

### Original Request
用户希望设计 v2→v3 迁移模块：访问 v3 时自动弹出迁移对话框，迁移地图设备+配置、蓝图、模块配平数据。不可删除 v2 数据。需处理 localStorage 空间不足和幂等性问题。

### Interview Summary
**Key Discussions**：
- 复用 `legacy-blueprint-import.ts` 作为唯一转换入口，不另起迁移逻辑
- TDD + E2E 测试，独立 vitest project `migration`
- 产线规划器不迁移；暗管连接暂不迁移（v3 未就绪）
- 幂等性通过数据比对检测；v2 历史数据可在空间不足时清除腾空间
- 地图迁移 = 提取 v2 设备 → 包装 LegacyBlueprintJson → 调用 convert → IndexedDB 直写

**Research Findings**：
- 基地 ID 7/7 完全一致，设备类型 ID 47/47 完全一致
- `legacy-blueprint-import.ts` 已覆盖 5 类设备 config 转换，7 项缺口待补
- v3 UI 使用 DialogShell + DIALOG_KEYS，无首次访问检测
- v2 共 44 个 localStorage key，最大 `stage6-layout-history-by-base` ~1.5MB

### Metis Review
**Identified Gaps**（addressed）：
- `legacy-blueprint-import.ts` 无法直接处理 v2 地图数据 → 通过包装为 LegacyBlueprintJson + 跳过 links 解决
- 跨模块授权 → 明确修改范围（shared/storage + app/shell + app/state），editor 通过 IndexedDB 直写
- 不需新增 domain 类型 → 确认无新类型需求
- "永不删除 v2 数据"与"清除历史数据"矛盾 → 精确化策略：仅可清除 `stage6-layout-history-by-base`

---

## Work Objectives

### Core Objective
在同源部署环境下，将 v2 localStorage 用户数据（地图设备、蓝图、模块配平）迁移至 v3 IndexedDB + localStorage 体系，通过 `legacy-blueprint-import.ts` 作为唯一转换入口，提供迁移对话框 UI 和完整的 TDD + E2E 测试覆盖。

### Concrete Deliverables
- `src/shared/storage/legacy-blueprint-import.ts` — 扩展 7 项 config 转换 + 新增 v2 地图数据读取器
- `src/app/shell/dialogs/migration-dialog.tsx` — 迁移对话框组件
- `src/app/state/state-impl.ts` — 新增 `"migration"` dialog key
- `src/app/state/storage-hook.ts` — 首次访问检测逻辑
- `src/shared/i18n/messages.ts` — 迁移对话框翻译键（zh-CN + en-US）
- `vite.config.ts` — 新增 `migration` vitest 项目
- `src/tests/migration/` — 迁移单元测试文件
- `src/tests/e2e/` — Playwright E2E 测试

### Definition of Done
- [ ] `npx vitest run --project migration` → ALL PASS
- [ ] `npx playwright test` → ALL PASS (E2E)
- [ ] 手动验证：v2 布局 → 迁移 → v3 地图正确显示所有设备及配置 → 仿真运行正确 → inspector 配置可修改

### Must Have
- 首次访问 v3 自动弹出迁移对话框
- 迁移后 v3 地图包含 v2 所有设备和配置
- 迁移后 v3 蓝图文件夹"迁移的蓝图"包含 v2 所有用户蓝图
- 迁移后 v3 模块配平面板包含 v2 所有画布和自定义模块
- v2 所有 localStorage 数据保持完整（仅历史记录可清除）
- 重复迁移不重复创建数据（幂等）
- 迁移操作需用户二次确认

### Must NOT Have (Guardrails)
- 绝不删除 v2 的 `stage1-layouts-by-base`、`stage3-blueprints-user`、`modular-balance-*`、`settings` 数据
- 不迁移产线规划器 `stage2-planner-state`
- 不迁移暗管连接 DeviceLink[]
- 不迁移系统蓝图和公共蓝图索引
- 不在编辑器内新建单独的迁移逻辑（统一用 legacy-blueprint-import.ts）
- 不引入新的 domain 类型（迁移状态用 localStorage flag）
- 不新增 UI 库依赖

### Spec Framework Integration
- **Detected Framework**：None（无 SDD 框架）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**：YES（vitest 已有 normal + blueprint 项目）
- **Automated tests**：TDD
- **Framework**：vitest（独立 `migration` 项目）+ Playwright E2E
- **TDD**：每个 config 转换和编排器任务 = RED（先写失败测试）→ GREEN（最小实现）→ REFACTOR

### QA Policy
**Frontend/UI**：Playwright — 导航、交互、断言 DOM、截图
**API/Backend**：N/A（纯前端）
**Library/Module**：Vitest — 导入函数、传入 mock v2 数据、断言输出
**CLI/TUI**：N/A

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation + test infra):
├── Task 1: Add migration vitest project + test infra
├── Task 2: V2 localStorage data reader + unit tests
├── Task 3: Migration idempotency detection + unit tests
└── Task 4: Add "migration" dialog key to DIALOG_KEYS

Wave 2 (After Wave 1 — config gaps, MAX PARALLEL):
├── Task 5: Extend config: admissionItemId/admissionAmount
├── Task 6: Extend config: portPriorityGroups
├── Task 7: Extend config: darkPipeInletMode
├── Task 8: Extend config: storageSlots
├── Task 9: Extend config: storagePreloadInputs
└── Task 10: Extend config: protocolHubOutputs full

Wave 3 (After Wave 2 — core migration orchestrators):
├── Task 11: Map migration orchestrator + unit tests
├── Task 12: Blueprint migration orchestrator + unit tests
├── Task 13: Module balancing migration + unit tests
└── Task 14: Migration dialog component

Wave 4 (After Wave 3 — UI integration + E2E):
├── Task 15: First-visit detection + auto-popup logic
├── Task 16: Settings re-open entry point
├── Task 17: i18n keys (zh-CN + en-US)
├── Task 18: Playwright E2E: basic migration flow
└── Task 19: Playwright E2E: all-devices comprehensive test

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: Code Quality Review (unspecified-high)
├── Task F3: Real Manual QA (unspecified-high + playwright)
└── Task F4: Scope Fidelity Check (deep)
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 5-10 → Task 11 → Task 14 → Task 15 → Task 18 → F1-F4 → user okay
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6 (Wave 2)
```

### Dependency Matrix (abbreviated)

- **1-4**: — — 5-14, 1
- **5-10**: 1 — 11-13, 2
- **11**: 5-10 — 14, 18-19, 3
- **12**: 5-10 — 14, 18-19, 3
- **13**: 5-10 — 14, 18-19, 3
- **14**: 1, 4 — 15, 18-19, 4
- **15**: 14 — 18-19, 4
- **16**: 14 — 18-19, 4
- **17**: 14 — 18-19, 4
- **18**: 11-17 — F1-F4, FINAL
- **19**: 11-17 — F1-F4, FINAL

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — T1-T4 → `quick`
- **Wave 2**: 6 tasks — T5-T10 → `deep` (TDD + code research required)
- **Wave 3**: 4 tasks — T11-T13 → `deep`, T14 → `visual-engineering`
- **Wave 4**: 5 tasks — T15-T17 → `quick`, T18-T19 → `unspecified-high` (+ `playwright-cli` skill)
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> Task labels: bare numbers.

- [ ] 1. Add `migration` vitest project + test infrastructure

  **What to do**:
  - 在 `vite.config.ts` 的 `test.projects` 数组中新增第三个项目 `migration`
  - 配置：`name: "migration"`，`include: ["src/tests/migration/**/*.test.ts"]`，继承根配置 `extends: true`
  - 在 `package.json` 添加脚本 `"test:migration": "vitest run --project migration"`
  - 创建 `src/tests/migration/` 目录，添加示例测试文件验证项目配置正确
  - 在 `tsconfig.json` 中确认 `src/tests/migration/` 路径已被包含

  **Must NOT do**:
  - 不修改现有 `normal` 或 `blueprint` 项目的配置
  - 不改变现有 `npm run test` 的行为范围

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 5-14 (所有 config 扩展和编排器任务需要测试基础设施)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `vite.config.ts:88-115` — 现有 `normal` 和 `blueprint` 项目配置模式
  - `package.json:13-16` — 现有测试脚本命名模式

  **Acceptance Criteria**:
  - [ ] `vite.config.ts` 包含第三个 vitest 项目 `migration`，`include: ["src/tests/migration/**/*.test.ts"]`
  - [ ] `package.json` 包含 `"test:migration"` 脚本
  - [ ] `npx vitest run --project migration` → 成功运行（即使 0 个测试文件，验证配置正确）

  **QA Scenarios**:
  ```
  Scenario: migration 测试项目可以正确运行
    Tool: Bash
    Steps:
      1. npx vitest run --project migration
      2. 验证退出码为 0（无配置错误）
    Expected Result: vitest 成功运行，输出 "No test files found" 或测试通过
    Evidence: .omo/evidence/task-1-project-config.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-1-project-config.txt` — `npx vitest run --project migration` 完整输出

  **Commit**: YES
  - Message: `chore(test): add migration vitest project`
  - Files: `vite.config.ts`, `package.json`

- [ ] 2. V2 localStorage 数据读取器 + 类型定义 + 单元测试

  **What to do**（TDD — 先写测试）：
  - 创建 `src/shared/storage/v2-data-reader.ts`
  - 实现 `readV2MapData()` — 读取 `stage1-layouts-by-base`，返回 `Record<BaseId, LayoutState>`
  - 实现 `readV2Blueprints()` — 读取 `stage3-blueprints-user`，返回 `BlueprintSnapshot[]`
  - 实现 `readV2ModuleBalancing()` — 读取全部 `modular-balance-*` 键，返回 `{ canvases, modules, ... }`
  - 实现 `getV2LocalStorageSize()` — 估算所有 v2 localStorage 键的字节大小
  - 实现 `clearV2HistoryData()` — 仅清除 `stage6-layout-history-by-base`（空间不足时调用）
  - 所有函数需处理 localStorage 键不存在的情况（返回 null/undefined/空数组）
  - 创建 `src/tests/migration/v2-data-reader.test.ts`：
    - Mock `localStorage.getItem` 设置测试数据
    - 测试读取正常 v2 数据 → 返回正确结构
    - 测试 v2 键不存在 → 返回 fallback
    - 测试 JSON 解析失败 → 优雅处理
    - 测试 `clearV2HistoryData` → 仅清除历史键，不碰其他键
    - 测试 `getV2LocalStorageSize` → 返回正确估算

  **Must NOT do**：
  - 不修改 v2 localStorage 中除 `stage6-layout-history-by-base` 以外的任何键
  - 不在 v2-data-reader 中引入迁移转换逻辑（仅读取，不转换）

  **Recommended Agent Profile**：
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 5-13 (config 扩展和编排器需要此读取器)
  - **Blocked By**: Task 1 (需要 vitest 基础设施)

  **References**：
  - `/home/coder/IndustrialPlanner-Worktrees/v2/src/core/persistentStorage.ts` — v2 localStorage 读写模式
  - `v2-data-reader` 应读取的键清单：
    - `stage1-layouts-by-base` → `LayoutsByBaseStorage`
    - `stage3-blueprints-user` → `StoredBlueprintSnapshot[]`
    - `modular-balance-canvases` → `BalanceCanvas[]`
    - `modular-balance-modules` → `BalanceModule[]`
    - `modular-balance-canvas-time-unit` → string
    - `modular-balance-selected-canvas-id` → string
    - `stage6-layout-history-by-base` → 仅用于大小估算和清除
  - `/home/coder/IndustrialPlanner/src/shared/storage/browser-storage.ts` — `readFromLocalStorage<T>()` 可复用

  **Acceptance Criteria**：
  - [ ] `src/shared/storage/v2-data-reader.ts` 存在，导出 6 个函数
  - [ ] `src/tests/migration/v2-data-reader.test.ts` 存在
  - [ ] `npx vitest run --project migration` → v2-data-reader 测试 PASS

  **QA Scenarios**：
  ```
  Scenario: 正常读取 v2 地图数据
    Tool: Bash (vitest)
    Preconditions: localStorage 中设置了模拟的 stage1-layouts-by-base 数据
    Steps:
      1. 调用 readV2MapData()
      2. 断言返回对象包含 7 个基地的 LayoutState
      3. 断言每个 LayoutState 含 devices 和 links 数组
    Expected Result: 类型正确的结构化数据
    Evidence: .omo/evidence/task-2-read-map.txt

  Scenario: v2 键不存在时返回 fallback
    Tool: Bash (vitest)
    Preconditions: localStorage 中无 stage3-blueprints-user 键
    Steps:
      1. 调用 readV2Blueprints()
      2. 断言返回空数组 []
    Expected Result: 空数组，不抛出异常
    Evidence: .omo/evidence/task-2-missing-key.txt
  ```

  **Evidence to Capture**：
  - [ ] `task-2-read-map.txt` — vitest 输出
  - [ ] `task-2-missing-key.txt` — vitest 输出

  **Commit**: YES
  - Message: `feat(migration): add v2 localStorage data reader with tests`
  - Files: `src/shared/storage/v2-data-reader.ts`, `src/tests/migration/v2-data-reader.test.ts`

- [ ] 3. 迁移幂等性检测 + 单元测试

  **What to do**（TDD）：
  - 创建 `src/shared/storage/migration-idempotency.ts`
  - 实现 `checkMigrationStatus()` — 检查 v3 是否已有迁移数据，返回 `{ mapMigrated: boolean, blueprintsMigrated: boolean, moduleBalancingMigrated: boolean }`
  - 地图检测：检查 IndexedDB `worddocument` store 中是否已有含 entities 的文档（用 `readFromIndexedDb` 已存 API）
  - 蓝图检测：检查 IndexedDB `blueprints` store 中是否已有 `"迁移的蓝图"` 文件夹下的蓝图（用 `listBlueprintDirectory`）
  - 模块配平检测：检查 localStorage `v4-workbench-state` 的 `moduleBalancing.canvases` 是否非空
  - 实现 `markMigrationCompleted()` — 写入时间戳到 `v3-migration-completed` localStorage
  - 创建 `src/tests/migration/migration-idempotency.test.ts`

  **Must NOT do**：
  - 不在检测过程中写入任何 v3 数据
  - 不修改 `checkMigrationStatus` 的返回格式（保持三字段）

  **Recommended Agent Profile**：
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 11-13 (编排器需在迁移前调用检测)
  - **Blocked By**: Task 1 (需要 vitest 基础设施)

  **References**：
  - `/home/coder/IndustrialPlanner/src/shared/storage/browser-storage.ts` — `readFromIndexedDb<T>()`、`listFromIndexedDb()`
  - `/home/coder/IndustrialPlanner/src/shared/storage/blueprint-storage.ts` — `listBlueprintDirectory()`
  - `/home/coder/IndustrialPlanner/src/app/state/storage-hook.ts:34-35` — `v4-workbench-state` localStorage 键

  **Acceptance Criteria**：
  - [ ] `src/shared/storage/migration-idempotency.ts` 存在
  - [ ] `src/tests/migration/migration-idempotency.test.ts` 存在
  - [ ] `npx vitest run --project migration` → 幂等性测试 PASS

  **QA Scenarios**：
  ```
  Scenario: 首次迁移时检测所有状态为 false
    Tool: Bash (vitest)
    Preconditions: v3 IndexedDB 为空
    Steps:
      1. 调用 checkMigrationStatus()
      2. 断言所有三个字段均为 false
    Expected Result: { mapMigrated: false, blueprintsMigrated: false, moduleBalancingMigrated: false }

  Scenario: 已迁移后检测地图状态为 true
    Tool: Bash (vitest)
    Preconditions: IndexedDB worddocument store 含 entities
    Steps:
      1. 调用 checkMigrationStatus()
      2. 断言 mapMigrated === true
    Expected Result: mapMigrated: true
    Evidence: .omo/evidence/task-3-idempotency-{pass,fail}.txt
  ```

  **Evidence to Capture**：
  - [ ] `task-3-idempotency-pass.txt` — 通过输出
  - [ ] `task-3-idempotency-fail.txt` — 失败输出（如有）

  **Commit**: YES
  - Message: `feat(migration): add idempotency detection with tests`
  - Files: `src/shared/storage/migration-idempotency.ts`, `src/tests/migration/migration-idempotency.test.ts`

- [ ] 4. 添加 `"migration"` dialog key 到 DIALOG_KEYS

  **What to do**：
  - 在 `src/app/state/state-impl.ts` 的 `DIALOG_KEYS` 数组中追加 `"migration"`
  - 在 `WorkbenchStateReadWriteImpl` 构造函数中为 `"migration"` 创建 `createDefaultDialogStateForKey("migration")`
  - 在 `resolveDefaultDialogTabId` 或相关函数中确保 `"migration"` 被正确处理

  **Must NOT do**：
  - 不创建迁移对话框组件（那是 Task 14）
  - 不修改现有 dialog key 的行为

  **Recommended Agent Profile**：
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 14 (迁移对话框组件需要 dialog key 已注册)
  - **Blocked By**: None (can start immediately)

  **References**：
  - `src/app/state/state-impl.ts:318` — `DIALOG_KEYS` 数组
  - `src/app/state/state-impl.ts:465-473` — `createDefaultDialogStateForKey` 调用模式

  **Acceptance Criteria**：
  - [ ] `DIALOG_KEYS` 包含 `"migration"`
  - [ ] `npx tsc -b` → 无类型错误

  **QA Scenarios**：
  ```
  Scenario: dialog key 注册后 openDialog("migration") 不返回 null
    Tool: Bash (vitest integration)
    Steps:
      1. 在测试中模拟 AppHost
      2. 调用 internalActions.openDialog("migration")
      3. 断言 dialogState.visible === true
    Expected Result: 对话框状态正确更新
    Evidence: .omo/evidence/task-4-dialog-key.txt
  ```

  **Evidence to Capture**：
  - [ ] `task-4-dialog-key.txt` — 测试输出

  **Commit**: YES
  - Message: `feat(migration): add migration dialog key to DIALOG_KEYS`
  - Files: `src/app/state/state-impl.ts`

- [ ] 5. 扩展 config 转换：准入器 admissionItemId / admissionAmount

  **What to do**（TDD）：
  - 在 `legacy-blueprint-import.ts` 的 `convertLegacyDeviceConfig` 中新增 `item_log_admission` 和 `item_pipe_admission` 分支
  - 必须先探索 `entity-definition.ts` 中准入器的 `portGroups`/`acceptRule` 结构确定 v3 对应字段
  - 将 v2 `admissionItemId` 映射到 v3 端口接受规则
  - 将 v2 `admissionAmount` 映射到 v3 通过数量限制字段
  - 创建 `src/tests/migration/config-admission.test.ts`（至少 3 个用例：固体准入器、液体准入器、空配置）

  **Must NOT do**：
  - 不修改现有 config 转换分支行为
  - 不猜测 v3 字段名 — 必须从 entity-definition.ts 找到实际定义

  **Recommended Agent Profile**：
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8, 9, 10)
  - **Blocks**: Task 11 (地图迁移需要完整的 config 转换)
  - **Blocked By**: Task 1 (需要 vitest), Task 2 (需要读取器验证数据格式)

  **References**：
  - `src/shared/storage/legacy-blueprint-import.ts:320-448` — `convertLegacyDeviceConfig` 现有分支模式
  - `src/registry/entity-definition.ts` — 搜索 `item_log_admission` 定义

  **Acceptance Criteria**：
  - [ ] `npx vitest run --project migration` → config-admission 测试 PASS
  - [ ] `npx tsc -b` → 无类型错误

  **QA Scenarios**：
  ```
  Scenario: admissionItemId 正确转换为 acceptRule
    Tool: Bash (vitest)
    Steps:
      1. 调用 convertLegacyDeviceConfig("item_log_admission", { admissionItemId: "item_iron_ore", admissionAmount: 100 })
      2. 断言输出 portGroups[N].ports[M].acceptRule.base.itemId === "item_iron_ore"
    Expected Result: v3 config 含正确 acceptRule
    Evidence: .omo/evidence/task-5-admission.txt
  ```

  **Commit**: YES
  - Message: `fix(migration): add admission config conversion`
  - Files: `src/shared/storage/legacy-blueprint-import.ts`, `src/tests/migration/config-admission.test.ts`

- [ ] 6. 扩展 config 转换：portPriorityGroups

  **What to do**（TDD）：
  - 探索 v3 entity-definition.ts 中分流器/汇流器的 `portGroups[N].ports[M].priority` 结构
  - v2 格式：`{ "in_0": 1, "out_0": 5 }` → 映射到 v3 各端口 `priority` 字段
  - 创建 `src/tests/migration/config-port-priority.test.ts`

  **Must NOT do**：
  - 不硬编码端口映射 — 需动态匹配 portGroup+port

  **Recommended Agent Profile**：
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2

  **QA Scenarios**：
  ```
  Scenario: portPriorityGroups 正确映射到 v3 端口 priority
    Tool: Bash (vitest)
    Steps:
      1. 调用 convertLegacyDeviceConfig("item_log_splitter", { portPriorityGroups: { "in_0": 1, "out_0": 5 } })
      2. 断言对应端口的 priority 字段正确
    Evidence: .omo/evidence/task-6-port-priority.txt
  ```

  **Commit**: YES
  - Message: `fix(migration): add portPriorityGroups config conversion`
  - Files: `src/shared/storage/legacy-blueprint-import.ts`, `src/tests/migration/config-port-priority.test.ts`

- [ ] 7. 扩展 config 转换：暗管入口 darkPipeInletMode

  **What to do**（TDD）：
  - 探索 entity-definition.ts 中 `item_port_udpipe_loader_1/2` 的字段结构
  - v2 `darkPipeInletMode: "destroy"|"link"` → v3 对应（可能是 `storageSlotGroups[0].slots[0].initialItemType` 或 portGroups 字段）
  - 创建 `src/tests/migration/config-dark-pipe-inlet.test.ts`

  **Must NOT do**：
  - 不实现暗管连接 DeviceLink[] 迁移（Scope OUT）

  **Recommended Agent Profile**：
  - **Category**: `deep`

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8, 9, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 1

  **Acceptance Criteria**：
  - [ ] `legacy-blueprint-import.ts` 新增暗管入口模式转换
  - [ ] `npx vitest run --project migration` → 测试 PASS

  **QA Scenarios**：
  ```
  Scenario: darkPipeInletMode="destroy" 正确转换
    Tool: Bash (vitest)
    Steps:
      1. 调用 convertLegacyDeviceConfig("item_port_udpipe_loader_1", { darkPipeInletMode: "destroy" })
      2. 断言 v3 config 正确处理 destroy 模式
    Evidence: .omo/evidence/task-7-dark-pipe-inlet.txt
  ```

  **Commit**: YES

- [ ] 8. 扩展 config 转换：存储箱 storageSlots 槽位锁定

  **What to do**（TDD）：
  - 扩展 `convertLegacyStoragerConfig`：处理 v2 `storageSlots[{slotIndex, mode, pinnedItemId}]`
  - 映射到 v3 `storageSlotGroups[N].slots[M]` 的 `lockMode` + `initialItemType`
  - 创建 `src/tests/migration/config-storage-slots.test.ts`

  **Must NOT do**：
  - 不破坏现有 `submitToWarehouse` 转换

  **Recommended Agent Profile**：
  - **Category**: `deep`

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 9, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 1

  **Acceptance Criteria**：
  - [ ] `legacy-blueprint-import.ts` 扩展 storageSlots 转换
  - [ ] `npx vitest run --project migration` → 测试 PASS

  **QA Scenarios**：
  ```
  Scenario: storageSlots pinned 模式正确转换为 lockMode
    Tool: Bash (vitest)
    Steps:
      1. 调用 convertLegacyDeviceConfig("item_port_storager_1", {
           storageSlots: [{ slotIndex: 0, mode: "pinned", pinnedItemId: "item_iron_plate" }]
         })
      2. 断言 storageSlotGroups[0].slots[0].lockMode 和 initialItemType 正确
    Evidence: .omo/evidence/task-8-storage-slots.txt
  ```

  **Commit**: YES

- [ ] 9. 扩展 config 转换：储液罐 storagePreloadInputs

  **What to do**（TDD）：
  - 在 `legacy-blueprint-import.ts` 中为 `item_port_liquid_storager_1` 新增分支
  - v2 `storagePreloadInputs[{slotIndex, itemId, amount}]` → v3 `storageSlotGroups[0].slots[N].initialItemType/initialCount`
  - 仅允许液体物品（需与 registry 验证）
  - 创建 `src/tests/migration/config-storage-preload.test.ts`

  **Recommended Agent Profile**：
  - **Category**: `deep`

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 8, 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 1

  **Acceptance Criteria**：
  - [ ] `legacy-blueprint-import.ts` 新增储液罐预置转换
  - [ ] `npx vitest run --project migration` → 测试 PASS

  **QA Scenarios**：
  ```
  Scenario: 储液罐预置液体正确转换
    Tool: Bash (vitest)
    Steps:
      1. 调用 convertLegacyDeviceConfig("item_port_liquid_storager_1", {
           storagePreloadInputs: [{ slotIndex: 0, itemId: "liquid_water", amount: 500 }]
         })
      2. 断言 storageSlotGroups[0].slots[0].initialItemType === "liquid_water"
    Evidence: .omo/evidence/task-9-storage-preload.txt
  ```

  **Commit**: YES

- [ ] 10. 扩展 config 转换：协议核心 protocolHubOutputs 全量

  **What to do**（TDD）：
  - 扩展现有 `convertLegacyUnloaderConfig` 中的 protocolHubOutputs 处理
  - 当前仅处理 `protocolHubOutputs[0].ignoreInventory`，需要处理多输出端口、不同端口 ID 的场景
  - 探索 v3 `item_port_sp_hub_1` 的 portGroups 和 SlotLinkDefinition 结构
  - 创建 `src/tests/migration/config-protocol-hub.test.ts`

  **Recommended Agent Profile**：
  - **Category**: `deep`

  **Parallelization**：
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7, 8, 9)
  - **Blocks**: Task 11
  - **Blocked By**: Task 1

  **Acceptance Criteria**：
  - [ ] `legacy-blueprint-import.ts` 扩展协议核心全量转换
  - [ ] `npx vitest run --project migration` → 测试 PASS

  **QA Scenarios**：
  ```
  Scenario: 协议核心多输出端口完整转换
    Tool: Bash (vitest)
    Steps:
      1. 调用 convertLegacyDeviceConfig("item_port_sp_hub_1", {
           protocolHubOutputs: [
             { portId: "p_out_mid", itemId: "item_iron_plate", ignoreInventory: false },
             { portId: "p_out_1", itemId: "item_copper_wire", ignoreInventory: true }
           ]
         })
      2. 断言多个 links 条目和 storageSlotGroups 正确生成
    Evidence: .omo/evidence/task-10-protocol-hub.txt
  ```

  **Commit**: YES

- [ ] 11. 地图迁移编排器 + 单元测试

  **What to do**（TDD）：
  - 创建 `src/shared/storage/map-migration.ts`
  - 实现 `migrateMapFromV2(baseId)` — 核心编排器：
    1. 调用 `readV2MapData()` 获取 v2 布局
    2. 对每个基地提取 DeviceInstance[] → 转换为 LegacyBlueprintDeviceJson[]
    3. 包装为 LegacyBlueprintJson（schema, name, baseId, devices, links:[]）
    4. 调用 `convertLegacyBlueprintJson()` → 获取 BlueprintDocument
    5. 提取 entities → 构造 WorldDocument（新 UUID documentKey）
    6. 通过 `saveToIndexedDb` 写入 IndexedDB `worddocument` store
  - 实现 `clearV3Maps()` — 迁移前清空 v3 所有 WordDocument
  - 创建 `src/tests/migration/map-migration.test.ts`

  **Must NOT do**：不通过 editor contract 写数据；不迁移 DeviceLink[]

  **Recommended Agent Profile**：`deep`

  **Parallelization**：Wave 3 (with 12, 13, 14) | Blocks: 18-19 | Blocked By: 2, 5-10

  **QA Scenarios**：
  ```
  Scenario: v2 LayoutState → v3 WorldDocument 完整流程
    Tool: Bash (vitest)
    Preconditions: Mock v2 含 3 设备 + 配置
    Steps:
      1. migrateMapFromV2("wuling_protocol_core")
      2. 断言 IndexedDB worddocument 有正确 entities
      3. 断言取货口 config 含 links[0]
    Evidence: .omo/evidence/task-11-map-migration.txt
  ```

  **Acceptance Criteria**：
  - [ ] `src/shared/storage/map-migration.ts` + 测试文件存在
  - [ ] `npx vitest run --project migration` → 地图迁移测试 PASS
  - [ ] `clearV3Maps()` 正确清空 worddocument store

  **Commit**: YES — `feat(migration): add map migration orchestrator with tests`

- [ ] 12. 蓝图迁移编排器 + 单元测试

  **What to do**（TDD）：
  - 创建 `src/shared/storage/blueprint-migration.ts`
  - 实现 `migrateBlueprintsFromV2()`：
    1. 读取 v2 蓝图 → 检查幂等性 → 创建"迁移的蓝图"文件夹
    2. 每个蓝图调用 `convertLegacyBlueprintJson()` → BlueprintDocument
    3. 构造 BlueprintRecord → 写入 IndexedDB `blueprints` store
  - 创建 `src/tests/migration/blueprint-migration.test.ts`

  **Must NOT do**：不迁移系统蓝图

  **Recommended Agent Profile**：`deep`

  **Parallelization**：Wave 3 | Blocks: 18-19

  **QA Scenarios**：
  ```
  Scenario: v2 蓝图成功迁移到"迁移的蓝图"文件夹
    Tool: Bash (vitest)
    Steps: Mock 2 个蓝图 → migrateBlueprintsFromV2() → 断言 folder + blueprint 关系
    Evidence: .omo/evidence/task-12-blueprint-migration.txt
  ```

  **Acceptance Criteria**：
  - [ ] `npx vitest run --project migration` → 蓝图迁移测试 PASS

  **Commit**: YES

- [ ] 13. 模块配平迁移编排器 + 单元测试

  **What to do**（TDD）：
  - 创建 `src/shared/storage/module-balancing-migration.ts`
  - 映射 v2 BalanceCanvas → v3 ModuleBalancingCanvas（systemInputs→globalInputs, instances→entries）
  - 映射 v2 BalanceModule → v3 ModuleBalancingCustomModule（colorKey→color, inputs/outputs→IOPort[]）
  - 更新 localStorage `v4-workbench-state`.moduleBalancing
  - 创建 `src/tests/migration/module-balancing-migration.test.ts`

  **Recommended Agent Profile**：`deep`

  **Parallelization**：Wave 3

  **QA Scenarios**：
  ```
  Scenario: v2 BalanceCanvas+Module → v3 ModuleBalancingState
    Tool: Bash (vitest)
    Steps: Mock 1 canvas + 3 modules → migrate → 断言 v3 canvases/customModules 正确
    Evidence: .omo/evidence/task-13-module-balancing.txt
  ```

  **Acceptance Criteria**：
  - [ ] v2 BalanceCanvas 正确转换为 v3 ModuleBalancingCanvas
  - [ ] v2 BalanceModule 正确转换为 v3 ModuleBalancingCustomModule
  - [ ] `npx vitest run --project migration` → 模块配平测试 PASS

  **Commit**: YES

- [ ] 14. 迁移对话框 UI 组件

  **What to do**：
  - 创建 `src/app/shell/dialogs/migration-dialog.tsx`
  - DialogShell 包装，5 种状态：idle / confirming / migrating / done / error
  - 二次确认："这将清空当前 v3 所有地图数据，确认继续？"
  - 挂载到 `workbench-app.tsx`

  **Must NOT do**：不直接操作 v2 localStorage；不使用第三方 UI

  **Recommended Agent Profile**：`visual-engineering`

  **Parallelization**：Wave 3 (with 11, 12, 13) | Blocks: 15-19 | Blocked By: 4

  **QA Scenarios**：
  ```
  Scenario: 迁移对话框显示正确初始状态
    Tool: Playwright
    Steps: openDialog("migration") → 断言标题 + 按钮 + 说明文字
    Evidence: .omo/evidence/task-14-dialog-ui.png
  ```

  **Acceptance Criteria**：
  - [ ] 对话框有 5 种状态切换（idle/confirming/migrating/done/error）
  - [ ] 二次确认逻辑正确阻止/允许操作
  - [ ] `npx tsc -b` → 无类型错误

  **Commit**: YES

- [ ] 15. 首次访问检测 + 自动弹出逻辑

  **What to do**：
  - 在 `src/app/state/storage-hook.ts` 或 `app-host.ts` 初始化时检查 localStorage `v3-migration-completed`
  - 如果 flag 不存在 → 自动调用 `openDialog("migration")` 弹出迁移对话框
  - 迁移完成后写入 `v3-migration-completed: { timestamp, ... }` 到 localStorage
  - v2 数据为空时跳过（不弹窗）→ 仍需检查 v2 localStorage 是否有数据

  **Recommended Agent Profile**：`quick`

  **Parallelization**：Wave 4 (with 16, 17) | Blocked By: 14

  **QA Scenarios**：
  ```
  Scenario: 首次访问 v3 自动弹出迁移对话框
    Tool: Playwright
    Preconditions: localStorage 无 v3-migration-completed, v2 数据存在
    Steps: 打开 v3 → 断言迁移对话框自动弹出
    Evidence: .omo/evidence/task-15-auto-popup.png
  ```

  **Acceptance Criteria**：
  - [ ] 首次访问时自动弹出迁移对话框
  - [ ] v2 数据为空时不弹窗
  - [ ] 迁移完成后写入 `v3-migration-completed` flag

  **Commit**: YES

- [ ] 16. 设置中重新打开迁移对话框入口

  **What to do**：
  - 在设置面板或 help 区域增加"重新打开数据迁移"按钮/菜单项
  - 调用 `openDialog("migration")` 打开迁移对话框

  **Recommended Agent Profile**：`quick`

  **Parallelization**：Wave 4 | Blocked By: 14

  **Acceptance Criteria**：
  - [ ] 设置面板中有"重新打开数据迁移"入口
  - [ ] 点击后迁移对话框正确弹出

  **Commit**: YES

- [ ] 17. 迁移对话框 i18n 翻译键

  **What to do**：
  - 在 `src/shared/i18n/messages.ts` 的 `MessageKey` 联合类型中新增迁移相关键
  - 添加 zh-CN 和 en-US 翻译：
    - `migrationDialog.title`: "数据迁移" / "Data Migration"
    - `migrationDialog.description`: 迁移说明文字
    - `migrationDialog.confirm`: 二次确认文字
    - `migrationDialog.start`: "开始迁移" / "Start Migration"
    - `migrationDialog.migrating`: 进度文字
    - `migrationDialog.done`: 完成文字
    - `migrationDialog.error`: 错误文字

  **Recommended Agent Profile**：`quick`

  **Parallelization**：Wave 4 (with 15, 16) | Blocked By: 14

  **Acceptance Criteria**：
  - [ ] MessageKey 含 `migrationDialog.*` 键
  - [ ] zh-CN 和 en-US 翻译完整
  - [ ] `npx tsc -b` → 无类型错误

  **Commit**: YES

- [ ] 18. Playwright E2E：基础迁移流程

  **What to do**：
  - 创建 `src/tests/e2e/migration-basic.spec.ts` 或 `.playwright/` 目录
  - 测试场景：
    1. 在 localStorage 预置模拟 v2 数据（setItem stage1-layouts-by-base, stage3-blueprints-user, modular-balance-*）
    2. 打开 v3 → 断言迁移对话框自动弹出
    3. 点击"开始迁移" → 断言二次确认出现
    4. 确认 → 等待迁移完成 → 断言成功提示
    5. 刷新页面 → 断言迁移对话框不再弹出（幂等）
    6. 通过设置重新打开 → 断言显示"已有迁移数据"提示

  **Must NOT do**：不依赖真实 v2 应用实例（用 localStorage 预置数据）

  **Recommended Agent Profile**：`unspecified-high`
  - **Skills**: [`playwright-cli`]

  **Parallelization**：Wave 4 (with 19) | Blocked By: 11-17

  **QA Scenarios**：包含在上述测试场景中

  **Acceptance Criteria**：
  - [ ] Playwright 测试脚本存在且可运行
  - [ ] 覆盖 6 个场景（自动弹出、二次确认、迁移完成、幂等、重新打开）
  - [ ] `npx playwright test migration-basic` → PASS

  **Commit**: YES

- [ ] 19. Playwright E2E：全设备综合迁移测试

  **What to do**：
  - 这是用户指定的测试：
    1. 启动 v2 应用，对每个设备类型摆放一个，修改每个配置（含链接和未链接暗管的不同逻辑）
    2. 启动 v3 应用，触发迁移
    3. 验证迁移后所有设备存在、所有配置正确
    4. 运行仿真几个 tick，验证功能正常
    5. 验证 inspector 正确显示迁移配置，且可正确修改
  - 注意：此测试需要 v2 和 v3 同时可访问（同源部署场景）
  - 建议：首先生成一个"种子" v2 localStorage 数据（在 Node 脚本中构造），然后在 Playwright 中设置该数据

  **Recommended Agent Profile**：`unspecified-high`
  - **Skills**: [`playwright-cli`]

  **Parallelization**：Wave 4 (with 18) | Blocked By: 11-17

  **QA Scenarios**：即测试本身

  **Acceptance Criteria**：
  - [ ] Playwright 测试覆盖所有 47 种设备类型，每个设备的所有配置项
  - [ ] 迁移后仿真可运行 ≥3 ticks 无报错
  - [ ] Inspector 正确显示迁移配置且可修改
  - [ ] `npx playwright test migration-comprehensive` → PASS

  **Commit**: YES

---

## Final Verification Wave（MANDATORY — after ALL implementation tasks）

- [ ] F1. Plan Compliance Audit — `oracle`
  **验收标准**：Must Have [7/7] | Must NOT Have [7/7] | Tasks [19/19] | VERDICT: APPROVE
- [ ] F2. Code Quality Review — `unspecified-high`
  **验收标准**：Build [PASS] | Lint [PASS] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT: APPROVE
- [ ] F3. Real Manual QA — `unspecified-high` (+ `playwright` skill)
  **验收标准**：Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT: APPROVE
- [ ] F4. Scope Fidelity Check — `deep`
  **验收标准**：Tasks [19/19 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: APPROVE

---

## Commit Strategy

- **Wave 1**: `chore(test): add migration vitest project` — `vite.config.ts`, `package.json`
- **Wave 2**: `fix(migration): extend config conversion for {field}` × 6 — `legacy-blueprint-import.ts`
- **Wave 3**: `feat(migration): {map|blueprint|module-balancing} orchestrator` × 3 — `src/shared/storage/`
- **Wave 4**: `feat(migration): migration dialog UI` / `feat(migration): first-visit detection` / `feat(migration): i18n keys` / `test(e2e): migration scenarios`
- **Pre-commit**: `npx vitest run --project migration` (所有 wave)

---

## Success Criteria

### Verification Commands
```bash
npx vitest run --project migration        # 所有单元测试通过
npx playwright test                        # 所有 E2E 测试通过
npx tsc -b                                 # 类型检查通过
```

### Final Checklist
- [ ] All "Must Have" 项全部实现
- [ ] All "Must NOT Have" 项全部遵守
- [ ] `npm run test:migration` 全部通过
- [ ] Playwright E2E 全部通过
- [ ] v2 数据未被删除（验证 localStorage keys 完整）
