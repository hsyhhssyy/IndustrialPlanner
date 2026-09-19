# 项目接入与发布

## 执行前就绪检查

当前已有网站入口，固定命令见主 checklist。2026-09-13 首次实跑已完成来源下载和暂存验收：1597 个源文件、31 个动画、20 个静态精灵、52 个高度视图、14 个共享特效，默认比例生成 846 个发布文件。6 项 Registry 绘图范围已获用户授权；该历史批次排除了物流。2026-09-14 的新版烘焙物流已另行接入并实跑：149 个原件、29 个新发布文件、76 个 retained 文件，整批应用 183 个变化文件。正式完成状态以应用记录及应用后验证为准。

| 能力 | 实现与已取得的证据 |
| --- | --- |
| 固定发布、下载及哈希校验 | `building-assets-site-source.py`；真实来源闭包通过，离线 HTTP 夹具覆盖缺文件、字节变化和发布切换 |
| 原始 JSON 与动画来源转换 | 同一 Python 工具的 `--metadata-only`；在临时批次内无损读取大整数，生成来源引用和阶段清单 |
| 静态图、动画分页、首帧及遮罩 | `publishDeviceSprite`、`publishDeviceSpriteAnimations`；普通图与动画均接受显式比例，半尺寸和四分之一夹具覆盖 |
| 物流材质、数值纹理及 Registry 配色 | `publish-logistics-baked.mjs`、`sync-registry-fluid-colors.mjs`；颜色逐帧缩放重排，数值场最近邻采样为 gzip RGBA8，独立配色表严格写入暂存 `ItemDefinition.fluidColors` |
| 高度和裁切特效 | `publish-building-port-effects.mjs`、`building-asset-image.mjs`；已修复补边与缩放顺序，回归覆盖奇数边长及已发布特效逐帧像素 |
| 来源关联和整批验收 | `import-building-assets.mjs validate`；检查原件、尺寸、页引用、数值字节与 Registry 配色，生成每个产物的来源关联与新增/替换/删除清单 |
| 整批应用与变更核对 | `import-building-assets.mjs apply`；新增、替换及陈旧物流发布文件删除均进入同一应用计划，应用后按摘要核对正式文件 |
| 已有映射实体的局部建筑导入 | 下载器 `--entity` 与发布器 `scope=entities`；只发布指定实体，合并并保留未选共享高度/特效，使用带实体集合摘要的独立历史收据 |

当前发布入口支持已有建筑映射的完整集合、一个或多个 `--entity` 已有映射实体、`--logistics-only` 物流集合，以及用户明确排除物流的建筑集合。完整集合直接发布烘焙物流；排除物流才执行 `defer-logistics`，将相关原件、材质、sprite/mask 移出本批。局部实体与仅物流模式合并共享高度 manifest，未选建筑、特效和数值文件按原字节保留。发布收据使用 `retained=true` 区分它们与本轮新产物；局部实体收据以实体集合摘要作为文件名后缀，不能覆盖完整导入收据。不得手工拼接清单绕过范围检查。

日常执行只运行已有入口，不能修脚本或重新设计协议。Registry 绘图范围不一致时，提交脚本给出的实际差异；需要跨模块修改时遵守项目授权规则。2026-09-13 正式批次已排除物流新交付并应用：1457 个原件、772 个新产物及 10 个保留高度文件。该数字只记录首次网站接入规模，不能充当以后批次的检查结果。

### 已知能力缺口

2026-09-14 技能复核：下面列的是尚未固化的执行能力，不能因本轮已有人工实跑证据而勾选“入口就绪”。只核对本次范围需要的能力，维护任务完成后再据实际命令和验证结果更新此表。

| 能力 | 当前状态与执行边界 |
| --- | --- |
| 仅留存配色表原件 | 项目不再接受原件写入仓库；下载结果只能存在于本次 `.temp/.trash` 批次，不能扩大为正式导入 |
| 本批全部比例的独立像素验收 | 独立像素回归已在 `src/tests/scripts/building-assets-site.test.ts` 和 `src/tests/renderer/building-height-effects.test.ts`；后者读取正式目录及当前来源配置。`validate` 仍为结构、尺寸、引用和编码校验，尚无接受本批暂存目录及全部比例的独立像素入口 |
| 可重复的真实浏览器场景 | 2026-09-14 曾完成三档验收，但尚无随技能提供的固定场景入口。需要此项而无已验证入口时，报告验证能力缺口，不临时重建历史夹具 |
| 检查基线自动比较与应用后对账 | 已有收据和 `apply`，尚无统一失败集合比较或应用后对账命令。按 [错题本](lessons-learned.md)核对已知字段，无法完成的项如实报告，不虚构命令 |

