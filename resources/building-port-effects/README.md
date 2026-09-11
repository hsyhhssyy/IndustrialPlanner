# 建筑前端资源使用说明

本包供固定俯视角的 PixiJS / Canvas 场景使用。入口为 `assets/manifest.json`，列出建筑、模式变体及去重后的共享特效。所有 JSON 文件中的文件引用都相对于该 JSON 自己所在的目录解析。

范围为当前版本已有的有效建筑交付。净水节点 `liquidcleanfactory_005_1` 的旧 32×16 页面已撤回格子素材包，只能用于外观预览；由于实际网格原点与四台设备的运行时位置尚未恢复，不在本包中。它需要另行恢复坐标，不能直接按旧画布尺寸放进地图。

## 资源与加载

| 文件 | 用途 |
| --- | --- |
| `assets/manifest.json` | 全包入口，建筑变体和共享特效索引 |
| 每个建筑的 `package.json` | 建筑动画及 `portMetadata`、`occlusionMetadata`、`effectResources` 入口 |
| `sequence.json`、`animations/*/animation.json` | 建筑动画播放顺序、帧时长和状态 |
| `animations/*/spritesheet.json`、WebP 图集 | 建筑颜色帧，保持原有交付的画布和动画 |
| `spatial.json` | 画布、占地范围、像素比例、原点与锚点 |
| `ports.json` | 当前模式的有效管道端口、ON/OFF 资源和独立环的显示绑定 |
| `occlusion/occlusion.json`、高度 WebP | 建筑的一份或少量命名姿态遮挡高度图 |
| 共享 `effect.json`、`spritesheet.json`、WebP | 环或 ON/OFF 的独立颜色动画、位置锚点和高度模板 |

使用全包中现有的相对路径即可。单建筑包为了独立使用会包含自身引用的特效；本总包把相同资源移到了公共目录，已经改好引用。不要在前端重新拼接固定的建筑内特效路径。

传送带、普通管道与支架的 `materialContractVersion: 2` 交付保留原有 `staticManifest` / `dynamicManifest` 接口，不使用建筑的 `animations/` 目录。静态模式读取静态图层；动态模式按动态清单使用材质参数、映射数据和滚动纹理。新增高度图不会替代其已有动画。管道遮挡只计入不透明支架，透明管壁和液体不写入不透明高度缓存；按 `stateMapping` 选择直段带支架或左右弯支架字段，值为 `null` 时跳过高度写入。支架装配高度沿用此前已明确的近似值。

```js
async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return { url: response.url, value: await response.json() };
}
const root = await readJson(new URL('assets/manifest.json', assetBaseUrl));
const item = root.value.buildings.find(x => x.buildingId === 'transmuter_1' && x.view === 'top');
const building = await readJson(new URL(item.package, root.url));
const ports = await readJson(new URL(building.value.portMetadata, building.url));
const occlusion = await readJson(new URL(building.value.occlusionMetadata, building.url));
const effects = await readJson(new URL(building.value.effectResources, building.url));
```

## 端口模式与共享特效选择

当前交付包含 54 个建筑视图；每个视图都有 `ports.json`，即使没有可绘制端口也会保留空数组。先用 `deliveryVariantKeys` 选择该视图允许的模式，再在 `variants` 中按 `rendererTemplateKey` 取模式对象。不要只读取顶层 `deliveryMode`：例如 `transmuter_1/top` 同时允许 `gastrans__0` 和 `liquidtrans__0`，对应的 `deliveryVariantKeys` 是两个键；`transmuter_2/top` 和 `top-solidtrans` 则分别选择各自的单一键。

模式确定后，只遍历所选 variant 的 `activePorts.pipe.input` 和 `activePorts.pipe.output`，并筛选 `isPipe === true`。端口必须同时满足 `resolvedTransform.position` 为有效数组、`resolvedTransform.enabledByBinding === true`、`resolvedTransform.disabled !== true` 才能放置特效。使用 `resolvedTransform` 的 `position` 和 `yawDegrees`；`sourceOffset` 与 `sourceGridTransform` 只用于审计和调试。`status: "no-pipe-effectCfg"` 表示端口几何有效但当前没有可用 FX 绑定，此时保留端口业务状态并跳过 ON/OFF 图片。

端口的普通连接效果和独立激活效果分别读取 `resourceBinding`：`off` / `on` 是断开与接通状态，`activateOff` / `activateOn` 是激活状态覆盖层。四个字段可以独立为空；不要用 `activateOn` 代替 `on`，也不要因为普通 `on` 为空就猜测资源。当前 73 条有效管道端口中，55 条有普通 ON/OFF 资源，另有少数端口带 activate 资源；按照字段实际存在性绘制。

