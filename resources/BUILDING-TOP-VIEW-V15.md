# v1.5 建筑俯视图素材

权威来源是 `动画素材包/buildings_frontend_v1.5.zip`，SHA-256 记录在 `building-top-view-v15.json`。当前清单覆盖 51 条 Registry 映射：31 条动画、20 条静态，对应 46 个唯一普通视图；31 条动画共 532 个分页。原始普通资源共 463 个文件，已与 ZIP 逐字节核对。另有 6 个连续物流材质视图由 `logistics-materials/contract2/` 覆盖。ZIP 共 54 个视图，其中 2 个没有当前实体或确定的模式映射。

## 来源与发布

- 动画源位于 `device-sprite-animation/<spriteId>/`，静态源位于 `device-sprite-original/v15/`。source 文件保留 ZIP 原始字节；来源 hash 不以发布后的 WebP hash 代替。
- 统一入口为 `node src/scripts/import-building-top-view-v15.mjs`（完整动画发布须先接入下文的 Registry 能力声明）。可用 `--entity-id=<entityId>` 只重发一个已知映射；未知 ID 必须 fail-fast。
- 可用 `--prepare-only` 导入原始图集、元数据并发布静态图，暂缓动画重发。各条目的来源 hash 独立记录，单建筑更新不改其他条目；集合顶层 hash 记录最近一次完整导入。
- 导入入口自行校验并解压 ZIP 到专用临时目录，处理结束后清理临时目录。
- 动画发布复用既有分页、逐帧时长和 Alpha mask 流程，不新增播放器或分页协议。动画 source manifest 的 `frameDurationsMs` 来自 ZIP 的 `animation.json`，每个分页 source 保持独立 range。
- 新 JSON 决定页面布局和帧数；仅在源帧数、列数和逐帧时长一致时保留已确认的四阶段切分。其他情况重新采用交付的完整阶段；所有逻辑 range 都必须落在实际源帧范围内。
- 静态发布复用 `publishDeviceSprite`，按声明的 crop 与变换生成 public sprite 和 mask。`port-effects`、物流连续材质和 grid belt/log pipe/support 材质不属于本清单的发布范围。

## 变体 ID 与蓝图迁移（2026-09-11）

Search-First 决策为 Extend：复用 `src/shared/blueprint-device-id-migration.ts` 的逐版本迁移。远端最新发布 tag `v1.5.0` 和两处 live 站点对应的蓝图 schema 均为 5；区域标记、37 项端口旋转和以下三台设备重命名统一进入当前未发布的 5→6。1→5 历史规则保持原样，三台设备在重命名时同时执行已有的 180° 端口补偿，schema 6 重读不再旋转。旧蓝图、基地文档、快捷放置及模块图标沿用现有迁移入口。

| 旧 definition ID | 当前 definition ID | 保留的 spriteId |
| --- | --- | --- |
| `liquid_filling_pd_mc_1` | `filling_pd_mc_1_liquid` | `item_port_liquid_filling_pd_mc_1` |
| `hydro_planter_1` | `planter_1_liquid` | `item_port_hydro_planter_1` |
| `liquid_furnance_1` | `furnance_1_liquid` | `item_port_liquid_furnance_1` |

设备显示名称、配方 ID、资源文件名及交付 JSON 的原始字段不改。更新的是 Registry ID、配方 machineId、翻译 key、应用引用和资源清单的实体映射。7 组共 14 个变体均已核对：以基础 ID 注册的主设备保留基础 ID，其余使用 `<基础 ID>_<模式>`。内置历史蓝图保留原 schema 和原始数据，由读取入口迁移。

## 坐标契约

ZIP 的 `spatial.json` 是原始空间元数据，必须原样保留。其图像轴声明为 `x=+sourceX`、`y=+sourceZ`；当前 Registry 图像约定为 `X=x、Y=depth-1-z`。发布阶段按每个帧单元执行 `projectY = depth - 1 - sourceZ`，栅格实现是逐帧上下翻转，不能对整张多帧图集翻转。

该变换写在清单的 `publishedTransform` 与动画发布 manifest 的 `appliedSourceToPublishedTransform` 中，避免播放器重复翻转。`spriteOffset` 按源 footprint 与 canvas 计算：`x = -footprint.left`，`y = footprint.top + footprint.height - canvas.height`。

端口方向必须由 RAW `solidPorts` 经上述坐标变换后与 Registry 的物理端口坐标和 role 对比，不能凭图片外观或端口 ID 名称判断。

## 覆盖范围