以上缺口的完善属于维护任务。日常执行者可以读字段、比哈希、按状态表选择已有命令；不承担新增发布器、像素算法、浏览器夹具或业务测试修复。

## Search-First 和处理边界

本流程选择 **Extend / Compose**：网站清单负责交付发现和来源锁定，项目已有素材清单负责实体映射，现有发布器负责像素处理和运行时协议。采用网站烘焙协议和参考 Shader，复用项目拓扑、仿真查询、Pixi Mesh 与数值上传；无需爬虫服务或版本绑定的导入命令。

素材任务的主模块为 Renderer，通常只需修改配套 `src/scripts`、`src/tests` 和资源目录。新增函数、类型或 import 前阅读 `.docs/common/项目模块隔离开原则发规范.md`；需要修改 Registry 或业务模块时遵守其中的授权边界。

先检查以下真实实现及本轮工作区改动；不要把归档注释当成有效代码：

| 位置 | 职责 |
| --- | --- |
| `resources/building-top-view-v15.json` | 已确认的 `entityId / spriteId / sourcePath` 映射、偏移和历史来源 |
| `src/scripts/building-asset-publish-config.mjs` | 发布比例常量及所有版本的独立输出目录，临时原件不参与应用 |
| `src/registry/index.ts` | `createRegistryContract` 公共入口，实体显示及动画能力声明 |
| `src/scripts/sync-device-sprites.mjs` | `publishDeviceSprite`、`publishDeviceSpriteAnimations` 通用发布函数；CLI 仅保留动画和蓝图遮罩重发 |
| `src/scripts/device-sprite-animation-publisher.mjs` | 分页、逐帧时间线、变换、静态帧和并集遮罩；单版本调用默认使用比例常量的第一项 |
| `src/scripts/publish-building-port-effects.mjs` | 高度数值图发布、端口和环绑定、共享特效发布 |
| `src/scripts/publish-logistics-baked.mjs` | 网站烘焙相位图集、数值场、端帽与静态回退发布 |
| `src/scripts/sync-registry-fluid-colors.mjs` | 校验独立配色表，用 TypeScript AST 精确替换既有 `ItemDefinition.fluidColors` 初始化值 |
| `src/scripts/publish-logistics-materials.mjs` | 仅保留共享像素合成与静态图集函数；旧发布器已归档 |
| `src/shared/device-sprite-animation.ts` | 当前动画协议、分页限制和校验 |
| `src/shared/logistics-material.ts`、`src/shared/logistics-baked.ts` | 线路拓扑、烘焙协议与纯流体状态机 |

上表中的既有发布器负责像素处理；网站统一入口是 `import-building-assets.mjs`。其 CLI 默认路径可能指向已导入的历史来源，不能当作网站导入命令直接运行。需要组织数据时使用已验证的显式输入/输出参数；若接口仍强制依赖旧包总清单，归入首次接入维护，不由日常执行者临时扩展。维护时让处理器消费新清单解析后的视图/资源，不能伪造 ZIP、空 `ports.json` 或旧目录兼容层绕过校验。沿用相同的像素处理函数和测试，不重写已有算法。

## 临时原件与全部发布版本

`BUILDING_ASSET_PUBLISH_RESOLUTIONS` 是唯一比例配置，以下只是修改配置时的示例，不能作为另一份默认值：

| 配置值 | 同一次导入必须完成的产物 |
| --- | --- |
| `[0.5]` | 批次内一份原件和一份 `public` 半尺寸版 |
| `[0.25]` | 批次内一份原件和一份 `public` 四分之一尺寸版 |
| `[0.5, 0.25]` | 批次内同一份原件，加两份独立的 `public` 发布版本 |

通过 `resolveBuildingAssetPublishTargets(outputRoot)` 取得整个列表，不得只读取第一项作为网站导入范围。原件只下载到批次 `site/` 一份，各比例直接从该目录生成；整批验收后只把派生产物应用到正式根目录 `public/3d-top-view`。第一项直接使用根目录，后续项使用 `variants/resolution-<比例>/`；每个根目录包含各自的 `sprites / sprite-masks / animations / logistics / port-effects` 等对应资产，不从已缩小的发布图生成另一版。

第一项是当前运行时路径使用的版本；增加其他版本不自动新增设备分档、响应式开关或运行时版本选择器。额外版本的产物和来源必须完整，但应用何时选择它们是另一个需求。

