// AI-REMOVED 2026-09-13:
// Reason: 移除按中文 PNG 映射和旧源目录进行静态批量导入的分支。
// Trigger: 用户要求将网站导入固化为技能并清理旧导入脚本；本轮禁止实际导入。
// Evidence: publishDeviceSprite / publishDeviceSpriteAnimations 仍有真实调用；只退役旧来源入口。
// Replacement: .agents/skills/import-building-assets/SKILL.md
// Risk: 旧命令不再可用；既有资源及通用发布函数保留。
// Human Review: Required
// Source: src/scripts/sync-device-sprites.mjs (removed section 1)
// Source SHA-256: c8ef7b81db16660f3e4c0bd2fdb974bdaa3b771ab058ff41c6af28195f4b9bd4
//
// Original code:
// import { publishLogisticsMaterials } from './publish-logistics-materials.mjs';

// AI-REMOVED 2026-09-13:
// Reason: 移除按中文 PNG 映射和旧源目录进行静态批量导入的分支。
// Trigger: 用户要求将网站导入固化为技能并清理旧导入脚本；本轮禁止实际导入。
// Evidence: publishDeviceSprite / publishDeviceSpriteAnimations 仍有真实调用；只退役旧来源入口。
// Replacement: .agents/skills/import-building-assets/SKILL.md
// Risk: 旧命令不再可用；既有资源及通用发布函数保留。
// Human Review: Required
// Source: src/scripts/sync-device-sprites.mjs (removed section 2)
// Source SHA-256: 6162be402fe86fa248de19ea07340f4b2c60b2c3df424147ce37620bc658d6bf
//
// Original code:
// const defaultSourceDirectory = path.join(projectRoot, 'resources', 'device-sprite-original');

// AI-REMOVED 2026-09-13:
// Reason: 移除按中文 PNG 映射和旧源目录进行静态批量导入的分支。
// Trigger: 用户要求将网站导入固化为技能并清理旧导入脚本；本轮禁止实际导入。
// Evidence: publishDeviceSprite / publishDeviceSpriteAnimations 仍有真实调用；只退役旧来源入口。
// Replacement: .agents/skills/import-building-assets/SKILL.md
// Risk: 旧命令不再可用；既有资源及通用发布函数保留。
// Human Review: Required
// Source: src/scripts/sync-device-sprites.mjs (removed section 3)
// Source SHA-256: 14fe099b5e25a9a1a95f9bb897f7be822461a67b425f14eb637cc345ba5a8e61
//
// Original code:
// // 资源目录使用中文设备名，运行时资源使用 registry spriteId。
// // 三元组：[中文名, spriteId, rotation?]
// // AI-CORRECTION 2026-08-20: 第一项可为不带扩展名的中文名，也可为含扩展名的源文件名。
// // rotation 为顺时针旋转角度（度），默认 0。
// // 图片输入端口在 N 方向，设备定义 0° 输入端口在 S 方向时需要 rotation: 180。
// const DEVICE_SPRITE_MAPPINGS = [
//   ['塑形机', 'item_port_shaper_1', 180],
//   ['种植机', 'item_port_planter_1', 180],
//   ['粉碎机', 'item_port_grinder_1', 180],
//   ['精炼炉', 'item_port_furnance_1', 180],
//   ['配件机', 'item_port_cmpt_mc_1', 180],
//   ['采种机', 'item_port_seedcol_1', 180],
//   ['存取线基段', 'item_port_log_hongs_bus'],
//   ['存取线源桩', 'item_port_log_hongs_bus_source'],
//   ['反应池', 'item_port_mix_pool_1', 180],
//   ['天有洪炉', 'item_port_xiranite_oven_1', 180],
//   ['拆解机', 'item_port_dismantler_1', 180],
//   ['装备原件机', 'item_port_winder_1', 180],
//   ['封装机', 'item_port_tools_asm_mc_1', 180],
//   ['灌装机', 'item_port_filling_pd_mc_1', 180],
//   ['研磨机', 'item_port_thickener_1', 180],
//   ['仓库存货口-紧凑-3x2', 'item_port_loader_1', 180],
//   ['仓库取货口-紧凑-3x2', 'item_port_unloader_1'],
//   ['暗管入口-旧注册表0度.webp', 'item_port_udpipe_loader_1', 180],
//   ['暗管出口-旧注册表0度.webp', 'item_port_udpipe_unloader_1', 180],
//   ['抽水泵-旧注册表0度.webp', 'item_port_water_pump_1', 180],
//   ['多口暗管入口-旧注册表0度.webp', 'item_port_udpipe_loader_2', 180],
//   ['废水处理机-旧注册表0度.webp', 'item_liquid_cleaner_1', 180],
//   ['储液罐-旧注册表0度.webp', 'item_port_liquid_storager_1', 180],
//   ['储气罐', 'gas_storager_1', 180],
//   ['固气转化机-固到气', 'transmuter_2_gastrans', 180],
//   ['固气转化机-气到固', 'transmuter_2_solidtrans', 180],
//   ['提纯机气体', 'liquid_purifier_1_gas', 180],
//   // AI-REMOVED 2026-08-20:
//   // Reason: resources 中的 426px 提纯机原图并非当前发布精灵的 813px 像素源，直接切换会引入无关视觉替换。
//   // Trigger: 本次只订正默认朝向，不应同时改变现有精灵内容与分辨率。
//   // Evidence: 同步输出尺寸从 813x819 降为 426x422。
//   // Replacement: 下方提纯机-旧注册表0度.webp 的稳定像素源。
//   // Risk: Low
//   // Human Review: Required
//   //
//   // Original code:
//   // ['提纯机', 'item_port_liquid_purifier_1', 270],
//   ['提纯机-旧注册表0度.webp', 'item_port_liquid_purifier_1', 270],
//   ['液气转化机', 'transmuter_1_gastrans', 180],
//   ['液气转化机', 'transmuter_1_liquidtrans', 180],
//   ['气体扩散机', 'vaporizer_1', 180],
//   ['气体反应炉', 'item_port_gas_reactor_1', 180],
//   ['气体收集泵', 'gas_pump_1', 180],
//   ['无限箱-1', 'cheat_infinite_solid'],
//   ['无限水-1', 'cheat_infinite_liquid'],
//   ['无限气-1', 'cheat_infinite_gas'],
// ];
// 

