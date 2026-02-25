# 终末地工业系统仿真器（IndustrialPlanner）

一个基于前端的工业系统编辑与仿真工具，用于模拟离散 Tick 下的设备生产、传送带物流、端口邻接连接与仓库统计。

## 项目定位

- 规则显式、可计算、可扩展的工业仿真工具
- 纯前端运行（无后端依赖），支持离线使用
- 聚焦工业规则验证，不做自动寻路与自动布局

## 当前能力（基于代码实现）

以下列表按当前源码行为整理，不仅来自 PRD。

### 编辑与交互

- 主模式：`放置` / `蓝图` / `删除`
- 放置模式内操作：`选择操作`、`铺设传送带`、`保存为蓝图`
- 画布交互：滚轮缩放（分段步进）、中键平移、右键取消当前放置或蓝图状态
- 设备交互：单选、多选、框选、拖拽移动、按 `R` 旋转

### 蓝图系统

- 支持将当前多选设备保存为命名蓝图
- 支持蓝图模式下选择并投放历史蓝图
- 支持 `Ctrl+C` 复制多选设备为临时蓝图
- 临时蓝图支持 `R` 旋转、左键放置、右键取消

### 物流系统

- 左键拖拽铺设传送带，路径长度至少 2 格才会提交
- 自动创建 `splitter` / `converger` / `connector`（桥接）
- 合法性策略：只提交“最长合法前缀”，非法尾段自动截断
- 支持孤立物流段（空地到空地）

### 删除系统

- 单格删除
- 整条传送带删除（按带拓扑连通）
- 框选删除（确认后执行）
- 一键删除所有可删设备（保留基础设施）

### 仿真与观测

- 启停控制：开始仿真 / 退出仿真
- 倍速：`0.25x` / `1x` / `2x` / `4x` / `16x`
- 统计：仓库库存、产出每分、消耗每分
- 调试：实测 Tick/s、当前 Tick、仿真秒数
- 详情：设备状态、缓存、带体槽位与进度、配方进度

### Wiki 与国际化

- 顶栏可打开内置 Wiki
- Wiki 支持：使用帮助、设备配方、物品配方
- 使用帮助支持两套版本：`新手版` / `高级版`
- 支持中英双语并持久化

## 技术栈

- React + TypeScript + Vite
- 本地持久化：localStorage

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 启动开发环境

```bash
npm run dev
```

### 3) 构建生产版本

```bash
npm run build
```

### 4) 本地预览构建产物

```bash
npm run preview
```

## 部署到 GitHub Pages

本项目已内置 GitHub Actions 工作流：

- 仅在 **发布 GitHub Release** 时自动构建并部署到 GitHub Pages
- 也支持在 Actions 页手动触发（`workflow_dispatch`）

对应工作流文件：`.github/workflows/deploy-pages.yml`

### 1) 发布版本（触发 Pages 部署）

#### 方式 A（推荐）：GitHub 网页手动发布

1. 打开仓库 `Releases` 页面
2. 点击 `Draft a new release`
3. 选择或创建版本标签（如 `v1.2.0`）
4. 填写标题与说明后点击 `Publish release`

发布完成后会自动触发 Pages 部署。

#### 方式 B（可选）：命令行发布

```bash
# 示例：发布 v1.2.0（会创建并发布 Release，从而触发 Pages）
gh release create v1.2.0 \
	--target v2 \
	--title "v1.2.0" \
	--notes "Release v1.2.0"
```

可选：先做一次构建校验再发布。

```bash
npm run build && gh release create v1.2.0 --target v2 --title "v1.2.0" --notes "Release v1.2.0"
```

> 若仅使用网页手动发布，可忽略命令行方式，无需安装 `gh`。

### 2) 仓库设置

在 GitHub 仓库中依次打开：

- `Settings -> Pages`
- `Build and deployment -> Source` 选择 `GitHub Actions`

### 3) 自定义域名

仓库已提供 `public/CNAME`，目标域名为：

- `endfield.anonymous-test.top`

发布后在 `Settings -> Pages` 中确认 `Custom domain` 显示该域名，并建议开启 `Enforce HTTPS`。

### 4) DNS 配置（你的域名服务商处）

为 `endfield.anonymous-test.top` 添加 `CNAME` 记录：

- Host/Name: `endfield`
- Type: `CNAME`
- Value/Target: `hsyhhssyy.github.io`

生效后可直接通过该域名访问页面。

## 操作方式（代码核对版）

1. 进入放置模式，先使用“选择操作”确认你可以正常选中与移动设备。
2. 放置取货口、生产设备、存储设备；在右侧详情配置取货物品与关键选项。
3. 点击“铺设传送带”，左键拖拽连接输入/输出端口。
4. 点击“开始仿真”，观察在途物品、仓库统计、设备状态和调试信息。
5. 出现停机后，按状态排查并回到编辑态修复，再次启动仿真验证。
6. 需要批量复用时，使用蓝图功能或 `Ctrl+C` 临时蓝图工作流。

## 目录结构

```text
.docs/               需求、架构、仿真规则、UI规范与开发指引
public/              静态资源（设备图标、物品图标、贴图）
src/domain/          领域模型、几何与物流规则、注册表
src/sim/             仿真引擎（Tick / Plan / Commit）
src/ui/              统一 UI 组件（Wiki、Toast、Dialog）
src/i18n.ts          中英文本与标签映射
```

## 领域数据与扩展约定

- 统一数据源文档：`.docs/domain-model-data.yaml`
- 新增物品时：同步更新领域模型与注册表，保证 `id` 唯一
- 新增配方时：至少补齐 `machineType`、`inputs`、`outputs`、`cycleSeconds`
- 若配方引用了未定义物品，必须先补物品定义
- 预置输入槽位：选择物品且当前数量为 0 时，默认数量自动设为 1
- 预置输入槽位：当数量被设置为 0 时，自动清空该槽位物品选择

## 设计与规则文档

- 产品规格：`.docs/prd.md`
- UI 规范：`.docs/ui-design-spec.md`
- Stage1 指南：`.docs/stage1/README.md`

## 开发注意事项

- 文档更新建议优先参考真实代码行为，并与 PRD 对齐差异
- 传送带、分流器、汇流器、桥接器均为显式设备实例
- 连接只基于端口邻接，不做寻路
- 统计口径按仿真时间，不受倍速按钮影响

## 许可证

当前仓库未单独声明开源许可证；如需对外分发，请先补充许可证策略。
