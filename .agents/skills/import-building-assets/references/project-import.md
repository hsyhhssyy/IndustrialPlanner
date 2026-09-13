# 项目接入与发布

## 执行前就绪检查

当前已有网站入口，固定命令见主 checklist。2026-09-13 首次实跑已完成来源下载和暂存验收：1597 个源文件、31 个动画、20 个静态精灵、52 个高度视图、14 个共享特效，默认比例生成 846 个发布文件。正式应用仍等待 6 项 Registry 绘图范围的跨模块授权，不能据此声称端到端导入已经完成。

| 能力 | 实现与已取得的证据 |
| --- | --- |
| 固定发布、下载及哈希校验 | `building-assets-site-source.py`；真实来源闭包通过，离线 HTTP 夹具覆盖缺文件、字节变化和发布切换 |
| 原始 JSON 与动画来源转换 | 同一 Python 工具的 `--metadata-only`；保留原始字节与大整数，生成原件引用和阶段清单 |
| 静态图、动画分页、首帧及遮罩 | `publishDeviceSprite`、`publishDeviceSpriteAnimations`；普通图与动画均接受显式比例，半尺寸和四分之一夹具覆盖 |
| 物流材质及数值纹理 | `publish-logistics-materials.mjs`；颜色图按比例发布，数值图最近邻采样为 gzip RGBA8，避免 WebP 清零透明像素 RGB |
| 高度和裁切特效 | `publish-building-port-effects.mjs`、`building-asset-image.mjs`；高度与特效均已实际生成并验收 |
| 来源关联和整批验收 | `import-building-assets.mjs validate`；检查原件、尺寸、页引用、数值字节，生成每个产物的来源关联与写入清单 |
| 备份、应用及恢复 | `apply / restore` 入口；恢复夹具已运行，正式批次尚未应用 |

当前发布入口只支持已有映射的完整集合及物流集合。下载器的 `--entity` 仅支持限定来源核查；**不能用于正式局部导入**。局部发布需要合并共享 manifest，当前入口会明确拒绝，执行者不能通过手工拼接绕过。

日常执行只运行已有入口，不能修脚本或重新设计协议。Registry 绘图范围不一致时，提交脚本给出的实际差异；需要跨模块修改时遵守项目授权规则。首次试运行后尚未完成的正式应用、应用后基础检查与完整场景验证，应保持未完成状态。

## Search-First 和处理边界

本流程选择 **Extend / Compose**：网站清单负责交付发现和来源锁定，项目已有素材清单负责实体映射，现有发布器负责像素处理和运行时协议。无需另建播放器、纹理协议、爬虫服务或版本绑定的导入命令。

素材任务的主模块为 Renderer，通常只需修改配套 `src/scripts`、`src/tests` 和资源目录。新增函数、类型或 import 前阅读 `.docs/common/项目模块隔离开原则发规范.md`；需要修改 Registry 或业务模块时遵守其中的授权边界。

先检查以下真实实现及本轮工作区改动；不要把归档注释当成有效代码：

| 位置 | 职责 |
| --- | --- |
| `resources/building-top-view-v15.json` | 已确认的 `entityId / spriteId / sourcePath` 映射、偏移和历史来源 |
| `src/scripts/building-asset-publish-config.mjs` | 发布比例常量及所有版本的独立输出目录，原版不参与缩放 |
| `src/registry/index.ts` | `createRegistryContract` 公共入口，实体显示及动画能力声明 |
| `src/scripts/sync-device-sprites.mjs` | `publishDeviceSprite`、`publishDeviceSpriteAnimations` 通用发布函数；CLI 仅保留动画和蓝图遮罩重发 |
| `src/scripts/device-sprite-animation-publisher.mjs` | 分页、逐帧时间线、变换、静态帧和并集遮罩；单版本调用默认使用比例常量的第一项 |
| `src/scripts/publish-building-port-effects.mjs` | 高度数值图发布、端口和环绑定、共享特效发布 |
| `src/scripts/publish-logistics-materials.mjs` | `materialContractVersion: 2` 物流材质合成与发布 |
| `src/shared/device-sprite-animation.ts` | 当前动画协议、分页限制和校验 |
| `src/shared/logistics-material.ts` | 当前物流材质协议 |

上表中的既有发布器负责像素处理；网站统一入口是 `import-building-assets.mjs`。其 CLI 默认路径可能指向已导入的历史来源，不能当作网站导入命令直接运行。需要组织数据时使用已验证的显式输入/输出参数；若接口仍强制依赖旧包总清单，归入首次接入维护，不由日常执行者临时扩展。维护时让处理器消费新清单解析后的视图/资源，不能伪造 ZIP、空 `ports.json` 或旧目录兼容层绕过校验。沿用相同的像素处理函数和测试，不重写已有算法。

## 原版与全部发布版本

`BUILDING_ASSET_PUBLISH_RESOLUTIONS` 是唯一比例配置，以下只是修改配置时的示例，不能作为另一份默认值：

| 配置值 | 同一次导入必须完成的产物 |
| --- | --- |
| `[0.5]` | 一份 `resources` 原版和一份 `public` 半尺寸版 |
| `[0.25]` | 一份 `resources` 原版和一份 `public` 四分之一尺寸版 |
| `[0.5, 0.25]` | 同一份 `resources` 原版，加两份独立的 `public` 发布版本 |