// AI-REMOVED 2026-09-13:
// Reason: 移除按中文 PNG 映射和旧源目录进行静态批量导入的分支。
// Trigger: 用户要求将网站导入固化为技能并清理旧导入脚本；本轮禁止实际导入。
// Evidence: publishDeviceSprite / publishDeviceSpriteAnimations 仍有真实调用；只退役旧来源入口。
// Replacement: .agents/skills/import-building-assets/SKILL.md
// Risk: 旧命令不再可用；既有资源及通用发布函数保留。
// Human Review: Required
// Source: src/scripts/sync-device-sprites.mjs (removed section 4)
// Source SHA-256: 98b4683c51987542b5d1bf016bfeef8a433694a9523a45f4975fe1ad62373f0f
//
// Original code:
//   const sourceDirectory = path.resolve(process.argv[2] ?? defaultSourceDirectory);
//   const spriteDirectory = path.resolve(process.argv[3] ?? defaultSpriteDirectory);
//   const maskDirectory = path.resolve(process.argv[4] ?? defaultMaskDirectory);
//   const definitions = await readRegistryAnimationDefinitions();
//   const animatedSpriteIds = new Set(definitions.filter((entity) => entity.spriteAnimation !== undefined)
//     .map((entity) => entity.spriteId));
// 
//   const importedCollection = JSON.parse(await readFile(
//     path.join(projectRoot, 'resources/building-top-view-v15.json'), 'utf8',
//   ));
//   const importedStaticMappings = importedCollection.entries.filter((entry) => !entry.animated)
//     .map((entry) => [`v15/${entry.spriteId}.webp`, entry.spriteId, 0,
//       entry.sourceMetadata?.publishedTransform?.operation === 'flip-top-bottom per frame' ? 'flip-top-bottom' : null,
//       { left: 0, top: 0, width: entry.spriteOffset.width * 128, height: entry.spriteOffset.height * 128 }]);
//   const importedStaticIds = new Set(importedStaticMappings.map((entry) => entry[1]));
//   const mappings = [...importedStaticMappings,
//     ...DEVICE_SPRITE_MAPPINGS.filter((entry) => !importedStaticIds.has(entry[1]))];
//   // AI-REMOVED 2026-09-10:
//   // Reason: 新版静态素材必须参与同一同步入口，避免后续同步恢复旧图。
//   // Trigger: v1.5 建筑素材接入。Evidence: collection 中记录了独立静态源。
//   // Replacement: mappings 合并新版和未替换的旧映射。
//   // Risk: Low; Human Review: Required
//   // Original code:
//   // for (const [sourceName, spriteId, rotation = 0] of DEVICE_SPRITE_MAPPINGS) {
//   for (const [sourceName, spriteId, rotation = 0, frameTransform = null, crop = null] of mappings) {
//     if (animatedSpriteIds.has(spriteId)) continue;
//     const sourceFileName = path.extname(sourceName) === '' ? `${sourceName}.png` : sourceName;
//     const sourceFilePath = path.join(sourceDirectory, sourceFileName);
//     const spriteOutputFilePath = path.join(spriteDirectory, `${spriteId}.webp`);
//     const maskOutputFilePath = path.join(maskDirectory, `${spriteId}.webp`);
//     const maskOverrideFilePath = path.join(defaultMaskOverrideDirectory, `${spriteId}.webp`);
//     const { width, height } = await publishDeviceSprite(
//       sourceFilePath,
//       spriteOutputFilePath,
//       maskOutputFilePath,
//       maskOverrideFilePath,
//       rotation,
//       { frameTransform, crop },
//     );
// 
//     console.log(`${spriteId}: ${width}x${height}${rotation ? ` (rotated ${rotation}°)` : ''}`);
//   }
//   await publishDeviceSpriteAnimations({ definitions, spriteDirectory, maskDirectory });
//   await publishLogisticsMaterials({ spriteDirectory, maskDirectory, outputDirectory: path.resolve(spriteDirectory, '../logistics') });
