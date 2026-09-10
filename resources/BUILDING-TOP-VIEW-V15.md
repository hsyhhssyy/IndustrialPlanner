# v1.5 建筑俯视图

2026-09-10 从 `endfield-building-animation-assets-v1.5-all.zip` 接入 29 个独立子包，映射为 33 个现有设备定义（20 个动画、13 个静态）。设备和来源对应关系、原始空间元数据见 `building-top-view-v15.json`。

## 发布方式

- 静态源位于 `device-sprite-original/v15/`，由 `node src/scripts/sync-device-sprites.mjs` 的同一静态同步入口发布。新版源优先于旧中文命名源。
- 动画源位于 `device-sprite-animation/<spriteId>/`，沿用 `node src/scripts/sync-device-sprites.mjs --animations` 发布。
- 动画源 manifest 的 `sources.*.frameDurationsMs` 保存逐帧时长；逻辑片段 range 的同名字段可覆盖被循环边界拆分的停留时间。输出 manifest 保留实际时长，不通过重复图像补时长。
- 旧固定 FPS manifest 仍通过同一标准化入口构建累计帧结束时刻，既有两种建筑的源文件和公开产物未重新生成。
- 静态首帧和 Alpha 遮罩独立发布；动画遮罩由所有逻辑帧 Alpha 并集生成。旧遮罩在 `device-sprite-mask-overrides/archive-v15/` 留档，不再覆盖新图。

## 片段与变体选择

- `dismantler_1` 仅循环元数据通过接缝检查的源帧 `[35,215]`，前后部分分配到开启、关闭阶段。跨范围的去重帧按源帧覆盖比例拆分停留时间，总时长不变。
- 无开启、关闭片段的循环动画沿用既有四阶段约定，以关闭静态首帧表达缺省过渡；没有周期运动的转化机把源姿态过渡放入 open/close，idle 保持终态。
- `grinder_1` 的全部源帧在俯视角相同，发布为静态图。
- `storager_1` 选择保留透明边距的 3×4 包，按占地偏移 `[0,1]` 定位；3×3 包是同一实体的重复交付，不同时覆盖。
- `xiranite_oven_1` 使用默认 `top` 包；当前 Registry 没有独立的 `top-gasliquid` 实体或按配方切图契约，不新增这一行为。
- 包内 aliases 映射到现有 Registry 变体，不新建实体，不改变端口或仿真规则。动画工作目标继续使用现有 `channelRecipes.isProgressing`；没有推进通道的设备保持关闭待机姿态。

## 待完成的方向验收

实图检查发现 `furnance_1` 的烘焙箭头朝下，而 Registry 为南侧输入、北侧输出；共享该包的 `liquid_furnance_1` 同样受影响。当前资源已生成，不能视为完成视觉验收。已向用户询问是离线校正素材还是暂缓冲突包，尚未擅自翻转建筑或修改端口。其他素材还需按相同标准核对，不能仅凭 `imageAxes` 声明认定方向正确。

桌面实图与当前 Registry 的固体端口方向对照后，以下 11 个设备定义存在相同的向下箭头冲突：`dismantler_1`、`furnance_1`、`liquid_furnance_1`、`grinder_1`、`liquid_purifier_1_gas`、`planter_1`、`hydro_planter_1`、`seedcol_1`、`transmuter_2_gastrans`、`transmuter_2_solidtrans`、`xiranite_oven_1`。其中南侧固体输入或北侧固体输出应指向上方。`shaper_1` 的箭头已经朝上，`sp_hub_1` 的北侧为输入端口，因此不能对全部子包统一翻转。

此外，`storager_1` 的 3×4 包可见主体主要位于画布上部，而元数据 footprint.top 为 1；其占地位置需进一步复核，不应仅因多一行透明边距就认定优于 3×3 包。

## 本次排除

- 已接入且用户明确要求跳过：`component_mc_1`、`mix_pool_1`。
- 超限：`filling_pd_mc_1`、`liquid_cleaner_1`、`mix_pool_2`、`thickener_1`、`tools_asm_mc_1`、`winder_1`。
- 缺页：`liquid_purifier_1/top`；其独立 `top-gas` 包通过检查并接入气体变体。
- 网格未核验：`water_purifier_node_1`。
- 坐标方向待核验：`log_conditioner`、`log_connector`、`log_converger`、`log_splitter` 以及对应四个 `pipe_` 包。

图集按页面加载并释放；全部建筑同时处于不同动画页时仍可能占用较多显存，4096 分页上限不等于全局内存预算。

## 本轮代码与资源验证

ESLint、TypeScript、Vitest normal（2410 通过、2 跳过）及 Build 全部通过。第一次 Vitest 执行的全量图片扫描和翻译扫描超时；停止浏览器任务后按完整基础检查流程重跑通过，未修改这两个测试的断言或时限。未执行正式 E2E 和 Blueprint。

三档浏览器验证使用实际 Pixi 纹理入口和动画状态机，检查 33 个静态显示、20 个动画的四阶段首/中/末帧与阶段边界；纹理销毁后统计归零，浏览器与专用 5188 端口已清理。截图保留在 `.temp/playwright-test/building-v15/`。这部分验证不代表原图方向已经验收通过。

| 测试文件 | 本轮验证行为与修改原因 |
| --- | --- |
| `src/tests/renderer/device-animation-state.test.ts` | 新增非等长帧的边界定位、长停留、跨页末帧和大时间步长；同步累计结束时刻夹具。 |
| `src/tests/renderer/device-animation-textures.test.ts` | 随运行时 manifest 扩展，新增逐帧时长长度、非法值及累计溢出校验。 |
| `src/tests/renderer/generic-device-sprite.test.ts` | 为既有动画夹具补齐新增的累计结束时刻字段，保持原测试行为。 |
| `src/tests/scripts/device-sprite-animation.test.ts` | 随发布协议扩展，验证源帧与片段覆盖时长能正确发布，长停留不复制图片。 |
| `src/tests/registry/building-top-view-v15.test.ts` | 新增注册表、33 项素材、独立遮罩、动画分页和排除项的一致性检查。 |
