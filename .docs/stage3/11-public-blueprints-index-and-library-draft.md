# Stage3 草案：公共蓝图目录与索引机制（Public Blueprints）

> 状态：In Progress（需求已定稿，代码已部分落地）  
> 日期：2026-03-04  
> 目标：在 `public/blueprints` 下建立构建期索引，并在蓝图模式新增“公共蓝图”版块，启动时读取并落本地缓存。

## 1. 背景

当前蓝图来源主要依赖本地态（会话/本地存储）与运行期操作。新增“公共蓝图”能力后，项目可在构建产物中内置一批可发现的蓝图清单，供蓝图模式启动时自动加载。

公共蓝图提供方式（已确认）：
- 由用户先在系统内导出“有效蓝图”文件；
- 人工将蓝图文件放入 `public/blueprints` 目录；
- 通过执行独立命令 `npm run gen:blueprint-index` 生成索引（与网站运行/构建解耦）；
- 需要发布网站时，再单独执行 `npm run build`。

## 2. 需求摘要（当前已确认）

1. 在 `public` 下新增目录：`public/blueprints`。
2. 通过专用命令在该目录下生成一个“文件索引”。
3. 在蓝图模式新增版块：`公共蓝图`。
4. 每次启动时，从 `public/blueprints` 读取蓝图列表并保存到本地。
5. 公共蓝图文件来源为“人工投放 + 构建发布”，不包含运行时在线写入目录。

## 2.1 增量同步规则（2026-03-04 已确认）

1. 每次程序启动时**只读取索引**（不全量读取蓝图正文）。
2. 索引项至少包含：`id`、`blueprintVersion`。
3. 若本地已存在同 `id` 且 `blueprintVersion` 一致：
  - 不再请求该蓝图正文。
4. 若出现以下任一情况，才读取蓝图正文并写入本地：
  - 本地不存在该 `id`（新增蓝图）；
  - 本地存在该 `id` 但 `blueprintVersion` 低于索引版本（蓝图升级）。
5. 本地写入语义：将公共蓝图副本同步到本地存储（供后续离线/快速启动读取）。
6. 同步触发时机：进入蓝图模式时异步同步（不阻塞页面首屏交互）。
7. 本地公共蓝图集合需与远端索引保持一致：
  - 索引中不存在的本地“系统蓝图”需删除；
  - 仅保留与索引一致的系统蓝图版本。

## 3. 范围定义（草案）

### 3.1 In Scope

- 构建期扫描 `public/blueprints` 文件并生成索引文件。
- 通过独立 CLI 脚本扫描 `public/blueprints` 文件并生成索引文件。
- 前端启动时读取索引并拉取蓝图列表元数据。
- 蓝图模式渲染“公共蓝图”列表区。
- 将读取结果写入本地持久化（键名待定）。
- 支持“用户导出有效蓝图 -> 人工放置目录 -> build 生效”的资源投放流程。
- 本地存储分层管理“用户蓝图”和“系统蓝图（公共蓝图）”。

### 3.2 Out of Scope（先不做）

- 公共蓝图在线更新与远程 CDN 同步。
- 公共蓝图编辑回写到 `public/blueprints`。
- 蓝图权限系统与多用户共享策略。
- 运行时上传蓝图并自动写入静态资源目录。

## 4. 目录与文件契约（提议）

### 4.1 目录

- `public/blueprints/`

### 4.2 索引文件（提议）

- 文件名：`public/blueprints/index.json`
- 生成命令：`npm run gen:blueprint-index`
- 生成时机：由使用者手动执行，不自动绑定网站 `build` 或 `dev` 流程。

