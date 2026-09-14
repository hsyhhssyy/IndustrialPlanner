# 网站来源与校验

下述协议由首次接入维护阶段实现并验证。日常执行者按主 checklist 调用已有入口、核对结果；遇到新 schema、引用形式或精度处理需求，报告差异，不临时开发解析器。

## 固定入口

站点根 URL：`https://hsyhhssyy.github.io/Endfield-Building-TopView-Assets/`。

| 路径 | 用途 |
| --- | --- |
| `assets-manifest.json` | `releaseId`、`sourceVersion`、建筑 ID、变体、建筑内容摘要和分级索引路径 |
| `integrity.json` | 全站 `files[].path / bytes / sha256`，及发布和建筑摘要 |
| `integrity.json.sha256` | `integrity.json` 原始字节的 SHA-256 锚点 |
| `release.json` | 发布来源、包含和排除策略；源仓库版本不等于项目版本 |
| `buildings/<id>/integrity.json` | 单建筑文件清单；文件路径相对该建筑目录 |
| `buildings/<id>/variants.json` | 建筑可交付视图；与根清单的 `variants` 对照 |
| `buildings/logistics/collection.json` | 物流集合，`deliveries` 指向静态、动态、空间及遮挡元数据 |
| `buildings/logistics/logistics-baked.json` | 烘焙相位页、共享流体数值场、参考 Shader、端帽与时间参数 |
| `buildings/logistics/fluid-profiles.json` | 独立物品配色表、相态、分层颜色和来源元数据；路径是否存在仍以本批索引为准 |
| `buildings/logistics/logistics-height.json` | 物流高度入口、组件引用、解码和装配契约 |

不要解析首页 HTML 来发现文件，不依赖私有仓库或 GitHub API，也不下载网站预览运行时、vendor、CSS 和草地背景作为建筑依赖。`preview/` 中的草地不构成项目草地替换授权。

## 一次发布的完整性链

- [ ] 用 HTTP GET 获取锚点、根索引和素材清单；对索引原始字节计算 SHA-256，与锚点比较。
- [ ] 先按索引校验素材清单的大小和哈希，再解析清单。校验 `schemaVersion`、索引 `algorithm`、发布编号、建筑数量、路径唯一性和逐文件大小/摘要的类型。
- [ ] 根清单和根索引的 `releaseId`、`sourceVersion` 必须一致；建筑 ID、`contentHash` 和分级索引引用必须一致。分级索引自身也必须通过根索引的字节校验。
- [ ] 分级索引的每项都必须与根索引中对应完整路径的大小和哈希一致。`contentHash` 用于定位建筑变化，实际文件仍逐个校验，不以名称或更新时间代替哈希。
- [ ] 根据选定视图的元数据遍历依赖；每个依赖都必须在已固定索引中，下载后同时校验长度与 SHA-256，保留原始字节。不能只下载 WebP 而沿用旧 JSON。
- [ ] 下载结束后重新获取索引锚点，确认与开头一致；若不同，则当前批次失败。不要自动接收新索引再继续旧下载。

同站锚点用于传输一致性和版本锁定，并不提供独立签名认证。站点路径可被更新，因此本地必须保存来源快照；只记录 URL 或 `releaseId` 不足以重现输入。

路径相对“声明该引用的 JSON 文件”解析，而不是全部相对站点根目录。合法的 `../spatial.json` 或共享依赖路径允许规范化，但解析后必须仍位于固定站点根路径、命中索引，且本地路径仍在本轮暂存目录内。拒绝协议切换、外域、查询参数、片段、重复编码逃逸和目录穿越。不能把 `resourceId` 当作 URL。

维护下载入口时，已有 HTTP 客户端、Node 标准库或 Python 标准库足够完成下载和哈希验证；不为此引入爬虫框架或新的生产依赖。日常执行者使用已验证入口，不在导入时重新选型。并发下载需有明确上限和超时，同批次不并发覆盖相同文件；有限重试按主 checklist 的决策表执行，失败不能留下可被误认为完成的来源记录。

## 依赖闭包

普通建筑：读取所选 `package.json` 及它引用的空间、端口、特效和遮挡元数据；读取动画阶段清单、时序 JSON、图集 JSON 及全部有效分页。以交付元数据枚举阶段和分页，不假设只有 `_000.webp`。

特效：先用端口/环绑定的 `resourceId` 查 `effects/resources.json`，再读取条目的 `path`、`effect.json`、图集、颜色分页及高度模板。共享特效当前随建筑分发；相同 ID 的内容一致才允许去重，冲突必须报告。