同一版颜色图和对应遮罩必须使用同一比例。网格素材的 `宽 × resolution`、`高 × resolution` 必须得到正整数。裁切特效允许在右侧和底部补透明边界，随后逐帧缩放、重新排布；例如 165 像素宽在半尺寸下发布为 83 像素，密度仍为原值乘比例，pivot 同步乘比例。不能直接对整张特效图集缩放或截断坐标。逻辑占地、世界位置、动画帧数和逐帧时长保持原义。动画 manifest 保留原逻辑 `frameWidth / frameHeight`，用 `resolution` 声明实际纹理密度；像素 frame rect、pivot 和采样比例依据各自协议更新，不能把逻辑坐标全部乘比例。

生成后按每个实体、类别和比例检查原件哈希、源到产物关联、图片实际尺寸、遮罩尺寸、元数据及所有引用。来源记录须标明每个产物的比例与原件哈希；不同版本的 manifest 都来自同一发布，不能复用不匹配的分页坐标。

各类发布器的实际支持情况以上方就绪检查为准。比例适配必须在进入日常导入流程前完成，不能留到导入途中再修改。此技能要求所有适用类别完成目标版本；配置常量本身不代表各处理器已具备相应能力。

高度、UV/流场等数值纹理必须遵循数据语义，不能套颜色图的 Lanczos 滤波。若要改变其采样密度，必须同时处理数据有效性、采样坐标、pivot 和运行时消费契约；不能插值 RG16 打包字节，或让高度图与颜色图错位。缺少合法缩放策略时停止该批次并报告具体缺口，不擅自把该项改为原尺寸例外。

## 映射与普通静态图

- 按项目清单的 `sourcePath` 匹配网站 `<buildingId>/<view>`；网站目录多出的 `buildings/` 或 `logistics/` 是传输布局，不是 Registry ID。
- 同一网站视图可以映射多个项目实体。保留所有已确认的别名、变体和 spriteId，不能靠中文文件名、英文翻译、默认模式或拼接后缀替代映射。
- `package.json`、`spatial.json` 和图集元数据共同验证画布/帧尺寸。普通图像契约为左上原点、`x=+sourceX`、`y=+sourceZ`，通常为 128 像素/格；遇契约变化先停止定位。
- 静态源阶段按实际交付检查 `static`、`bind_pose`、`close_idle`；均不存在时仅允许来源明确声明 `static=true` 的唯一阶段。项目未声明动画的材质动画阶段只发布第一帧，完整源帧仍保留；裁切范围来自图集单元，不能直接把整张多帧图集当成静态图。
- 比例输入及覆盖遮罩处理在首次接入维护中完成后，复用 `publishDeviceSprite` 的像素处理能力生成各目标版本的 WebP 和 mask。源 WebP 不重编码；只有发布产物执行裁切、坐标变换和配置比例缩放。

普通建筑从源平面到项目平面的转换为 `projectY = depth - 1 - sourceZ`，在**每个帧单元内**上下翻转。禁止翻转整张多帧图集、重新居中、透明边裁切或沿用旧中文 PNG 映射中的经验旋转。

由源空间元数据计算显示范围：

```text
spriteOffset.x      = -footprintRectCells.left
spriteOffset.y      = footprintRectCells.top + footprintRectCells.height - canvasCells.height
spriteOffset.width  = canvasCells.width
spriteOffset.height = canvasCells.height
```

计算结果与 Registry 不一致时列出差异；不因素材导入就静默改逻辑占地或端口。源空间 JSON 原样保留，发布变换另记，避免播放器重复转换。

## 动画来源清单

网站原件按索引路径只保存在本次批次 `site/`。`resources/device-sprite-animation/<spriteId>/manifest.json` 是小型派生来源清单，只记录 `sourceSite` 版本证明与 `sources.*.sourcePath`；发布器通过批次显式 `sourceAssetRoot` 读取原件，不在仓库内为任何 spriteId 保存图片副本。批次收据和历史对照只用于本次验收，应用后随批次清理。

- [ ] 读取阶段的 `animation.json` 和 `spritesheet.json`，核对 `fps`、单元大小、每页像素尺寸、行列数、`frameStart / frameCount` 和实际文件哈希。
- [ ] 每页成为一个独立 source。分页的 `frameDurationsMs` 来自 `animation.frames[frameStart:frameStart+frameCount].durationMs`，须数量相同且全部为正值；不能按统一 FPS 抹掉长停留帧。
- [ ] 每个 source 记录本地文件名、原网站路径、哈希、行列数、帧数和时长。逻辑 clip 的 range 使用 source 名称、`startFrame`、`frameCount`，不得越界。
- [ ] 发布四阶段为 `open / open_idle / close / close_idle`。源帧数、布局和逐帧时序完全一致时才保留已确认的阶段切分；明确交付四阶段时由已验证转换器处理。缺少过渡阶段时，只能沿用该实体已经确认的单帧 idle 占位策略；新的、含糊的阶段变化交由维护者处理，日常执行者不重新设计阶段切分。
- [ ] manifest 声明 `frameTransform: flip-top-bottom` 及独立来源信息；分页行列使用当前发布器限制，保持单页边长严格小于运行时上限。
- [ ] 以当前 Registry 的 `spriteAnimation` 能力作为发布门槛，显式传递本次 `spriteIds` 集合。没有动画声明的源不能绕过 Registry 校验；不得误发布未选中的旧源目录。

