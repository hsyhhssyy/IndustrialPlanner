# v1.5 建筑俯视图

2026-09-10 从 `endfield-building-animation-assets-v1.5-all.zip` 接入首批素材；2026-09-11 顺序叠加 fix1、fix2、fix3 后，共接入 36 个独立子包，映射为 40 个现有设备定义（28 个动画、12 个静态）。设备和最终来源对应关系、原始空间元数据见 `building-top-view-v15.json`。

## 发布方式

- 静态源位于 `device-sprite-original/v15/`，由 `node src/scripts/sync-device-sprites.mjs` 的同一静态同步入口发布。新版源优先于旧中文命名源。
- 动画源位于 `device-sprite-animation/<spriteId>/`，沿用 `node src/scripts/sync-device-sprites.mjs --animations` 发布。
- 动画源 manifest 的 `sources.*.frameDurationsMs` 保存逐帧时长；逻辑片段 range 的同名字段可覆盖被循环边界拆分的停留时间。输出 manifest 保留实际时长，不通过重复图像补时长。
- 旧固定 FPS manifest 仍通过同一标准化入口构建累计帧结束时刻，既有两种建筑的源文件和公开产物未重新生成。
- 静态首帧和 Alpha 遮罩独立发布；动画遮罩由所有逻辑帧 Alpha 并集生成。旧遮罩在 `device-sprite-mask-overrides/archive-v15/` 留档，不再覆盖新图。

## 片段与变体选择

- `dismantler_1` 仅循环已在原包通过接缝检查的源帧 `[35,215]`，前后部分分配到开启、关闭阶段。fix2 重导出后继续按 `sourceSpan` 拆分跨范围的去重帧停留时间，总时长不变。
- 无开启、关闭片段的循环动画沿用既有四阶段约定，以关闭静态首帧表达缺省过渡；没有周期运动的转化机把源姿态过渡放入 open/close，idle 保持终态。
- `grinder_1` 使用 fix2 恢复的四段当前模型动画，不再按旧包的重复帧发布为静态图。
- `storager_1` 按 fix2 撤回 3×4 重复包，使用与占地一致的 3×3 包。
- `xiranite_oven_1` 使用默认 `top` 包；当前 Registry 没有独立的 `top-gasliquid` 实体或按配方切图契约，不新增这一行为。
- 包内 aliases 映射到现有 Registry 变体，不新建实体，不改变端口或仿真规则。动画工作目标继续使用现有 `channelRecipes.isProgressing`；没有推进通道的设备保持关闭待机姿态。

## fix1-fix3 修复结果

- fix2 重导出的 `dismantler_1`、`furnance_1`、`grinder_1`、`liquid_purifier_1/top-gas`、`transmuter_2` 和 `xiranite_oven_1` 已按源 `+Z` 向下生成；其南侧白色输入与北侧黄色输出和 Registry 一致。共享别名计入后，修复 11 个既有冲突设备定义中的 8 个。
- fix2/fix3 解除 `filling_pd_mc_1`、`liquid_cleaner_1`、`mix_pool_2`、`thickener_1`、`tools_asm_mc_1`、`winder_1` 的图集尺寸阻塞，并补齐 `liquid_purifier_1/top`，这 7 个设备已接入。
- fix2 改变了 `log_hongs_bus_source` 与两个 `transmuter_2` 包的裁剪原点；三者按新元数据改为零偏移。`loader_1` 的零偏移及 `unloader_1` 的上移一格与各自包内占地区域一致，无需修改。
- 所有接入动画沿用逐帧时长；发布器重新分页到严格小于 4096px 的页面，并重新生成静态首帧、静态遮罩和动画 Alpha 并集遮罩。

## 仍待处理

- `planter_1`/`hydro_planter_1` 共用的 14 张 WebP、`seedcol_1` 的 15 张 WebP 在 fix2 中与原接入文件逐一相同，只清理了 JSON；三者的南侧输入、北侧输出方向冲突仍未修复。
- `tools_asm_mc_1` 的 `open_idle` 原始首尾帧未通过美工的循环接缝阈值；当前保留原帧和时序，不做合成修补。
- `mix_pool_2` 的运行时液位和液面着色尚未复现，当前是机械动画正确、透明材质近似的预览。
- 提纯机气体模式的运行时进度指示器没有独立动画和底色贴图，本次未伪造成不透明零件。
- 美工未在 fix2 实际 WebP 中复现反馈中的“整机白模”，该现象仍需用具体页面、设备和截图定位。

## 继续排除

- 用户此前明确要求跳过：`component_mc_1`、`mix_pool_1`；修复包未自动推翻该范围决定。
- 网格未核验：`water_purifier_node_1`。
- 坐标方向待核验：`log_conditioner`、`log_connector`、`log_converger`、`log_splitter` 以及对应四个 `pipe_` 包。

图集按页面加载并释放；全部建筑同时处于不同动画页时仍可能占用较多显存，4096 分页上限不等于全局内存预算。

## 本轮代码与资源验证

ESLint、TypeScript、Vitest normal（2443 通过、2 跳过）及 Build 全部通过。素材一致性测试同时校验 Registry、集合清单与包内占地元数据，避免 Registry 和清单以相同错误值通过检查。未执行正式 E2E 和 Blueprint。

三档浏览器验证使用 764×345、711×665、2552×1315 三组规定 Screen Profile，检查本轮 16 个重发动画的静态首帧，并逐段解码首末分页，共抽检 85 个动画页；最大边长 3840px，未出现白模或解码失败。偏移专项另行叠加画布网格和逻辑占地，检查 `log_hongs_bus_source`、两个 `transmuter_2` 变体、`loader_1`、`unloader_1`。每档测试后均关闭浏览器和专用 5188 端口。截图保留在 `.temp/playwright-test/building-v15-fix/` 和 `.temp/playwright-test/building-v15-offset-fix/`。这部分验证不代表仍待处理的原图方向和运行时材质已经验收通过。

| 测试文件 | 本轮验证行为与修改原因 |
| --- | --- |
| `src/tests/registry/building-top-view-v15.test.ts` | 将集合覆盖扩展到 40 项，验证 28 个动画、静态首帧、独立遮罩、全部动画分页、新增/排除项，并锁定 8 个已修复设备的南入北出元数据。 |