通过 `resolveBuildingAssetPublishTargets(outputRoot)` 取得整个列表，不得只读取第一项作为网站导入范围。第一次以临时发布根目录解析并生成；整批验收后再按相同布局应用到正式根目录 `public/3d-top-view`。第一项直接使用根目录，后续项使用 `variants/resolution-<比例>/`；每个根目录包含各自的 `sprites / sprite-masks / animations / logistics / port-effects` 等对应资产。原件仍只有一份，不为每个比例重复下载，也不从已缩小的发布图生成另一版。

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

网站原件按索引路径保存在 `resources/building-assets-site/<releaseId>/`，同一视图的多个 spriteId 共用原件。`resources/device-sprite-animation/<spriteId>/manifest.json` 是派生来源清单，通过 `sourceSite.relativeRoot` 与 `sources.*.sourcePath` 引用原件；不再为每个 spriteId 复制一套图片。历史清单保存在本次原件目录的 `_import/` 下，不把 ZIP 来源改写成网站来源。

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

逐图核对哈希、宽高、有效像素数/范围和字段引用。高度数据不做 sRGB 转换、插值、有损重编码或 mipmap。按像素中心取最近样本并完整复制 RGBA，再 gzip 发布。物流 UV/流场等 `linear-data` 纹理也使用 `.rgba.bin`，运行时解压后通过 `BufferImageSource` 上传 GPU；不得转回 WebP。

普通建筑高度和特效需要同步反射像素、pivot、origin、端口/环位置及图集 frame rect。物流 `sourceAssembly.canonicalSourceZReflection` 所声明的 canonical 画布走既有物流契约，不套用普通建筑的逐帧反射规则。

## 物流交付

- `collection.json.deliveries` 是当前集合入口，静态、动态、空间和遮挡分支各用自己的路径；不能把 `collection` 当普通建筑 `top` 视图。
- 原始分层材质继续使用 `materialContractVersion: 2`；网站的 `logistics-baked.json` 是另一种烘焙布局，不是项目运行时 manifest 的直接替代品。日常导入沿用已验证的分层交付转换；网站仅提供另一种布局时停止并报告，不能自行选择格式、更换项目播放器。
- 从 `heightMetadata` / `logistics-height.json.components` 解析空间和遮挡引用，再以各 `occlusion.fields[].file` 找到高度图。跟随 `stateMapping` 选择命名高度字段；`null` 明确表示无不透明遮挡，不能视为漏文件。
- 裸直管的透明管壁及流体不写入不透明高度；带支架直段使用 `straightWithSupport`，弯段使用 `left / right`，以本轮实际清单为准。
- 高度图已经烘焙 `sourceAssembly` 的局部旋转和平移，放置时只应用整段变换。2026-09-13 交付的直段支架高度图已含局部 90° 旋转，不能再次应用。当前颜色发布器另有分层旋转规则，应按颜色来源契约分别核查，不能把高度规则机械套给颜色。
- 物流新交付没有普通建筑的端口/环特效描述，不应要求美术补旧流程中的空占位文件；以物流集合契约发布其材质和遮挡。

## 应用与验证

来源校验、映射对账和所有比例的派生发布在本轮临时目录完成。原版与任一目标版本缺失、哈希错误或尺寸不符时，整个批次不进入正式目录。应用前列出实际目标文件并保留受影响文件的恢复副本，保护用户原有修改；应用失败时按本轮文件清单恢复到应用前状态，不执行 Git 文件操作。失败时保留可定位的错误证据，不能声称批次完整。

网站来源字段及对应测试在首次接入维护阶段完成；实际导入时按已实现的来源协议填写。旧文件的 ZIP 来源继续如实保留，不能追溯改写成网站来源。项目资源说明中的历史导入数量、旧失败记录或手工确认事项也不能自动当成当前结果。

验证重点：源图原字节保留；静态图和 mask 尺寸一致；动画阶段/页/帧/时长完整；显示范围与 Registry 对齐；高度数值及特效依赖完整；物流形状和状态映射有效。应用内观察四角旋转、动画开关、蓝图样式和物流遮挡，遵循项目三个 Screen Profile 及串行清理要求。

`resources/building-port-effects/README.md` 属于旧交付原文，`source.json` 仍记录其历史字节摘要。它可用于理解旧资产，不能作为网站入口说明或新的权威来源；不要为了改文案破坏原始来源快照。

## 实跑发现的清单差异

- 页面文件名可以是 `image` 或 `file`；哈希以已固定根索引为准，页面另有哈希时必须相同。
- 页面 `rows` 有时表示使用行数，图片仍保留透明尾行。按图片像素尺寸与帧尺寸计算物理网格，并校验使用行数不越界、未使用格透明。
- FPS 从各阶段 `animation.json` 核对；不能要求每份 package 都重复提供。
- 四阶段均明确交付时直接采用来源；缺少阶段时只复用已确认的帧范围，并核验帧数和显式时长。
- 发布失败后可重跑失败类别；暂存验收仍必须覆盖所有类别，任何缺项都不能应用。
