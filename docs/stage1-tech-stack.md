# Stage1 技术栈细化（Draft）

## 1. 决策目标

技术栈需要同时满足：

- 纯前端离线运行
- 兼容 GitHub Pages 静态托管
- 画布交互流畅（目标 50 台机器）
- 固定 tick 仿真稳定
- 为 Stage2 Worker 优化搜索预留升级路径

## 2. 推荐技术栈（主方案）

## 2.1 基础框架

- **TypeScript 5.x**：统一类型约束，降低状态与仿真错误。
- **React 18**：用于 UI 组件与状态订阅渲染，生态稳定、与现有画布库兼容性成熟。
- **Vite 5/6**：快速启动、构建轻量、原生支持 Web Worker 打包，适配静态产物部署。

## 2.2 画布与图元

- **Konva + react-konva**：
  - 适配网格、拖拽、框选、缩放、平移。
  - 内建图元事件与命中检测，减少底层 Canvas 事件管理复杂度。
  - 连接线绘制（直线/折线）实现成本低。

## 2.3 状态管理

- **Zustand**（配合中间件）：
  - 将“画布状态 / 仿真状态 / 统计状态”拆分为多个 slice。
  - 推荐使用 `subscribeWithSelector` 降低无关渲染。
  - 推荐使用 `persist` 中间件对接 localStorage。

## 2.4 仿真与计算

- **纯 TypeScript 仿真内核**（无框架依赖）：
  - 固定 tick（10Hz）逻辑放在独立模块。
  - 输入输出均使用明确 DTO，便于后续迁移到 Worker。

## 2.5 Worker 通信（为 Stage2 预置）

- **原生 Web Worker + Typed Message 协议**：
  - Stage1 可先不将仿真迁入 Worker。
  - 预留 `start/progress/result/cancel/error` 消息结构。
  - Stage2 再把布局搜索完全放入 Worker。

## 2.6 工程质量

- **ESLint + TypeScript ESLint**：类型与代码规范守卫。
- **Prettier**：统一格式。
- **Vitest**：仿真核心单元测试。
- **人工回归（Stage1）**：关键交互由手动测试覆盖（拖拽、连线、开始仿真/退出仿真）。

## 2.7 GitHub Pages 适配约束

- 输出必须是纯静态资源（HTML/CSS/JS/Worker）。
- 路由建议采用 Hash Router 或单页根路径策略，避免刷新 404。
- Vite 构建需设置正确 `base`，与仓库 Pages 路径一致。
- 禁止依赖 Node 服务端能力（如 SSR、API 中转）。
- localStorage 用于本地存档，不依赖远端数据库。

## 3. 为什么选这套

1. **与 PRD 贴合度高**：Konva 对画布交互支持成熟，Zustand 对状态拆分轻量。
2. **复杂度可控**：不引入重型流程引擎，先把 Stage1 闭环做稳。
3. **可演进**：Vite + Worker 迁移路径清晰，Stage2 不需要重写全栈。
4. **性能可达成**：50 机器规模下，Canvas 渲染 + slice 订阅可满足目标。

## 4. 不建议作为主方案的替代项

## 4.1 React Flow

- 优点：节点编辑器现成能力多。
- 不选原因：工业画布与自定义仿真耦合较重，后续定制成本不一定低于 Konva。

## 4.2 Redux Toolkit

- 优点：生态成熟，规范强。
- 不选原因：本项目中等规模，Zustand 心智负担更低，上手更快。

## 4.3 直接原生 Canvas（无 Konva）

- 优点：理论上更高自由度。
- 不选原因：事件系统、命中检测、层管理开发成本高，Stage1 不划算。

## 5. 最小依赖清单（建议）

- runtime：`react` `react-dom` `konva` `react-konva` `zustand`
- dev：`typescript` `vite` `@types/node` `eslint` `@typescript-eslint/*` `prettier` `vitest`

## 6. 与现有文档的衔接

- `stage1-prd-refined.md`：功能与边界来源。
- `stage1-data-dictionary.md`：类型定义来源。
- `stage1-simulation-spec.md`：仿真规则来源。

## 7. 已冻结实现参数（当前）

1. React 版本：18。
2. `/min` 统计方法：60 秒滑动窗口。
3. Stage1 不纳入 Playwright，采用人工干预测试。

## 8. 为什么当前不需要游戏引擎

## 8.1 需求匹配度

- 当前核心是 2D 网格编辑、连接关系管理、离散 tick 仿真与统计展示。
- 该类型问题更接近“工程编辑器 + 数据仿真”，不是高实时渲染驱动的游戏场景。
- 采用 React + Konva + TypeScript 已可满足 Stage1 功能密度与交互复杂度。

## 8.2 部署与运行成本

- 项目目标为纯前端并优先托管在 GitHub Pages。
- 游戏引擎 Web 版本通常带来更大包体与更慢首屏，不利于网页工具体验。
- 现有方案静态资源链路更短，构建、发布、回滚成本更低。

## 8.3 工程维护成本

- 当前团队主要需求是快速迭代产品规则（配方、状态、统计口径）。
- 引入游戏引擎会增加额外运行时与工具链学习成本，降低需求变更响应速度。
- 双体系（引擎逻辑 + Web UI 逻辑）会提高调试与测试复杂度。

## 8.4 计算扩展性

- 工厂运行计算的关键在于仿真内核与数据结构，而不是渲染引擎。
- 本项目已采用 TypeScript 仿真内核 + Worker 迁移路径，可独立扩展计算能力。
- Stage2 的优化搜索通过 Worker 即可实现并发与可中断，不依赖游戏引擎。

## 8.5 何时再评估引擎方案

满足以下任一条件时可重新评估：

- 明确引入 3D 视角与复杂镜头表现。
- 需要大规模实时特效、物理碰撞或高频动画系统。
- 目标从“工业规划工具”转向“重视觉体验的游戏化产品”。

在这些条件未出现前，保持当前 Web 工程方案是性价比最高选择。
