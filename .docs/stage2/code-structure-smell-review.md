# IndustrialPlanner 代码结构审查（Stage2）

> 审查范围：`src/` 全量结构，重点关注模块化程度、模块耦合程度与 Code Smell。
> 
> 说明：本报告**只指出问题**，不讨论修复方案、实现可行性或对运行影响。

---

## 一、总体结构观察

- 当前代码呈现“分层命名存在，但核心编排层过重”的形态：`domain / features / ui / sim` 目录看似清晰，但关键逻辑集中在少数超大文件。
- 主要复杂度热点：
  - `src/App.tsx`（894 行，40 个 import）
  - `src/features/build/useBuildInteractionDomain.ts`（854 行）
  - `src/sim/engine.ts`（1094 行）
  - `src/domain/registry.ts`（1495 行）
- `features/*` 中存在多处对 `ui/*` 与 `sim/engine` 的直接依赖，显示“领域协调层”与“表现层/引擎层”边界未完全隔离。
- 模块数量较多，但部分模块职责颗粒度不稳定：有的 hook 很薄（轻包装），有的 hook 过重（接近子系统）。

---

## 二、按类型分组的 Code Smell 清单

## 1) God Object / Blob（对象或模块过度膨胀）

### 1.1 `App.tsx` 作为中心化编排器过重
- 文件体量与依赖密度异常高（40 imports）。
- 同时承担：全局状态装配、跨域流程编排、UI 组件拼装、交互事件绑定、渲染层构造、局部业务规则。
- 典型症状：大量 `useState/useEffect/useMemo` 并行堆叠，且跨 `base/build/blueprint/simulation/observability` 多域耦合。

### 1.2 `useBuildInteractionDomain.ts` 职责聚合过多
- 单文件 854 行，聚合了：画布平移缩放、放置逻辑、删除逻辑、框选拖拽、蓝图放置交互、提示与确认弹窗触发。
- 参数对象规模非常大（viewport/build/interaction/blueprint/i18n 五大块，字段众多），是明显的“超大上下文对象”。

### 1.3 `sim/engine.ts` 规则引擎内聚过强但粒度过粗
- 1094 行同时包含：runtime 初始化、缓存、配方执行、槽位流转、统计窗口、Tick 迭代等。
- 虽然逻辑同域，但聚合程度使模块可理解性与局部替换性下降。

### 1.4 `domain/registry.ts` 数据注册表过度集中
- 1495 行内承载物品、配方、设备、基地等核心静态数据。
- 单体数据模块过大，认知负担重，定位与变更扩散成本高。

---

## 2) High Coupling / Inappropriate Intimacy（耦合过高/边界亲密）

### 2.1 `features` 对 `ui` 的直接依赖
- 多个 feature hook 直接调用 `dialogConfirm/dialogPrompt/showToast`：
  - `useBuildDomain.ts`
  - `useBuildInteractionDomain.ts`
  - `useBaseLayoutDomain.ts`
  - `useBlueprintDomain.ts`
  - `useBlueprintHotkeysDomain.ts`
  - `useSimulationControlDomain.ts`
- 这使“业务协调层”与“展示/交互设施”耦合，削弱层间独立性。

### 2.2 `features` 对 `sim/engine.ts` 的跨层依赖
- `useBaseLayoutDomain.ts`、`useBuildInteractionDomain.ts` 直接依赖 `initialStorageConfig`。
- `useSimulationDomain.ts`、`useSimulationControlDomain.ts` 直接依赖引擎入口函数。
- 表明部分 domain 初始化职责散落在 feature 层，边界不纯。

### 2.3 `App` 到 UI 面板的深度 props 透传
- `LeftPanel` 与 `RightPanel` 的 props 数量庞大（行为函数、状态片段、格式化器、配置器并存）。
- 形成“接口面膨胀 + 组装耦合”：父层对所有细节高度知晓，子层复用边界变窄。

---

## 3) Shotgun Surgery 风险（单一需求变更牵动多处）

### 3.1 热键事件分散注册
- `window.addEventListener('keydown')` 分散在多个 feature hook：
  - `useBuildHotkeysDomain.ts`
  - `useBlueprintHotkeysDomain.ts`
  - `useBuildPickerDomain.ts`
  - `useKnowledgeDomain.ts`
- 输入处理策略分散，键位冲突或行为调整易引发多点联动修改。

### 3.2 设备分组与设备类型判断分散硬编码
- `getPlaceGroup` 中存在大量 `typeId` 条件链。
- 设备类型规则也散布于 UI/feature 层（如 belt/splitter/converger 识别）。
- 新增或重命名设备类型时，变更点高度离散。

---

## 4) Primitive Obsession / Magic String（原始类型执念与字符串业务）

### 4.1 大量 `typeId` 字符串字面量参与业务分支
- 例如：`'item_log_splitter'`、`'item_port_unloader_1'`、`startsWith('belt_')` 等在多处条件分支重复出现。
- 业务语义主要依赖字符串匹配而非更高阶语义封装。