### 4.3 索引结构（提议）

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-03-04T00:00:00.000Z",
  "files": [
    {
      "id": "PublicBluePrint-HSY-550e8400-e29b-41d4-a716-446655440000",
      "blueprintVersion": "3",
      "name": "sample-blueprint.json",
      "path": "/blueprints/sample-blueprint.json",
      "size": 1234
    }
  ]
}
```

说明：
- `schemaVersion` 为索引文件结构版本（仅用于解析兼容，与蓝图内容升级无关）。
- `id` + `blueprintVersion` 为启动增量同步的最小比较键。
- `hash` 可选；若首版不做完整性校验，可先省略。
- 文件白名单仅支持 `.json`。
- 系统蓝图（公共蓝图）`id` 规范为 `PublicBluePrint-HSY-<UUID>`。
- 用户蓝图 `id` 规范为 `BluePrint-HSY-<UUID>`。
- 详细规则见：`12-blueprint-id-specification.md`。

字段口径补充：
- 公共蓝图是否更新，只看 `blueprintVersion`。
- 蓝图 JSON 内的 `version` 表示“创建于哪个游戏版本”，不参与公共蓝图增量同步判断。

## 5. 运行时行为（草案）

1. 用户进入蓝图模式时，异步请求 `/blueprints/index.json`。
2. 读取索引中的 `id/blueprintVersion/path`，与本地清单进行比对。
3. 对“新增或升级”的条目，才请求对应蓝图正文（如 `/blueprints/{file}.json`）。
4. 将新拉取的蓝图正文写入本地存储（按 `id` 覆盖或新增）。
5. 对“本地已是同版本”的条目，跳过正文请求。
6. 将本地“系统蓝图”中不在索引内的多余条目删除，保持与索引一致。
7. 若索引请求失败：
   - 使用本地缓存兜底；
   - 公共蓝图区显示“读取失败/暂无公共蓝图”。

### 5.1 同步伪流程（提议）

1. `remoteIndex = fetch(/blueprints/index.json)`
2. `localIndex = loadLocalBlueprintIndex()`
3. `toFetch = remoteIndex.items.filter(item => localIndex[item.id]?.blueprintVersion !== item.blueprintVersion)`
4. `for item in toFetch: fetch(item.path) -> saveLocalBlueprint(item.id, item.blueprintVersion, content)`
5. `toDelete = localSystemIds.filter(id => !remoteIndex.items.some(item => item.id === id))`
6. `deleteLocalSystemBlueprints(toDelete)`
7. `saveLocalBlueprintIndex(remoteIndex)`

### 5.2 本地命名与来源分层（已确认）

- 用户蓝图：`id` 必须为 `BluePrint-HSY-<UUID>`（示例：`BluePrint-HSY-550e8400-e29b-41d4-a716-446655440000`）。
- 系统蓝图：`id` 必须为 `PublicBluePrint-HSY-<UUID>`（示例：`PublicBluePrint-HSY-550e8400-e29b-41d4-a716-446655440000`）。
- 目标：禁止自动生成与同步流程产生同 `id` 冲突。

## 6. UI 口径（草案）

- 在蓝图模式增加版块标题：`公共蓝图`。
- 列表项首版展示：名称（必选）+ 文件名（可选）。
- 与现有“本地/当前蓝图”区并存，不替换既有入口。
- 蓝图模式内本地列表需区分展示“用户蓝图”与“系统蓝图”。

## 7. DoD（第一版建议）

1. `public/blueprints` 目录存在并可放置蓝图文件。
2. 仅 `.json` 文件参与索引生成；非 `.json` 文件被忽略。
3. 执行 `npm run gen:blueprint-index` 后可生成 `public/blueprints/index.json`。
4. 进入蓝图模式时异步请求索引，不全量请求蓝图正文。
5. 仅对新增/升级蓝图请求正文并写入本地；同版本蓝图不重复拉取。
6. 本地“系统蓝图”严格与索引一致：索引缺失项会被本地删除。
7. 本地存储可区分“用户蓝图”与“系统蓝图”。
8. `BluePrint-HSY-<UUID>` 与 `PublicBluePrint-HSY-<UUID>` 命名规范生效，避免同 `id` 冲突。
9. “公共蓝图”版块可展示本地已同步列表。
10. 刷新后可从本地缓存恢复最近一次读取列表与正文。
11. 索引缺失或读取失败不影响应用主流程（降级可用）。
12. 手工新增蓝图文件后，必须重新执行 `npm run gen:blueprint-index` 才能进入索引并被前端发现。

## 8. 风险与回滚

- 风险：索引生成遗漏文件导致 UI 列表与实际资源不一致。
- 风险：缓存与索引版本不一致导致旧数据残留。
- 回滚：公共蓝图区可按功能开关关闭；读取逻辑失败时退回仅本地蓝图能力。

## 9. 待补充实现细节（非阻塞）

1. 本地存储键结构（index 与 body 分开还是合并）。
2. 同步失败重试策略（指数退避/固定次数）。
3. 列表排序规则（按文件名/更新时间/自定义顺序）。

## 10. 当前实现情况（2026-03-04）

### 10.1 已落地代码

- 索引生成命令：`npm run gen:blueprint-index`。
- 索引脚本：`scripts/generate-blueprint-index.mjs`。
- 索引输出：`public/blueprints/index.json`。
- 蓝图同步：进入蓝图模式时异步读取索引，按 `id+blueprintVersion` 增量拉取蓝图正文。
- 强一致删除：本地系统蓝图中不在索引内的条目会删除。
- 本地分层：用户蓝图与系统蓝图分开存储，并通过迁移入口从 Stage1 旧键迁移。
- 面板展示：蓝图模式中“我的蓝图”在上，“公共蓝图”在下；公共蓝图分组常驻并支持空文案。

### 10.2 已接入文件

- `scripts/generate-blueprint-index.mjs`
- `src/migrations/versioning.ts`
- `src/features/blueprint/useBlueprintDomain.ts`
- `src/features/blueprint/useBlueprintHotkeysDomain.ts`
- `src/ui/panels/LeftPanel.tsx`
- `src/app/WorkbenchContext.tsx`
- `src/App.tsx`
- `src/i18n.ts`

### 10.3 与需求对照结论

- 目录与独立命令：已满足。
- 增量同步与删除机制：已满足。
- ID 规范与命名空间隔离：已满足。
- 公共蓝图 UI 分组与空态：已满足。
- 自动化回归测试：待补充。

---

维护说明：你后续补充需求细节后，本草案可拆分为“API/契约变更”和“回归测试计划”两份正式文档。