`resourceId` 是共享资源的稳定 ID，不是文件路径。先读取建筑 package 的 `effectResources` 指向的 registry，再用 ID 找到 registry 条目，最后解析条目的 `path`：

```js
const registry = effects;
const resourceById = new Map(
  registry.value.resources.map(resource => [resource.id ?? resource.resourceId, resource])
);

function effectFor(binding) {
  if (!binding) return null;
  const id = binding.resourceId;
  const resource = resourceById.get(id);
  if (!resource) throw new Error(`Unknown effect resource ID: ${id}`);
  return { id, meta: resource,
           effect: new URL(resource.path, registry.url) };
}

const onEffect = effectFor(port.resourceBinding?.on);
const offEffect = effectFor(port.resourceBinding?.off);
```

不要把 `v1.5/fx/...` 直接交给 `fetch`；它必须经过 registry 的 `path`。视图顶层 `resourceIds` 是该视图闭包的预加载清单，可用来预取资源，但端口实际显示仍以对应 binding 为准。

环使用 `rings`，而不是按端口数量推导。先按当前业务状态选择 `statusKey`，再对完全相同的 `statusKey + resourceId + resolvedTransform.position + resolvedTransform.yawDegrees` 去重；不要把不同 status 的条件行合并成一个 union，也不要把每个管道口自动补一个环。每个保留的环都应检查 `resourceId`、`resolvedTransform.position` 和 `resolvedTransform.yawDegrees`，并用同一个 registry `path` 解析资源。当前环资源只有 4 个 interactive_mixpool ID；其他设备发光、液体和诊断 FX 仍在审计字段中，不属于运行时 `rings`。

图集使用本项目的 `pages[]` / `frames[]` 格式。先加载页纹理，再按每帧的 `page`、`x`、`y`、`width`、`height` 建立纹理区域。它不是可以原封不动传给所有版本 `PIXI.Spritesheet` 的通用配置。

按游戏版本与资源 ID 一起缓存共享纹理和解析结果。建筑放置十次、某建筑有六个端口，都不需要重新加载六份或十份特效图片。资源本身也不包含所有端口接通组合。

## 坐标与放置

- 一个工厂格对应 128 个源像素。Canvas / Pixi 图像坐标为左上原点，x 向右、y 向下；它们对应游戏源坐标的 `+X`、`+Z`。源 `Y` 表示竖直高度。
- `spatial.json` 的逻辑占地与图片画布是两回事。设备突出部分可以在占地范围外；按 `footprintRectCells` 和 `pivotPixels` 放置整张图，不要按可见 Alpha 边界重新居中。
- 端口、环的位置相对于设备源原点。保留小数位置和高度。不能用整数网格替代配置，不能把环强制移到占地边缘。
- 共享特效有自己的裁切矩形和 pivot。把该 pivot 放到端口/环的锚点处，不要把紧裁图片的中心当作端口位置。
- 是否已经烘焙 prefab 的旋转和缩放以 `effect.json` 为准。离线烘焙和运行时只能各承担约定的那一层变换，避免双重旋转/缩放。

游戏源坐标绕 Y 旋转角度 θ 时，平面向量的变换是：

```text
worldX = originX + cos(θ) * localX + sin(θ) * localZ
worldZ = originZ - sin(θ) * localX + cos(θ) * localZ
worldY = baseY + localY
```

当图像 y 对应 `+Z` 时，源 yaw 与二维画布的旋转角符号相反。建筑图、端口锚点、环锚点及高度采样坐标必须采用同一套变换。若项目用另一种“顺时针第几次旋转”枚举，先转成上述矩阵。

## 模式、连接状态与动画

先选择设备模式，再取该模式实际启用的管道端口。相同建筑图片可能由多个模式共享，但有效端口、气液类型或环的显示状态仍会改变。未绑定的端口不应显示 ON/OFF。

实际放置读取 `resolvedTransform`，不要直接把原始表坐标当作建筑局部坐标。仅当该字段包含有效位置且端口未禁用时创建特效。当前版本的 `xiranite_oven_1`（息壤）`gasliquid` / `liquid` 模式引用输出索引 5，但源表只提供索引 0–4；此条目已标明源数据缺失，应跳过其 ON/OFF 并保留业务端口状态，不能回退到 `[0,0,0]`。其余已解析端口照常使用。

ON/OFF 由各端口连接状态独立选择，不能跟随建筑动画的帧号。环按独立配置的状态绑定显示；不能假设每个管道口都有环，也不能假设断开管道就要隐藏环。未知的原始状态枚举保留为原值，业务层应明确映射。

每个动画按其帧 `durationMs` 累积播放。不要用压缩后的帧数除以统一 FPS 推算时长。闭合校验帧若标记为不可播放，不要重复播放。标记为循环的资源可以按总播放时长取模；单次片段按其说明停止或保持最后一帧。开关动画时静态姿态取资源明确声明的帧/状态。