### 4.2 业务标签字符串直接驱动逻辑
- 如矿石标签 `'矿石'` 驱动无限仓逻辑（`sim/engine.ts`），存在“文案级值参与核心规则”的味道。

---

## 5) Long Method / Complex Conditionals（长函数与复杂条件）

### 5.1 `App` 组件内逻辑块过长
- `App` 组件函数本体承担大量副作用、编排与渲染准备逻辑，阅读路径长。

### 5.2 `useBuildInteractionDomain` 与 `useBlueprintDomain` 内条件分支密集
- 事件驱动逻辑中多层 if/return 分支与状态守卫并行，理解成本高。

### 5.3 `RightPanel` 内嵌复杂条件渲染
- 设备类型、运行态、缓存态、配方态等条件组合深，局部 JSX 块复杂。

---

## 6) Data Clumps / Parameter Object Bloat（数据团簇与参数对象膨胀）

### 6.1 超大型参数对象
- `useBuildInteractionDomain` 的 `BuildInteractionParams` 下分 5 个子对象，每个对象含大量字段。
- 表现出“参数团簇”：多字段经常一起出现，接口表面积过大。

### 6.2 重复传递同类上下文
- 多处函数签名重复携带 `t`、`layout`、`selection`、`simIsRunning` 等上下文，接口噪音偏高。

---

## 7) Feature Envy / Layer Leakage（跨层越界）

### 7.1 领域 Hook 返回 UI 片段
- `useObservabilityDomain.tsx` 直接返回 `statsAndDebugSection`（ReactNode）。
- 使“domain hook”承担了视图拼装职责，形成层次泄漏。

### 7.2 领域决策与 UI 提示耦合在同一流程
- 多处业务分支中直接触发 toast/dialog，导致规则与交互反馈不可分。

---

## 8) Over-fragmentation / Speculative Generality（疑似“为拆而拆”）

### 8.1 部分 hook 价值密度偏低
- 存在少量较薄 hook（例如仅维护 1~2 组开关状态并附带单一副作用）。
- 与超重 hook 并存，说明模块颗粒度策略不一致：有的拆分较机械，有的仍集中。

### 8.2 “分层命名”与“真实职责”不一致
- 文件名为 `*Domain`，但实际包含 UI 交互控制、弹窗、键盘监听、文本反馈等多种职责。
- 表现为名义模块化强于实际模块化。

---

## 9) Readability Smell（可读性异味）

### 9.1 JSX 内联 IIFE
- 在 `App.tsx`、`RightPanel.tsx`、`useBuildConfigDomain.ts` 等位置出现 `(() => { ... })()`。
- 属于可用但不利于扫描理解的写法，增加阅读跳跃。

### 9.2 条件渲染深层嵌套
- 面板类组件中条件块数量多，局部上下文切换频繁。

---

## 三、模块化程度评估（结论）

- **有模块化框架，但未形成稳定的边界治理。**
- 目录结构已按 `domain/features/ui/sim` 组织，说明有明确分层意图。
- 但关键流程仍集中在超大文件，且跨层调用普遍，导致“结构上模块化、实现上中心化”。

---

## 四、模块耦合程度评估（结论）

- **整体耦合偏高，集中于编排层与交互层。**
- `App.tsx` 是高耦合汇点；feature hook 与 ui/sim 直连导致层间边界变薄。
- 面板组件 props 面积大，父层对子层实现细节高度知情，耦合进一步加深。

---

## 五、评分（每项满分 100）

> 评分基于当前代码结构与可维护性信号，不包含未来重构潜力。

- **模块边界清晰度：58/100**
  - 原因：目录分层明确，但职责穿透明显（feature 直接触达 ui/sim，domain hook 输出 JSX）。

- **模块内聚性：62/100**
  - 原因：部分模块内聚良好（如部分纯计算 domain），但超大模块内聚过载，多个职责粘连。

- **模块耦合度（低耦合得高分）：44/100**
  - 原因：`App` 高度汇聚依赖，跨层调用普遍，props 透传面广。

- **复杂度可控性：49/100**
  - 原因：多个超长文件 + 长逻辑路径 + 密集条件分支，复杂度热点集中。

- **可读性与可理解性：55/100**
  - 原因：命名总体可读，但 IIFE、深层条件渲染、超长函数降低扫描效率。

- **变更隔离能力：46/100**
  - 原因：热键、设备类型规则与交互反馈分散，需求变更易触发多点修改。

- **模块拆分合理性（避免“为拆而拆”）：57/100**
  - 原因：既有过重模块，也有偏薄模块，颗粒度策略不一致。

---

## 六、平均分

- 维度分数：58, 62, 44, 49, 55, 46, 57
- **平均分：53.0 / 100**

---

## 七、最终结论（一句话）

当前代码库属于“**有分层框架但耦合偏高、复杂度热点集中**”的状态，Code Smell 主要集中在中心化编排、跨层依赖、参数膨胀与条件复杂度四个方向。