每个目标版本显式传入其 `resolution`，不能依赖单版本函数默认值生成整个列表。动画分页、动画遮罩、静态首帧和静态遮罩都使用该比例；后两项的适配是执行前置条件。逻辑画布、渲染分辨率与源帧像素分别验证；不另写平行像素处理实现。

## 高度与端口特效

普通建筑从 package 的实际引用进入 `spatial / ports / occlusion / effects`，不假定共享特效在站点根目录。交付键优先精确匹配模板键；只有 `deliveryVariantSelection=single-view`、唯一交付键、唯一模板且 `deliveryMode` 精确匹配模板模式时，发布器才按该明确选择关联，并写入 `normalizations`。其他不一致仍报错。保留 `resolvedTransform`、`resourceBinding`、`deliveryVariantKeys` 和当前 Registry 已确认的变体组合；未解析键和锚点冲突不能通过猜测修正。

高度图使用 RG16 数值编码：

```text
q = 256 * R + G
localY = heightMin + q / 65535 * (heightMax - heightMin)
A = 0 表示空，A = 255 表示有效表面，B 必须为 0
```

逐图核对哈希、宽高、有效像素数/范围和字段引用。高度数据不做 sRGB 转换、插值、有损重编码或 mipmap。按像素中心取最近样本并完整复制 RGBA，再 gzip 发布。网站发布器的物流 UV/流场等 `linear-data` 纹理使用 `.rgba.bin`；该编码由 `LogisticsMaterialTextureCache` 解压并上传 RGBA8，禁预乘、mipmap 和颜色空间转换。Shader 对打包 mapping 取目标像素中心，其他场允许双线性采样；不能用 WebP 重编码替代数值协议。

普通建筑高度和特效需要同步反射像素、pivot、origin、端口/环位置及图集 frame rect。物流 `sourceAssembly.canonicalSourceZReflection` 所声明的 canonical 画布走既有物流契约，不套用普通建筑的逐帧反射规则。

## 物流交付

当前入口为 `collection.json.bakedManifest` 指向的 `logistics-baked.json`，要求 `schemaVersion=2`、`format=logistics-spritesheet-v2`、`fluidPlayback.kind=baked-spatial-field-v2`。原始分层 contract 2 JSON 只在导入批次中参与校验，运行时不消费也不在仓库留存。协议变化时停止并报告，不让日常执行者改 Shader。

- [ ] 下载闭包包含相位页、`fluid-data` / `gas-field`、所有静态组件、端帽，以及 `heightMetadata` 的空间/遮挡分支。
- [ ] 颜色帧恢复源逻辑画布后逐帧缩放，保留透明裁切偏移，再加挤出边重排；不能整体缩放旧图集。源中未消费的两张 256 像素 pattern/chevron 原图只归档，相位帧负责显示。
- [ ] 数值场按配置比例最近邻复制 RGBA 后 gzip；保留透明像素中的数据。世界占地和规范采样坐标不随纹理密度改变。
- [ ] 支架颜色层已在网站中装配，放置时只应用整节方向，不能再套旧发布器的局部 90° 旋转。
- [ ] 静态回退图只生成空管，配色使用共享纹理的 Shader 参数，不按物品另烘焙。`public` 只保留 manifest 引用的共享页；旧按颜色管道图和已退役 `animations/logistics-contract2` 由应用删除计划清理。
- [ ] 六个 sprite/mask 与 `logistics/static` 同批生成；源文件只保留一份，全部比例各自独立发布。
- [ ] 端帽 composite/whitening 均有合法帧引用；运行时在每条非闭环管道的真实首尾放置，连接设备也保留，单格放两个，内部格缝不重复。
- [ ] 高度来自 `logistics-height.json.components` 的真实引用；`stateMapping=null` 是无不透明遮挡。裸直管及流体不产生不透明高度，支架与弯段使用已装配高度图，禁止再次反射或局部旋转。