同一种共享特效可以共用一个播放时钟：每次只计算一次当前帧，再让所有实例引用该帧。只有业务确实需要错开相位时才额外记录实例时间偏移，无须给每个端口创建一个独立计时器。切换连接状态只改变该实例选用的 ON/OFF 资源。

ON/OFF 的纹理时间动画独立于建筑动画。本次保留已经确认的颜色和渐变。环的独立 `sanjiao` 小三角按用户确认省略，环带贴图上的原有图形仍保留。此前未恢复贴图的 ON 长箭头层继续隐藏。

环在资源中标记为单帧时，表示目前没有恢复其稳定运行时运动；并不表示已经证明游戏里静止。不要把原始生命周期 `duration = 3` 擅自当作三秒旋转或周期性淡出。特效自己的动画说明和循环校验结果具有优先性。

## 高度图数值格式

高度 WebP 是线性数值数据，必须与颜色纹理分开配置：无损 RGB/Alpha、最近邻采样、不生成 mipmap、不做 sRGB 解码、曝光、色调映射或缩放重编码。

RGBA 含义为：R 是无符号 16 位整数高字节，G 是低字节，B 为 0；A=255 表示有有效表面，A=0 表示空。空像素不是高度为零的实体。

```text
q = 256 * R + G                       // R、G 是 0..255 整数字节
height = heightMin + q / 65535 * (heightMax - heightMin)
```

`heightMin`、`heightMax` 从对应高度字段的编码配置读取；不同建筑和特效的范围可能不同。采样到 0..1 浮点通道时先乘 255 并取最近整数。不要直接比较两张图的 R/G，也不要对编码后的 R/G 做双线性插值。

构建场景高度缓存时，将建筑局部高度加上放置的 `baseY`，在同一世界坐标单位下取所有有效建筑表面的最大值。没有管道端口的建筑同样参加此步骤。

## 遮挡合成

推荐绘制顺序为建筑 → ON/OFF → 环。两个特效阶段都要使用各自的高度模板与场景高度缓存比较：

```text
scene = 场景缓存对应位置的有效世界高度
effect = 当前特效模板的局部高度 + 当前实例的竖直放置高度
当 scene 有效且 effect + epsilon < scene 时，丢弃该特效像素
否则保留当前颜色帧的 RGBA
```

`epsilon` 采用资源声明的策略，至少考虑高度量化误差，并保持世界单位一致。环与 ON/OFF 的高度和几何不同，不能共享同一张模板。环最后绘制也不代表它永远盖住设备：设备内部与外侧都必须执行比较。

场景缓存包含特效所属设备和所有相邻建筑，因此不用在每帧、每个端口上遍历邻居或做 mesh 切割。按地图区域缓存；放置、移除、旋转、地基高度或遮挡姿态改变时，更新受影响的区域。正常播放建筑动画、切换 ON/OFF 和镜头平移缩放不会改变已缓存的世界高度数据。

将该比较接入共用、可批量绘制的特效渲染路径。普通 `Sprite` 自带的 Alpha 合成不会自动完成高度比较。不要为每个端口创建一套独立 Filter、离屏缓冲或专属 shader 实例。颜色图集和数据图应使用各自正确的采样设置。

本资源包提供离线素材和组合规则，不替代项目自己的 Pixi 渲染器接入。最终批次数仍受纹理页数量、混合方式和排序影响，不能仅凭 Sprite 数量估算绘制性能。

## 近似范围与接入检查

建筑使用稳定姿态的静态近似高度图，因此运动边缘的遮挡不会逐帧精确跟随。叠加的透明特效层被压成颜色图并取代表性表面高度，透明多层交叉也有近似误差。该数据只适用于固定俯视角。

水泵 `pump_1` 沿用现有 3×3 颜色画布：左右连接件原本就有裁剪，新增高度只覆盖同一画布，没有补画外部件。该限制在其 `cropCompatibility` 中记录；它不代表已经重新生成了水泵的全部颜色动画。

接入时至少检查：

1. 液气转化机内部的环在凹处可见，在高于它的设备表面下被遮挡。
2. 反应池同向、反向紧邻时，突出部分同时受到自身与相邻设备的遮挡。
3. 无管道口的建筑移到特效位置时也能挡住它；移走后恢复。
4. 旋转后建筑、端口、环和高度图不发生方向翻转、错位或重复变换。
5. 切换设备模式只保留该模式有效端口；多个端口可以独立切换 ON/OFF。
6. 停用建筑动画时，ON/OFF 仍按自身时间播放；正常播放期间不重复重建场景高度缓存。

把图片作为不经改写的静态文件部署即可。构建工具可以做文件搬运或带映射的重命名，但必须保持全部 JSON 引用正确，尤其不能把高度 WebP 当普通图片再次有损压缩。
