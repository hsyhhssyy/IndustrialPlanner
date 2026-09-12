# 建筑高度与管道端口特效

本次交付适配 `buildings_frontend_v1.5.zip` 的高度遮挡与端口特效。主模块为 Renderer，资源发布和审计为配套改动。

## 当前交付状态

已实现高度缓存、特效批量绘制、资源加载释放、精确端口连接判断，以及场景编排接入。普通资源已完成发布：当前 Registry 有 51 条映射（31 条动画、20 条静态），31 条动画共 532 个分页；原始 463 个文件与 ZIP 逐字节一致。`filling_pd_mc_1_liquid` 的 public 动画与 Registry `spriteAnimation` 声明均已接入。

- 54 个建筑视图、13 个共享特效已发布。原件的精度、字符串和大整数保持原始字节，源归档 SHA-256 和文件摘要见 `building-port-effects/source.json`。
- 不重复导入建筑颜色动画：已有颜色资源继续由 `building-top-view-v15.json` 管理。原件选集保留端口、空间、高度和共享特效，因此入口里的建筑颜色文件不包含在这个选集中。
- 11 条 `deliveryVariantKeys` 引用不能解析到实际 variant，发布清单的 `issues` 保留问题，未猜测修正模式键。
- 保留 2 个 `pipe_admission` 锚点冲突；它们属于 Registry 审计问题，未通过视觉或猜测修改端口。
- 普通建筑视图在离线发布时将 source `+Z` 无损逐行转换到项目 `-y`，同步转换 `pivot`、`center`、`origin`、端口/环位置及共享特效帧区域；contract2 物流视图依据 `canonicalSourceZReflection` 保留自身 canonical 画布语义，并在清单记录 `coordinateSpace`。
- `building-port-effects/registry-audit.json` 按项目坐标列出端口锚点和当前 Registry 端口边界位置。Registry 没有端口竖直高度，因此该报告不替客户指定 Y 高度。ZIP 中仍有 `sp_sub_hub_1/top-level4` 与 `xiranite_oven_1/top-gasliquid` 两个视图没有当前实体或确定模式映射。
- 原始 `statusKey` 到业务运行状态的映射，以及 `activateOn` / `activateOff` 的触发条件仍待客户说明。组件支持显式传入已确认的状态，宿主暂不猜测启用环或激活覆盖层。

## 发布与核验

```bash
node src/scripts/publish-building-port-effects.mjs
npx tsx --tsconfig tsconfig.app.json src/scripts/audit-building-port-effects.ts
```

源目录为 `resources/building-port-effects`，发布目录为 `public/3d-top-view/port-effects`。普通建筑采用 `source X → project x`、`source Z → project -y`，高度和特效颜色页无损垂直转换并同步 pivot/center/origin/frame rect；contract2 物流视图保留自身 canonical 画布语义。高度图用 Sharp 解码为原始 RGBA，再 gzip 压缩，以 `.rgba.bin` 发布；没有缩放、插值或有损压缩。运行时用 `DecompressionStream` 解压后直接上传数值纹理，最近邻采样，无 mipmap。

发布器严格读取 `resolvedTransform` 和 `resourceBinding`，不按目视方向、旧图片或自动反转猜测端口。端口变体以交付的 `deliveryVariantKeys` 为基础，并组合映射到同一视图、且源数据实际存在的 Registry `alter-variant`；由此接入 `filling_pd_mc_1_liquid/liquid__0` 与 `shaper_1_gas/gas__0`。11 条无法解析的 `deliveryVariantKeys` 和 2 条 Registry 审计 issue 原样保留。

## 渲染与失效范围

Search-First 决策为 Extend / Compose：沿用 Registry 端口几何、现有物流材质状态、Pixi Mesh 及既有管道绘制阶段。新增的高度缓存和批量特效属于同一 Renderer 子目录，没有修改 Domain、Registry 或仿真接口。