已覆盖普通建筑和变体包括生产设备、液体/气体变体、仓储与暗管设备、共享动画别名，以及 8 个物流功能建筑：log/pipe 的 splitter、converger、connector、admission。两个 admission 分别来自 ZIP 的 `log_conditioner` 和 `pipe_conditioner`。它们使用普通建筑的 3×3 画布，与连续物流材质的 contract2 契约分开发布。

`component_mc_1`、`mix_pool_1` 和 `filling_pd_mc_1_liquid` 已纳入本轮范围。`filling_pd_mc_1_liquid` 的 public 动画与 Registry `spriteAnimation` 声明均已接入。

未映射视图为 `sp_sub_hub_1/top-level4` 和 `xiranite_oven_1/top-gasliquid`：当前没有对应的子枢纽实体，也没有 gasliquid 变体实体或按配方切换该视图的契约。grid belt、log pipe、pipesupport 的连续材质由现有物流发布流程负责。

## 已知限制

- 当前构建的 PWA 预缓存为 1916 条、约 283.6 MiB；动画目录约 230 MiB。首次建立离线缓存需要承担相应下载与存储成本，尚未运行仿真性能基线。
- ZIP 中液体运行时液位和液面材质不由本建筑 beauty sprite 重建，相关预览仍使用现有材质契约。
- `tools_asm_mc_1` 的原始动画接缝问题保留源帧和时序，不做合成修补。
- Registry 的 `spriteOffset`、`spriteAnimation` 授权变更由 Registry 模块统一协调；本文件只记录资源来源与发布契约。

2026-09-11 订正：8 个物流功能建筑的 3×3 显示字段方案已撤回，按用户要求暂停处理。颜色与高度素材的像素范围不能直接视为同一比例，原 12 项合并补丁不得应用。3 个仓储显示偏移仍未接入；`filling_pd_mc_1_liquid.spriteAnimation` 已在后续补齐。本次 definition ID 重命名不包含这些显示变更。

## 本轮验证（2026-09-11）

三档浏览器均完成本轮资源验证：764×345 / DPR 3.125（mobile）、711×665 / DPR 3.125（tablet）、2552×1315 / DPR 1（desktop），均支持触控。每档实际加载 51 套静态图和遮罩，并解码 31 套动画共 100 个 open_idle/close_idle 首尾抽查帧。页面异常和素材失败请求均为 0；四个建筑旋转角度都有高度特效绘制，蓝图样式切换释放/恢复特效，关闭建筑动画后仍绘制端口效果。每档浏览器、会话与专用 6014 服务均单独清理。

截图用于检查应用内加载、布局和取景，没有据此判断 ZIP 建筑朝向。证据位于 `.temp/playwright-test/building-v15-replacement/verification.json` 和各档的 `result.log`、`result.png`、`cleanup.log`。该轮液体灌装动画仅使用测试局部能力声明完成资源解码；后续已补入 Registry。浏览器当时记录的 11 个显示偏移仍不等于全部实体已可正确展示。

本轮随发布契约同步更新以下测试：

- `src/tests/registry/building-top-view-v15.test.ts`：新增入口、JSON 坐标转换、源归档摘要，以及 Registry/静态图/遮罩/分页尺寸一致性。
- `src/tests/scripts/device-sprite-animation.test.ts`：实际发布器的逐帧变换、非等长时序、静态与联合遮罩、裁切后变换顺序，以及单建筑选择和无效输入拒绝。
- `src/tests/renderer/building-height-effects.test.ts`：发布后高度字节与特效页坐标、旋转/遮挡/连接状态，以及锚点冲突拒绝。
- `src/tests/registry/device-animation-definition.test.ts`：新版 component JSON 的 30 FPS、99 个去重帧、5033ms 时间线及长停留帧；保留四阶段、分页和图片/遮罩验证。
- `src/tests/scripts/logistics-materials.test.ts`：新版 ZIP 与旧 UV 补丁保持完整 JSON 语义相等；旧补丁原件字节/hash 和全部原始 WebP hash 继续严格验证。

基础检查日志统一保存在 `.temp/full-check/runs/20260911-173009-2355713/`，旧轮次保留于 `first-pass/`、`second-pass/`。

最终 normal 结果为 `2523 passed / 11 failed / 2 skipped`（286 个文件：285 通过、1 失败）。唯一失败文件为建筑清单与 Registry 的显示字段一致性测试，11 项与仍待接入的显示偏移一一对应；没有将缺失显示字段标记为跳过。本次新增的动画与端口变体测试均通过，ESLint、TypeScript、Build 均通过。