物流公共纹理由 Renderer 提前上传并常驻至销毁，不受设备动画开关控制。流体是每条连续管道一个 Mesh；普通模式由真实占用驱动水头、退场、反向恢复及换液，精确模式按真实有液格输出索引、禁水头与粗细过渡，内部流动仍播放。颜色参数不产生独立纹理，因此没有每颜色 20 秒卸载计时器。

### 配色来源与接入状态

2026-09-14 曾留存 `v1.5-20260914-122929-cst` 的独立配色表，含 20 项（11 液体、9 气体）；2026-09-19 起原件退出工作树，后续导入从网站批次临时读取并在应用前对账。旧 `scope=fluid-profiles / sourceOnly=true / published=false` 只属于历史记录，不再定义当前存储策略。

【用户明确要求】流体颜色的唯一运行时真源是 `ItemDefinition.fluidColors`：液体声明 `body / skin / skin2 / splash`，气体声明 `body / skin`。`liquid` / `gas` tag 继续负责物品域；`liquid_color:`、`gas_color:`、`fluid_color:` 已退出 Active Code。蓝图管道、烘焙管道与气体扩散范围均从 Registry 物品定义取色，未知物品或缺少对应分层时统一回退 `#808080`。

独立美术表仍是上游权威原件和自动对账依据，但应用不生成或维护按物品 ID 的 shared/public 配色副本。物流 baked manifest 只承载纹理、相位与 Shader 协议，不再发布 `fluidProfiles`。`publish-logistics` 调用 `sync-registry-fluid-colors.mjs`，用 TypeScript AST 只替换暂存 `src/registry/item-definition.ts` 中现有物品的 `fluidColors` 初始化值；物品集合、相态、角色层、字节或 hex 不一致时失败，不新增物品、不修改 tag。

- [x] 已按 [配色表协议](site-source.md#流体配色表)核对原件、物品 ID、相态和分层颜色；当前留存表与 Registry 均为 20 项，缺失、多出和相态冲突均为空。
- [x] 已保持原件收据的 `sourceOnly / published=false` 历史状态，没有追溯改写为全量素材发布。
- [x] Registry 配色对账测试校验来源 SHA-256、ID 集合、相态、逐层 hex 与颜色 tag 退役状态。
- [x] baked 发布器和运行时 manifest 已退出 `fluidProfiles`，Renderer 统一消费 `ItemDefinition.fluidColors`。
- [x] 正式物流发布入口会生成并验收暂存 Registry 配色；应用计划同时清理受管物流目录中没有新产物的陈旧 public 文件。

## 应用与验证

来源校验、映射对账和所有比例的派生发布在本轮临时目录完成。原件与任一目标版本缺失、哈希错误或尺寸不符时，整个批次不进入正式目录。应用计划不得包含网站展开原件；应用前列出实际目标文件，目标文件存在未提交修改时停止，避免把用户改动混入素材批次。完成后的历史回退以 Git 提交为准，不长期保存本地恢复副本。应用失败或中断时记录实际 Git diff 并停止，只有获得用户明确授权后才能执行 Git 回退。

网站来源字段及对应测试在首次接入维护阶段完成；实际导入时按已实现的来源协议填写。旧文件的 ZIP 来源继续如实保留，不能追溯改写成网站来源。项目资源说明中的历史导入数量、旧失败记录或手工确认事项也不能自动当成当前结果。

验证重点：批次内源图原字节通过索引校验且不会进入应用计划；静态图和 mask 尺寸一致；动画阶段/页/帧/时长完整；显示范围与 Registry 对齐；高度数值及特效依赖完整；物流形状和状态映射有效。应用内观察四角旋转、动画开关、蓝图样式和物流遮挡，遵循项目三个 Screen Profile 及串行清理要求。

`resources/building-port-effects/README.md` 与 `source.json` 只保留旧交付说明和摘要；旧展开资产已退出仓库，不能作为网站入口或可重发来源。

## 实跑发现的清单差异

- 页面文件名可以是 `image` 或 `file`；哈希以已固定根索引为准，页面另有哈希时必须相同。
- 页面 `rows` 有时表示使用行数，图片仍保留透明尾行。按图片像素尺寸与帧尺寸计算物理网格，并校验使用行数不越界、未使用格透明。
- FPS 从各阶段 `animation.json` 核对；不能要求每份 package 都重复提供。
- 四阶段均明确交付时直接采用来源；缺少阶段时只复用已确认的帧范围，并核验帧数和显式时长。
- 发布失败后的重跑条件见 [批次重试与清理](lessons-learned.md#批次重试与清理)；重跑后仍完整验收全部类别和比例，不能沿用过期应用清单。