建筑高度按 4×4 格区域索引，128 像素/格。只为可见特效覆盖的区域加载建筑高度并构建缓存；全部可识别建筑参与区域遮挡，包括没有管道端口的设备。支架高度按现有线路的 support/shape 状态选择，透明管壁与流体不参与不透明高度。

区域内取有效表面的最大世界高度。放置、移除、旋转或所选遮挡字段变化时使对应区域失效；动画帧、ON/OFF、镜头变换本身不重建已缓存高度。离开可见特效范围的区域会释放，返回后重建。当前文档没有地基高度字段，实例的建筑基高为 0，端口保留原始小数 Y。

同一阶段、资源页和区域内的实例合批，以顶点属性传递实例高度，使用共享编译 Shader。先绘制 ON/OFF，再绘制环，两阶段都做逐像素高度比较，epsilon 同时覆盖建筑和特效的量化误差。不会为每个端口创建独立 Filter 或离屏缓冲。

普通 ON/OFF 时钟独立于建筑动画开关；蓝图样式、隐藏管道或销毁场景时释放资源。加载未完成时不接管旧端口虚影，加载失败在控制台报告并保持原有端口显示。启用新版视觉必须先有唯一匹配的几何位置、朝向和输入输出语义，实际连接还要求相邻端口方向相反且物流种类兼容。

## 验证边界

`src/tests/renderer/building-height-effects.test.ts` 验证无损数据、负坐标与旋转、相邻遮挡与移除、冲突拒绝、独立连接状态、环的显式状态与去重、逐帧时长。新增这些测试源于高度渲染和端口状态接入，不调整既有超时或断言。

最终 normal 为 `2523 passed / 11 failed / 2 skipped`（285 个文件通过、1 个文件失败），11 项失败全部对应待接入的 Registry 显示字段；本次新增的动画与端口变体测试均通过。component 测试随新版 JSON 更新为 99 个去重帧、逐帧时间线与 5033ms 总时长；物流 JSON 测试验证完整材质语义，旧补丁归档和 WebP 字节校验仍保留。ESLint、TypeScript、Build 均通过。检查遵循 simple-check，日志见 `.temp/full-check/runs/20260911-173009-2355713/`，旧轮次记录保留。

本轮最终资源（2026-09-11）的三档开发验证均通过：764×345 / DPR 3.125（mobile）、711×665 / DPR 3.125（tablet）、2552×1315 / DPR 1（desktop），均支持触控。desktop 测试明确模拟同时具备鼠标和触屏的环境，将主指针和 hover 的媒体特征设为 fine / hover；未改变产品环境判断规则。测试拦截外部 Analytics 请求，避免其本地 CORS 错误混入渲染验证，未修改产品 Analytics。 每档加载 51 套图片和遮罩、31 套动画的 100 个抽查帧；四角旋转以及蓝图/动画开关检查通过，页面异常和素材失败请求为 0。结果及清理记录见 `.temp/playwright-test/building-v15-replacement/verification.json`。该轮液体灌装动画仅使用测试局部能力声明完成资源解码；后续已补入 Registry，并按其他生产设备相同的四阶段契约启用。

本轮审计（2026-09-11）对当前 Registry 全部定义使用默认朝向汇总为 `surfaces=51`、`effects=35`、`issues=2`。publish 已输出 54 个视图、13 个共享特效；新增的 2 个绑定效果来自 `filling_pd_mc_1_liquid/liquid__0` 与 `shaper_1_gas/gas__0`。

高度本身仍是静态姿态近似，不能精确跟随运动边缘或多层透明几何。原包没有覆盖的设备不生成猜测高度；需要新增对应交付才能参与准确遮挡。显存开销随可见特效覆盖区域和活跃资源页增长，分页及可见区域释放不等于固定全局显存上限。

2026-09-11 订正：8 个物流功能建筑的 3×3 显示字段方案已撤回，按用户要求暂停处理。颜色与高度素材的像素范围不能直接视为同一比例，原 12 项合并补丁不得应用。3 个仓储显示偏移仍未接入；`filling_pd_mc_1_liquid.spriteAnimation` 已在后续补齐。本次 definition ID 重命名不包含这些显示变更。