物流：从 `collection.json.deliveries` 的 `base / extension / spatial / occlusion` 及集合的 `heightMetadata / bakedManifest` 读取对应分支。静态图层、动态数据纹理、材质参数和高度图需要分别闭合引用。不要假设旧 ZIP 根目录的 `assets/manifest.json` 仍存在。

## 流体配色表

2026-09-14 已保存的独立表使用 `schemaVersion=1`、`profile=endfield-pipe-fluid-colors-v1`，数据位于 `fluidProfiles`。根字段还包括 `profileCount`、`phaseCounts`、`itemIds` 与来源元数据。烘焙清单的 `fluidProfileMetadata` 指向独立表，`fluidProfileCoverage` 描述覆盖；配色值同时保存在 `logistics-baked.json.fluidProfiles`。未来未知格式按 schema 差异处理，不从网页预览提取颜色。

下列为维护入口必须实现的验收契约；当前统一 `validate` 尚未自动覆盖字段与 Registry 对账，不得只凭其退出码勾选这些项：

- [ ] 独立表的原始字节与根索引、物流分级索引均一致，下载前后锚点一致；保留 `release.json`、根清单、根/物流索引、锚点及来源收据。
- [ ] `profileCount` 等于 `fluidProfiles` 的实际键数；`itemIds` 无重复且与键集合相等；`phaseCounts` 与实际相态统计相符。20 项及 11/9 只是历史实例，不写死为未来固定数量。
- [ ] 按当前 Registry 物品 ID 与相态对账，报告缺失、多出与相态冲突；网站新增项依主 checklist 的未映射规则处理，不新增项目物品。这里核对 Registry，不读取或推断解包 raw table。
- [ ] 液体有 `body / skin / skin2 / splash` 四层，气体有 `body / skin` 两层；各层保留来源 `hex / rgba8 / displayRgba8` 等字段，检查格式、四通道及整数范围 0–255。不能给气体伪造额外原始层，也不能用项目 tag 填补液体缺失层。
- [ ] 发布范围含配色时，核对独立表与 baked 表中同一物品的 ID、相态及原始各层颜色；两份文件必须来自同一固定发布。运行时字段转换不得回写网站原件。

仅留存请求适用 [当前入口与执行边界](project-import.md#已知能力缺口)；留存完成不代表发布或运行时接入。常见误判见 [原件留存与配色状态](lessons-learned.md#原件留存与配色状态)。

## 来源留存

正式执行导入时，把本轮实际消费的 JSON/WebP 原件和根/分级索引快照保留在项目资源来源目录；继续使用已有 `resources/device-sprite-animation/`、`resources/device-sprite-original/`、`resources/building-port-effects/`、`resources/logistics-materials/` 的职责分工。目录重排后仍须记录每个文件的原网站相对路径，不能丢失引用依据。

来源记录至少包含：站点根 URL、`releaseId`、`sourceVersion`、根索引原字节 SHA-256、获取时间，以及实际导入文件的远端路径、本地路径、字节数和 SHA-256。每个发布产物另外关联原件哈希、实际发布比例及所在版本目录；正式导入整批保存原版与全部配置版本，不能用一条集合级摘要掩盖版本缺失。按文件和实体记录来源；未选中的文件保留原来源。这种记录粒度不代表 CLI 已支持任意单建筑导入，范围仍依主 checklist。

`sourceArchiveSha256` 只表示已经存在的历史 ZIP 来源。不得把网站索引哈希写进它，也不得为网站虚构 ZIP 名称。网站来源记录和发布器的来源透传字段必须在首次接入维护阶段一起完成；日常执行者只按已实现协议填写。本技能创建或维护期间不提前修改既有来源事实。

原始 JSON 可能包含超过 JavaScript 安全整数范围的 `pathId`。原件始终按字节保存；需要重写包含这些字段的派生清单时使用无损整数读取方式（例如 Python 整数），不能用普通 `JSON.parse` 后整对象导出。派生运行时数据只提取需要的字段，原件与派生件的哈希分别记录。

## 已核查的协议基线

2026-09-13 核查过 `v1.5-20260913-195207-cst`：物流入口包含 6 个组件的空间/遮挡 JSON 与 8 张高度 WebP，均通过下载、哈希、尺寸及数值编码验证。这是协议实例，不是以后导入应固定的版本号或文件数量；每轮重新读取清单。
