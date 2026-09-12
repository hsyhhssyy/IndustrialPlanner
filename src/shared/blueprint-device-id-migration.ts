import { ADMISSION_RATE_WINDOWS_PER_MINUTE } from "@/domain/registry";
import type {
  SlotLinkDefinition,
  WorldEntity,
} from "@/domain/document/world-document";
import type { RegionAnnotation } from "@/domain/document/region-annotation";
import type { GridRotation } from "@/domain/shared/grid";
import { rotateGridRotation } from "@/shared/geometry/grid";
import { rotateLocalPortCell } from "@/shared/geometry/port";
import { readForceFlattenBlueprintVersionEnabled } from "@/shared/logging/debug-mode-runtime";
import { normalizeRegionAnnotations } from "@/shared/region-annotations";

// AI-CORRECTION 2026-09-09: schema 6 将区域标记纳入基地与蓝图的统一迁移边界。
// AI-CORRECTION 2026-09-11: 远端发布 tag v1.5.0 仍为 schema 5；所有当前未发布变更统一进入 5→6。
export const BLUEPRINT_DEVICE_ID_SCHEMA_VERSION = 6;

const ADMISSION_RULE_CONFIG_PATH = "portGroups[0].ports[0].admissionRule";
const ADMISSION_RATE_MAX_BY_DEFINITION_ID: Readonly<Record<string, number>> = {
  log_admission: 30,
  pipe_admission: 120,
};

const RESOURCE_PUMP_OUTPUT_PORT = {
  localCellX: 0,
  localCellY: 1,
} as const;
const RESOURCE_PUMP_FOOTPRINT = {
  width: 3,
  height: 3,
} as const;
const DARK_PIPE_INLET_DEFINITION_IDS: ReadonlySet<string> = new Set([
  "udpipe_loader_1",
  "udpipe_loader_2",
]);
const DARK_PIPE_RECIPE_CHANNEL_CONFIG_PREFIX = "recipeChannels[";
const RESOURCE_PUMP_MIGRATION_BY_DEFINITION_ID = {
  gas_pump_1: {
    cheatDefinitionId: "cheat_infinite_gas",
    recipeIdByItemId: {
      item_gas_inert: "r_gas_collector_inert_basic",
      item_gas_xiranite: "r_gas_collector_xiranite_basic",
    },
  },
  water_pump_1: {
    cheatDefinitionId: "cheat_infinite_liquid",
    recipeIdByItemId: {
      item_liquid_acid: "r_pump_acid_basic",
      item_liquid_water: "r_pump_water_basic",
    },
  },
} as const satisfies Readonly<Record<string, {
  readonly cheatDefinitionId: string;
  readonly recipeIdByItemId: Readonly<Record<string, string>>;
}>>;

export interface BlueprintDeviceIdMigrationRule {
  readonly fromDeviceId: string;
  readonly toDeviceId: string;
  readonly rotationOffset: GridRotation;
}

type BlueprintDocumentMigration =
  | "normalize-admission-rate"
  | "migrate-resource-pump-sources"
  | "remove-dark-pipe-recipe-channel-config";

export interface BlueprintDeviceIdMigrationSpec {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly deviceRules: readonly BlueprintDeviceIdMigrationRule[];
  // AI-REMOVED 2026-08-19:
  // Reason: schema 5 迁移需要同时读取并修改 entities 与 slotLinks，实体配置专用迁移类型已无法表达完整文档迁移。
  // Trigger: 气体收集泵与抽水泵从仓库代理改为真实配方生产设备。
  // Evidence: 旧泵所选物品只存在于 document.slotLinks，单独迁移 entity.config 无法判断配方或作弊设备替换。
  // Replacement: documentMigration
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // readonly entityConfigMigration?: "normalize-admission-rate";
  // AI-CORRECTION 2026-08-19: 同一 schema 版本可能包含多个相互独立的完整文档迁移，当前替代入口为 documentMigrations。
  // AI-REMOVED 2026-08-19:
  // Reason: 单值迁移入口无法在 schema 4→5 同时执行资源泵转换与暗管入口旧配置清理。
  // Trigger: schema 5 新暗管入口定义已移除 recipeChannels，但历史蓝图仍携带该配置并会重建无效通道。
  // Evidence: getting-started-tutorial 与 utimate-xiranite 的暗管入口配置包含 recipeChannels[...].manualRecipeOnly。
  // Replacement: documentMigrations
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // readonly documentMigration?: "normalize-admission-rate" | "migrate-resource-pump-sources";
  readonly documentMigrations?: readonly BlueprintDocumentMigration[];
}

export interface BlueprintEntityDeviceIdMigrationResult<TEntity extends WorldEntity> {
  readonly schemaVersion: number;
  readonly entities: Record<string, TEntity>;
}

export interface BlueprintDocumentMigrationState<TEntity extends WorldEntity> {
  readonly entities: Record<string, TEntity>;
  readonly entityOrder: readonly string[];
  readonly slotLinks: readonly SlotLinkDefinition[];
  readonly regions?: unknown;
}

export interface BlueprintDocumentMigrationResult<TEntity extends WorldEntity> {
  readonly schemaVersion: number;
  readonly entities: Record<string, TEntity>;
  readonly entityOrder: readonly string[];
  readonly slotLinks: readonly SlotLinkDefinition[];
  readonly regions: readonly RegionAnnotation[];
}

export interface BlueprintDeviceReferenceMigrationResult {
  readonly schemaVersion: number;
  readonly deviceId: string;
  readonly rotation: GridRotation;
}

/**
 * 蓝图与基地共用的设备定义 ID 迁移规范。
 *
 * 每个版本只能迁移到紧邻的下一个版本。设备方向迁移使用：
 * `nextRotation = currentRotation + rotationOffset`。
 * AI-CORRECTION 2026-07-23: 迁移链现同时承载准入口速率配置归一化，名称中的 DeviceId 仅保留为既有公共 API。
 * AI-CORRECTION 2026-08-19: schema 5 起迁移链以完整文档状态为边界，同时迁移实体、实体顺序与槽位链接。
 */
export const BLUEPRINT_DEVICE_ID_MIGRATION_SPECS = [
  {
    fromVersion: 1,
    toVersion: 2,
    deviceRules: [
      {
        fromDeviceId: "item_port_mix_pool_large_1",
        toDeviceId: "item_port_mix_pool_2",
        rotationOffset: 0,
      },
    ],
  },
  {
    fromVersion: 2,
    toVersion: 3,
    deviceRules: [
      { fromDeviceId: "item_port_storager_1", toDeviceId: "storager_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_log_hongs_bus", toDeviceId: "log_hongs_bus", rotationOffset: 0 },
      { fromDeviceId: "item_port_log_hongs_bus_source", toDeviceId: "log_hongs_bus_source", rotationOffset: 0 },
      { fromDeviceId: "item_port_unloader_1", toDeviceId: "unloader_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_mix_pool_1", toDeviceId: "mix_pool_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_grinder_1", toDeviceId: "grinder_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_liquid_filling_pd_mc_1", toDeviceId: "liquid_filling_pd_mc_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_filling_pd_mc_1", toDeviceId: "filling_pd_mc_1", rotationOffset: 0 },
      { fromDeviceId: "item_log_splitter", toDeviceId: "log_splitter", rotationOffset: 0 },
      { fromDeviceId: "item_log_converger", toDeviceId: "log_converger", rotationOffset: 0 },
      { fromDeviceId: "item_log_connector", toDeviceId: "log_connector", rotationOffset: 0 },
      { fromDeviceId: "item_pipe_splitter", toDeviceId: "pipe_splitter", rotationOffset: 0 },
      { fromDeviceId: "item_pipe_converger", toDeviceId: "pipe_converger", rotationOffset: 0 },
      { fromDeviceId: "item_pipe_connector", toDeviceId: "pipe_connector", rotationOffset: 0 },
      { fromDeviceId: "item_port_udpipe_loader_1", toDeviceId: "udpipe_loader_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_udpipe_unloader_1", toDeviceId: "udpipe_unloader_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_loader_1", toDeviceId: "loader_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_furnance_1", toDeviceId: "furnance_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_liquid_furnance_1", toDeviceId: "liquid_furnance_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_cmpt_mc_1", toDeviceId: "cmpt_mc_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_shaper_1", toDeviceId: "shaper_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_seedcol_1", toDeviceId: "seedcol_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_planter_1", toDeviceId: "planter_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_hydro_planter_1", toDeviceId: "hydro_planter_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_winder_1", toDeviceId: "winder_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_tools_asm_mc_1", toDeviceId: "tools_asm_mc_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_thickener_1", toDeviceId: "thickener_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_power_sta_1", toDeviceId: "power_sta_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_mix_pool_2", toDeviceId: "mix_pool_2", rotationOffset: 0 },
      { fromDeviceId: "item_port_liquid_purifier_1", toDeviceId: "liquid_purifier_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_xiranite_oven_1", toDeviceId: "xiranite_oven_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_dismantler_1", toDeviceId: "dismantler_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_gas_reactor_1", toDeviceId: "gas_reactor_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_sp_hub_1", toDeviceId: "sp_hub_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_water_pump_1", toDeviceId: "water_pump_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_udpipe_loader_2", toDeviceId: "udpipe_loader_2", rotationOffset: 0 },
      { fromDeviceId: "item_port_udpipe_unloader_2", toDeviceId: "udpipe_unloader_2", rotationOffset: 0 },
      { fromDeviceId: "item_liquid_cleaner_1", toDeviceId: "liquid_cleaner_1", rotationOffset: 0 },
      { fromDeviceId: "item_water_purifier_node_1", toDeviceId: "water_purifier_node_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_liquid_storager_1", toDeviceId: "liquid_storager_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_power_diffuser_1", toDeviceId: "power_diffuser_1", rotationOffset: 0 },
      { fromDeviceId: "item_log_admission", toDeviceId: "log_admission", rotationOffset: 0 },
      { fromDeviceId: "item_pipe_admission", toDeviceId: "pipe_admission", rotationOffset: 0 },
      { fromDeviceId: "item_port_dumper_1", toDeviceId: "dumper_1", rotationOffset: 0 },
      { fromDeviceId: "item_port_miner_2", toDeviceId: "miner_2", rotationOffset: 0 },
      { fromDeviceId: "item_port_miner_3", toDeviceId: "miner_3", rotationOffset: 0 },
      { fromDeviceId: "item_port_miner_4", toDeviceId: "miner_4", rotationOffset: 0 },
    ],
  },
  {
    fromVersion: 3,
    toVersion: 4,
    deviceRules: [],
    // AI-REMOVED 2026-08-19:
    // Reason: 文档迁移入口已统一为可组合的迁移序列。
    // Trigger: schema 4→5 需要在同一版本执行资源泵与暗管入口两项迁移。
    // Evidence: BlueprintDeviceIdMigrationSpec.documentMigrations 取代单值 documentMigration。
    // Replacement: documentMigrations
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // documentMigration: "normalize-admission-rate",
    documentMigrations: ["normalize-admission-rate"],
  },
  {
    fromVersion: 4,
    toVersion: 5,
    deviceRules: [
      { fromDeviceId: "udpipe_loader_1", toDeviceId: "udpipe_loader_1", rotationOffset: 180 },
      { fromDeviceId: "udpipe_unloader_1", toDeviceId: "udpipe_unloader_1", rotationOffset: 180 },
      { fromDeviceId: "liquid_purifier_1", toDeviceId: "liquid_purifier_1", rotationOffset: 90 },
      { fromDeviceId: "gas_reactor_1", toDeviceId: "gas_reactor_1", rotationOffset: 180 },
      { fromDeviceId: "water_pump_1", toDeviceId: "water_pump_1", rotationOffset: 180 },
      { fromDeviceId: "udpipe_loader_2", toDeviceId: "udpipe_loader_2", rotationOffset: 180 },
      { fromDeviceId: "liquid_cleaner_1", toDeviceId: "liquid_cleaner_1", rotationOffset: 180 },
      { fromDeviceId: "liquid_storager_1", toDeviceId: "liquid_storager_1", rotationOffset: 180 },
      { fromDeviceId: "gas_storager_1", toDeviceId: "gas_storager_1", rotationOffset: 180 },
      { fromDeviceId: "vaporizer_1", toDeviceId: "vaporizer_1", rotationOffset: 180 },
      { fromDeviceId: "gas_pump_1", toDeviceId: "gas_pump_1", rotationOffset: 180 },
    ],
    // AI-REMOVED 2026-08-19:
    // Reason: schema 5 的资源泵迁移需要与暗管入口旧配置清理共同执行。
    // Trigger: 暗管入口 recipeChannels 已从 registry 移除，历史配置必须在迁移时同步移除。
    // Evidence: 历史系统蓝图的扁平配置会被 materializeConfigOverrides 重建为不完整 recipe channel。
    // Replacement: documentMigrations
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // documentMigration: "migrate-resource-pump-sources",
    documentMigrations: [
      "migrate-resource-pump-sources",
      "remove-dark-pipe-recipe-channel-config",
    ],
  },
  // AI-REMOVED 2026-09-11:
  // Reason: 撤回为未发布 schema 6 保留空迁移的假设。
  // Trigger: 用户明确要求未发布改动复用同一个蓝图版本，不以未发布版本作为历史迁移边界。
  // Evidence: 远端 v1.5.0 的蓝图、基地及迁移 schema 均为 5。
  // Replacement: 下方合并后的 5→6 迁移。
  // Risk: Low；仅兼容已发布 schema 1～5，当前未发布目标统一为 6。
  // Human Review: Required
  //
  // Original code:
  //   {
  //     fromVersion: 5,
  //     toVersion: 6,
  //     // AI-CORRECTION 2026-09-11: schema 6 文档可能已在用户环境存在，5→6 保持原空规则以避免重放本次端口补偿。
  //     deviceRules: [],
  //   },
  {
    fromVersion: 5,
    toVersion: 6,
    // AI-CORRECTION 2026-09-11: 将 AKEData 1.5.3@9913107-5 确认的 37 个唯一 180°修正放入新兼容边界；schema 6 文档只在本 step 旋转一次。
    // AI-CORRECTION 2026-09-11: 上述 6→7 边界未发布，现合并回 5→6；37 项端口补偿保持不变，三台液体变体同时重命名。
    // 对称、无映射和无端口定义继续不纳入。
    // AI-CORRECTION 2026-09-12: AKEData 1.5.3@9885010-4 的物流阀门专表补充确认两个准入口各需 270°文档补偿；本 step 现共 39 项。
    deviceRules: [
      { fromDeviceId: "storager_1", toDeviceId: "storager_1", rotationOffset: 180 },
      { fromDeviceId: "mix_pool_1", toDeviceId: "mix_pool_1", rotationOffset: 180 },
      { fromDeviceId: "grinder_1", toDeviceId: "grinder_1", rotationOffset: 180 },
      { fromDeviceId: "liquid_filling_pd_mc_1", toDeviceId: "filling_pd_mc_1_liquid", rotationOffset: 180 },
      { fromDeviceId: "filling_pd_mc_1", toDeviceId: "filling_pd_mc_1", rotationOffset: 180 },
      { fromDeviceId: "udpipe_loader_1", toDeviceId: "udpipe_loader_1", rotationOffset: 180 },
      { fromDeviceId: "udpipe_unloader_1", toDeviceId: "udpipe_unloader_1", rotationOffset: 180 },
      { fromDeviceId: "furnance_1", toDeviceId: "furnance_1", rotationOffset: 180 },
      { fromDeviceId: "liquid_furnance_1", toDeviceId: "furnance_1_liquid", rotationOffset: 180 },
      { fromDeviceId: "cmpt_mc_1", toDeviceId: "cmpt_mc_1", rotationOffset: 180 },
      { fromDeviceId: "shaper_1", toDeviceId: "shaper_1", rotationOffset: 180 },
      { fromDeviceId: "shaper_1_gas", toDeviceId: "shaper_1_gas", rotationOffset: 180 },
      { fromDeviceId: "seedcol_1", toDeviceId: "seedcol_1", rotationOffset: 180 },
      { fromDeviceId: "planter_1", toDeviceId: "planter_1", rotationOffset: 180 },
      { fromDeviceId: "hydro_planter_1", toDeviceId: "planter_1_liquid", rotationOffset: 180 },
      { fromDeviceId: "winder_1", toDeviceId: "winder_1", rotationOffset: 180 },
      { fromDeviceId: "tools_asm_mc_1", toDeviceId: "tools_asm_mc_1", rotationOffset: 180 },
      { fromDeviceId: "thickener_1", toDeviceId: "thickener_1", rotationOffset: 180 },
      { fromDeviceId: "power_sta_1", toDeviceId: "power_sta_1", rotationOffset: 180 },
      { fromDeviceId: "mix_pool_2", toDeviceId: "mix_pool_2", rotationOffset: 180 },
      { fromDeviceId: "liquid_purifier_1", toDeviceId: "liquid_purifier_1", rotationOffset: 180 },
      { fromDeviceId: "liquid_purifier_1_gas", toDeviceId: "liquid_purifier_1_gas", rotationOffset: 180 },
      { fromDeviceId: "xiranite_oven_1", toDeviceId: "xiranite_oven_1", rotationOffset: 180 },
      { fromDeviceId: "dismantler_1", toDeviceId: "dismantler_1", rotationOffset: 180 },
      { fromDeviceId: "transmuter_2_gastrans", toDeviceId: "transmuter_2_gastrans", rotationOffset: 180 },
      { fromDeviceId: "transmuter_2_solidtrans", toDeviceId: "transmuter_2_solidtrans", rotationOffset: 180 },
      { fromDeviceId: "gas_reactor_1", toDeviceId: "gas_reactor_1", rotationOffset: 180 },
      { fromDeviceId: "transmuter_1_gastrans", toDeviceId: "transmuter_1_gastrans", rotationOffset: 180 },
      { fromDeviceId: "transmuter_1_liquidtrans", toDeviceId: "transmuter_1_liquidtrans", rotationOffset: 180 },
      { fromDeviceId: "water_pump_1", toDeviceId: "water_pump_1", rotationOffset: 180 },
      { fromDeviceId: "udpipe_loader_2", toDeviceId: "udpipe_loader_2", rotationOffset: 180 },
      { fromDeviceId: "udpipe_unloader_2", toDeviceId: "udpipe_unloader_2", rotationOffset: 180 },
      { fromDeviceId: "liquid_cleaner_1", toDeviceId: "liquid_cleaner_1", rotationOffset: 180 },
      { fromDeviceId: "liquid_storager_1", toDeviceId: "liquid_storager_1", rotationOffset: 180 },
      { fromDeviceId: "gas_storager_1", toDeviceId: "gas_storager_1", rotationOffset: 180 },
      { fromDeviceId: "vaporizer_1", toDeviceId: "vaporizer_1", rotationOffset: 180 },
      { fromDeviceId: "gas_pump_1", toDeviceId: "gas_pump_1", rotationOffset: 180 },
      { fromDeviceId: "log_admission", toDeviceId: "log_admission", rotationOffset: 270 },
      { fromDeviceId: "pipe_admission", toDeviceId: "pipe_admission", rotationOffset: 270 },
    ],
  },
  // AI-REMOVED 2026-09-11:
  // Reason: 撤回额外的 schema 8；三台设备重命名与端口旋转属于同一次未发布升级。
  // Trigger: 用户明确要求未发布改动复用同一个蓝图版本，不以未发布版本作为历史迁移边界。
  // Evidence: 远端 v1.5.0 的蓝图、基地及迁移 schema 均为 5。
  // Replacement: 上方 5→6 的三个 old ID → new ID + 180° 规则。
  // Risk: Low；仅兼容已发布 schema 1～5，当前未发布目标统一为 6。
  // Human Review: Required
  //
  // Original code:
  //   {
  //     fromVersion: 7,
  //     toVersion: 8,
  //     // 2026-09-11: 液体变体统一为基础设备 ID + 模式后缀；历史旋转补偿仍只由 6→7 执行。
  //     deviceRules: [
  //       { fromDeviceId: "liquid_filling_pd_mc_1", toDeviceId: "filling_pd_mc_1_liquid", rotationOffset: 0 },
  //       { fromDeviceId: "hydro_planter_1", toDeviceId: "planter_1_liquid", rotationOffset: 0 },
  //       { fromDeviceId: "liquid_furnance_1", toDeviceId: "furnance_1_liquid", rotationOffset: 0 },
  //     ],
  //   },
  // AI-REMOVED 2026-09-11:
  // Reason: 端口旋转规则从 5→6 移入新建 6→7，保护可能已经存在的 schema 6 文档不被重复旋转。
  // Trigger: 无法由仓库 tag、发布提交或本地存档证明用户环境不存在 schema 6。
  // Evidence: schema 6 已是当前代码声明，且用户要求兼容已有 schema 6 文档。
  // Replacement: 上方 6→7 migration step。
  // Risk: Low；历史代码仅作为审计记录保留。
  // Human Review: Required
  //
  // Original code:
//   {
//     fromVersion: 5,
//     toVersion: 6,
//     // AI-CORRECTION 2026-09-11: 仓库可见发布证据显示 schema 6 引入提交 513e460c（2026-09-09）晚于全部正式/beta/pre tag（最新正式 tag v1.4.2.1，2026-08-28）及 2026-08-29 Alpha 发布提交；现有 public/blueprints 仍为 schema 5。因此在尚未暴露的 5→6 step 加入 AKEData 1.5.3@9913107-5 端口审计确认的 37 个唯一 180° 修正，保留既有 4→5 历史迁移。
//     // `unloader_1`、`loader_1`、`sp_hub_1` 为 180° 对称，未纳入无证据旋转；未映射和无端口定义同样不纳入。
//     deviceRules: [
//       { fromDeviceId: "storager_1", toDeviceId: "storager_1", rotationOffset: 180 },
//       { fromDeviceId: "mix_pool_1", toDeviceId: "mix_pool_1", rotationOffset: 180 },
//       { fromDeviceId: "grinder_1", toDeviceId: "grinder_1", rotationOffset: 180 },
//       { fromDeviceId: "liquid_filling_pd_mc_1", toDeviceId: "liquid_filling_pd_mc_1", rotationOffset: 180 },
//       { fromDeviceId: "filling_pd_mc_1", toDeviceId: "filling_pd_mc_1", rotationOffset: 180 },
//       { fromDeviceId: "udpipe_loader_1", toDeviceId: "udpipe_loader_1", rotationOffset: 180 },
//       { fromDeviceId: "udpipe_unloader_1", toDeviceId: "udpipe_unloader_1", rotationOffset: 180 },
//       { fromDeviceId: "furnance_1", toDeviceId: "furnance_1", rotationOffset: 180 },
//       { fromDeviceId: "liquid_furnance_1", toDeviceId: "liquid_furnance_1", rotationOffset: 180 },
//       { fromDeviceId: "cmpt_mc_1", toDeviceId: "cmpt_mc_1", rotationOffset: 180 },
//       { fromDeviceId: "shaper_1", toDeviceId: "shaper_1", rotationOffset: 180 },
//       { fromDeviceId: "shaper_1_gas", toDeviceId: "shaper_1_gas", rotationOffset: 180 },
//       { fromDeviceId: "seedcol_1", toDeviceId: "seedcol_1", rotationOffset: 180 },
//       { fromDeviceId: "planter_1", toDeviceId: "planter_1", rotationOffset: 180 },
//       { fromDeviceId: "hydro_planter_1", toDeviceId: "hydro_planter_1", rotationOffset: 180 },
//       { fromDeviceId: "winder_1", toDeviceId: "winder_1", rotationOffset: 180 },
//       { fromDeviceId: "tools_asm_mc_1", toDeviceId: "tools_asm_mc_1", rotationOffset: 180 },
//       { fromDeviceId: "thickener_1", toDeviceId: "thickener_1", rotationOffset: 180 },
//       { fromDeviceId: "power_sta_1", toDeviceId: "power_sta_1", rotationOffset: 180 },
//       { fromDeviceId: "mix_pool_2", toDeviceId: "mix_pool_2", rotationOffset: 180 },
//       { fromDeviceId: "liquid_purifier_1", toDeviceId: "liquid_purifier_1", rotationOffset: 180 },
//       { fromDeviceId: "liquid_purifier_1_gas", toDeviceId: "liquid_purifier_1_gas", rotationOffset: 180 },
//       { fromDeviceId: "xiranite_oven_1", toDeviceId: "xiranite_oven_1", rotationOffset: 180 },
//       { fromDeviceId: "dismantler_1", toDeviceId: "dismantler_1", rotationOffset: 180 },
//       { fromDeviceId: "transmuter_2_gastrans", toDeviceId: "transmuter_2_gastrans", rotationOffset: 180 },
//       { fromDeviceId: "transmuter_2_solidtrans", toDeviceId: "transmuter_2_solidtrans", rotationOffset: 180 },
//       { fromDeviceId: "gas_reactor_1", toDeviceId: "gas_reactor_1", rotationOffset: 180 },
//       { fromDeviceId: "transmuter_1_gastrans", toDeviceId: "transmuter_1_gastrans", rotationOffset: 180 },
//       { fromDeviceId: "transmuter_1_liquidtrans", toDeviceId: "transmuter_1_liquidtrans", rotationOffset: 180 },
//       { fromDeviceId: "water_pump_1", toDeviceId: "water_pump_1", rotationOffset: 180 },
//       { fromDeviceId: "udpipe_loader_2", toDeviceId: "udpipe_loader_2", rotationOffset: 180 },
//       { fromDeviceId: "udpipe_unloader_2", toDeviceId: "udpipe_unloader_2", rotationOffset: 180 },
//       { fromDeviceId: "liquid_cleaner_1", toDeviceId: "liquid_cleaner_1", rotationOffset: 180 },
//       { fromDeviceId: "liquid_storager_1", toDeviceId: "liquid_storager_1", rotationOffset: 180 },
//       { fromDeviceId: "gas_storager_1", toDeviceId: "gas_storager_1", rotationOffset: 180 },
//       { fromDeviceId: "vaporizer_1", toDeviceId: "vaporizer_1", rotationOffset: 180 },
//       { fromDeviceId: "gas_pump_1", toDeviceId: "gas_pump_1", rotationOffset: 180 },
//     ],
//   },
] as const satisfies readonly BlueprintDeviceIdMigrationSpec[];

const MIGRATION_SPEC_BY_SOURCE_VERSION = createMigrationSpecBySourceVersion(
  BLUEPRINT_DEVICE_ID_MIGRATION_SPECS,
);

// AI-REMOVED 2026-07-19:
// Reason: 旧索引会把任意历史 ID 直接压平到最新 ID，无法逐版本断言，也无法携带旋转增量。
// Trigger: 用户要求将现有 ID 迁移固化为 schema 2，并将带旋转规则的去前缀迁移定义为 schema 3。
// Evidence: 新迁移链必须严格执行 1→2→3，不能从 schema 1 跳过 schema 2。
// Replacement: MIGRATION_SPEC_BY_SOURCE_VERSION + migrateBlueprintEntityDeviceIds
// Risk: Low
// Human Review: Required
//
// Original code:
// const LATEST_DEVICE_ID_BY_HISTORICAL_ID = new Map<string, string>(
//   BLUEPRINT_DEVICE_ID_MIGRATION_SPECS.flatMap((spec) =>
//     spec.historicalDeviceIds.map((historicalId) => [historicalId, spec.deviceId] as const),
//   ),
// );

// AI-REMOVED 2026-07-19:
// Reason: 直接解析到最新 ID 会丢失中间 schema 与旋转迁移语义。
// Trigger: 用户要求任意版本必须逐阶段迁移，并在每一步进行断言。
// Evidence: schema 1 的 item_port_mix_pool_large_1 必须先迁移为 schema 2 的 item_port_mix_pool_2。
// Replacement: migrateBlueprintEntityDeviceIds
// Risk: Low
// Human Review: Required
//
// Original code:
// export function resolveLatestBlueprintDeviceId(deviceId: string): string {
//   return LATEST_DEVICE_ID_BY_HISTORICAL_ID.get(deviceId) ?? deviceId;
// }

export function migrateBlueprintEntityDeviceIds<TEntity extends WorldEntity>(
  entities: Record<string, TEntity>,
  sourceSchemaVersion: number,
  targetSchemaVersion: number = BLUEPRINT_DEVICE_ID_SCHEMA_VERSION,
): BlueprintEntityDeviceIdMigrationResult<TEntity> | null {
  const migration = migrateBlueprintDocumentState({
    entities,
    entityOrder: Object.keys(entities),
    slotLinks: [],
    regions: [],
  }, sourceSchemaVersion, targetSchemaVersion);

  return migration === null
    ? null
    : {
        schemaVersion: migration.schemaVersion,
        entities: migration.entities,
      };
}

/**
 * 蓝图、基地与系统蓝图共用的完整文档迁移入口。
 *
 * AI-CORRECTION 2026-08-19: 设备 ID 之外的迁移必须从这里进入，避免丢失
 * entityOrder 或 slotLinks 上的跨对象语义。
 */
export function migrateBlueprintDocumentState<TEntity extends WorldEntity>(
  state: BlueprintDocumentMigrationState<TEntity>,
  sourceSchemaVersion: number,
  targetSchemaVersion: number = BLUEPRINT_DEVICE_ID_SCHEMA_VERSION,
): BlueprintDocumentMigrationResult<TEntity> | null {
  const forceFlattenFutureVersion =
    sourceSchemaVersion > BLUEPRINT_DEVICE_ID_SCHEMA_VERSION
    && targetSchemaVersion === BLUEPRINT_DEVICE_ID_SCHEMA_VERSION
    && readForceFlattenBlueprintVersionEnabled();

  if (
    !Number.isInteger(sourceSchemaVersion)
    || !Number.isInteger(targetSchemaVersion)
    || sourceSchemaVersion < 1
    || targetSchemaVersion > BLUEPRINT_DEVICE_ID_SCHEMA_VERSION
    || (!forceFlattenFutureVersion && targetSchemaVersion < sourceSchemaVersion)
  ) {
    return null;
  }

  const normalizedRegions = normalizeRegionAnnotations(
    sourceSchemaVersion >= 6 ? state.regions : state.regions ?? [],
  );
  if (normalizedRegions === null) {
    return null;
  }

  // 2026-09-11: 调试开关仅将未发布的未来 schema 降写为当前最高版本，
  // 不执行任何历史迁移；关闭开关时仍由上方校验拒绝。
  let schemaVersion = forceFlattenFutureVersion
    ? BLUEPRINT_DEVICE_ID_SCHEMA_VERSION
    : sourceSchemaVersion;
  let nextState: BlueprintDocumentMigrationState<TEntity> = {
    entities: state.entities,
    entityOrder: state.entityOrder,
    slotLinks: state.slotLinks,
    regions: normalizedRegions,
  };

  while (schemaVersion < targetSchemaVersion) {
    const spec = MIGRATION_SPEC_BY_SOURCE_VERSION.get(schemaVersion);

    if (spec === undefined || spec.toVersion !== schemaVersion + 1) {
      return null;
    }

    nextState = {
      ...nextState,
      entities: applyBlueprintDeviceIdMigrationRules(nextState.entities, spec.deviceRules),
    };
    // AI-REMOVED 2026-08-19:
    // Reason: 两个互斥 if 只支持每个 schema 版本执行单项迁移，无法组合 schema 5 的独立迁移步骤。
    // Trigger: 4→5 必须同时迁移资源泵并清理暗管入口 recipeChannels 旧配置。
    // Evidence: BlueprintDeviceIdMigrationSpec 已改为 documentMigrations 有序列表。
    // Replacement: 下方 documentMigrations 循环与 switch。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // if (spec.documentMigration === "normalize-admission-rate") {
    //   nextState = {
    //     ...nextState,
    //     entities: applyAdmissionRateConfigMigration(nextState.entities),
    //   };
    // }
    // if (spec.documentMigration === "migrate-resource-pump-sources") {
    //   nextState = applyResourcePumpSourceMigration(nextState);
    // }
    for (const documentMigration of spec.documentMigrations ?? []) {
      switch (documentMigration) {
        case "normalize-admission-rate":
          nextState = {
            ...nextState,
            entities: applyAdmissionRateConfigMigration(nextState.entities),
          };
          break;
        case "migrate-resource-pump-sources":
          nextState = applyResourcePumpSourceMigration(nextState);
          break;
        case "remove-dark-pipe-recipe-channel-config":
          nextState = {
            ...nextState,
            entities: removeLegacyDarkPipeRecipeChannelConfig(nextState.entities),
          };
          break;
      }
    }
    schemaVersion = spec.toVersion;
  }

  return {
    schemaVersion,
    entities: nextState.entities,
    entityOrder: nextState.entityOrder,
    slotLinks: nextState.slotLinks,
    regions: normalizedRegions,
  };
}

export function applyBlueprintDeviceIdMigrationRules<TEntity extends WorldEntity>(
  entities: Record<string, TEntity>,
  rules: readonly BlueprintDeviceIdMigrationRule[],
): Record<string, TEntity> {
  const ruleBySourceDeviceId = new Map<string, BlueprintDeviceIdMigrationRule>();

  for (const rule of rules) {
    if (ruleBySourceDeviceId.has(rule.fromDeviceId)) {
      throw new Error(`Duplicate blueprint device migration source ID: ${rule.fromDeviceId}`);
    }

    ruleBySourceDeviceId.set(rule.fromDeviceId, rule);
  }

  let nextEntities = entities;

  for (const [entityId, entity] of Object.entries(entities)) {
    const rule = ruleBySourceDeviceId.get(entity.definitionId);

    if (rule === undefined) {
      continue;
    }

    if (nextEntities === entities) {
      nextEntities = { ...entities };
    }

    nextEntities[entityId] = {
      ...entity,
      definitionId: rule.toDeviceId,
      rotation: rotateGridRotation(entity.rotation, rule.rotationOffset),
    };
  }

  return nextEntities;
}

function applyAdmissionRateConfigMigration<TEntity extends WorldEntity>(
  entities: Record<string, TEntity>,
): Record<string, TEntity> {
  let nextEntities = entities;

  for (const [entityId, entity] of Object.entries(entities)) {
    const maximumRate = ADMISSION_RATE_MAX_BY_DEFINITION_ID[entity.definitionId];
    if (maximumRate === undefined) {
      continue;
    }

    const rawRule = entity.config[ADMISSION_RULE_CONFIG_PATH];
    if (!isRecord(rawRule)) {
      continue;
    }

    const rawRate = rawRule.perMinuteLimit;
    if (typeof rawRate !== "number" || !Number.isFinite(rawRate)) {
      continue;
    }

    const normalizedRate = Math.min(
      maximumRate,
      Math.max(
        ADMISSION_RATE_WINDOWS_PER_MINUTE,
        Math.ceil(rawRate / ADMISSION_RATE_WINDOWS_PER_MINUTE) * ADMISSION_RATE_WINDOWS_PER_MINUTE,
      ),
    );
    if (rawRate === normalizedRate) {
      continue;
    }

    if (nextEntities === entities) {
      nextEntities = { ...entities };
    }

    nextEntities[entityId] = {
      ...entity,
      config: {
        ...entity.config,
        [ADMISSION_RULE_CONFIG_PATH]: {
          ...rawRule,
          perMinuteLimit: normalizedRate,
        },
      },
    };
  }

  return nextEntities;
}

function removeLegacyDarkPipeRecipeChannelConfig<TEntity extends WorldEntity>(
  entities: Record<string, TEntity>,
): Record<string, TEntity> {
  let nextEntities = entities;

  for (const [entityId, entity] of Object.entries(entities)) {
    if (!DARK_PIPE_INLET_DEFINITION_IDS.has(entity.definitionId)) {
      continue;
    }

    const configEntries = Object.entries(entity.config);
    const retainedConfigEntries = configEntries.filter(([configPath]) =>
      configPath !== "recipeChannels"
      && !configPath.startsWith(DARK_PIPE_RECIPE_CHANNEL_CONFIG_PREFIX),
    );
    if (retainedConfigEntries.length === configEntries.length) {
      continue;
    }

    if (nextEntities === entities) {
      nextEntities = { ...entities };
    }

    nextEntities[entityId] = {
      ...entity,
      config: Object.fromEntries(retainedConfigEntries),
    };
  }

  return nextEntities;
}

function applyResourcePumpSourceMigration<TEntity extends WorldEntity>(
  state: BlueprintDocumentMigrationState<TEntity>,
): BlueprintDocumentMigrationState<TEntity> {
  let nextEntities = state.entities;
  let nextSlotLinks = state.slotLinks;

  for (const [entityId, entity] of Object.entries(state.entities)) {
    const migration = RESOURCE_PUMP_MIGRATION_BY_DEFINITION_ID[
      entity.definitionId as keyof typeof RESOURCE_PUMP_MIGRATION_BY_DEFINITION_ID
    ];
    if (migration === undefined) {
      continue;
    }

    const warehouseLinks = nextSlotLinks.filter((link) =>
      link.source.entityId === entity.id
      && isWarehouseEntityId(link.target.entityId),
    );
    const selectedItemId = resolveLegacyPumpSelectedItemId(entity, warehouseLinks);
    const recipeId = selectedItemId === null
      ? null
      : migration.recipeIdByItemId[
          selectedItemId as keyof typeof migration.recipeIdByItemId
        ] ?? null;
    const baseConfig = removeLegacyPumpSourceConfig(entity.config);

    if (nextEntities === state.entities) {
      nextEntities = { ...state.entities };
    }

    if (selectedItemId === null) {
      nextEntities[entityId] = {
        ...entity,
        config: baseConfig,
      };
      nextSlotLinks = removeLinks(nextSlotLinks, new Set(warehouseLinks.map((link) => link.id)));
      continue;
    }

    if (recipeId !== null) {
      nextEntities[entityId] = {
        ...entity,
        config: {
          ...baseConfig,
          channelRecipes: {
            default: recipeId,
          },
        },
      };
      nextSlotLinks = removeLinks(nextSlotLinks, new Set(warehouseLinks.map((link) => link.id)));
      continue;
    }

    const outputCell = rotateLocalPortCell({
      footprint: RESOURCE_PUMP_FOOTPRINT,
      port: RESOURCE_PUMP_OUTPUT_PORT,
      rotation: entity.rotation,
    });
    nextEntities[entityId] = {
      ...entity,
      definitionId: migration.cheatDefinitionId,
      position: {
        x: entity.position.x + outputCell.x,
        y: entity.position.y + outputCell.y,
      },
      rotation: 0,
      config: {
        ...baseConfig,
        "storageSlotGroups[1].slots[0].initialItemType": selectedItemId,
        "storageSlotGroups[1].slots[0].initialCount": 50,
        "storageSlotGroups[1].slots[0].ignoreStock": true,
      },
    };
    nextSlotLinks = nextSlotLinks.filter((link) =>
      link.source.entityId !== entity.id
      && link.target.entityId !== entity.id,
    );
  }

  return {
    entities: nextEntities,
    entityOrder: state.entityOrder,
    slotLinks: nextSlotLinks,
  };
}

function resolveLegacyPumpSelectedItemId(
  entity: WorldEntity,
  warehouseLinks: readonly SlotLinkDefinition[],
): string | null {
  const linkedItemId = warehouseLinks.at(-1)?.target.slotId;
  if (typeof linkedItemId === "string" && linkedItemId.length > 0) {
    return linkedItemId;
  }

  const legacyPumpOutputItemId = entity.config.pumpOutputItemId;
  if (typeof legacyPumpOutputItemId === "string" && legacyPumpOutputItemId.length > 0) {
    return legacyPumpOutputItemId;
  }

  const initialItemType = entity.config["storageSlotGroups[0].slots[0].initialItemType"];
  return typeof initialItemType === "string" && initialItemType.length > 0
    ? initialItemType
    : null;
}

function removeLegacyPumpSourceConfig(config: Record<string, unknown>): Record<string, unknown> {
  const nextConfig = { ...config };
  delete nextConfig.channelRecipes;
  delete nextConfig.pumpOutputItemId;
  delete nextConfig["storageSlotGroups[0].slots[0].initialItemType"];
  delete nextConfig["storageSlotGroups[0].slots[0].initialCount"];
  delete nextConfig["storageSlotGroups[0].slots[0].ignoreStock"];
  return nextConfig;
}

function isWarehouseEntityId(entityId: string): boolean {
  return entityId === "warehouse" || entityId.startsWith("warehouse:");
}

function removeLinks(
  links: readonly SlotLinkDefinition[],
  linkIds: ReadonlySet<string>,
): readonly SlotLinkDefinition[] {
  return linkIds.size === 0
    ? links
    : links.filter((link) => !linkIds.has(link.id));
}

export function migrateBlueprintDeviceReference(
  deviceId: string,
  rotation: GridRotation = 0,
  sourceSchemaVersion: number = 1,
  targetSchemaVersion: number = BLUEPRINT_DEVICE_ID_SCHEMA_VERSION,
): BlueprintDeviceReferenceMigrationResult | null {
  const migration = migrateBlueprintEntityDeviceIds({
    reference: {
      id: "device-migration-reference",
      definitionId: deviceId,
      position: { x: 0, y: 0 },
      rotation,
      config: {},
      tags: [],
    },
  }, sourceSchemaVersion, targetSchemaVersion);
  const entity = migration?.entities.reference;

  if (migration === null || entity === undefined) {
    return null;
  }

  return {
    schemaVersion: migration.schemaVersion,
    deviceId: entity.definitionId,
    rotation: entity.rotation,
  };
}

function createMigrationSpecBySourceVersion(
  specs: readonly BlueprintDeviceIdMigrationSpec[],
): ReadonlyMap<number, BlueprintDeviceIdMigrationSpec> {
  const specBySourceVersion = new Map<number, BlueprintDeviceIdMigrationSpec>();

  for (const spec of specs) {
    if (spec.toVersion !== spec.fromVersion + 1) {
      throw new Error(`Blueprint device migration must be contiguous: ${spec.fromVersion} -> ${spec.toVersion}`);
    }

    if (specBySourceVersion.has(spec.fromVersion)) {
      throw new Error(`Duplicate blueprint device migration source version: ${spec.fromVersion}`);
    }

    specBySourceVersion.set(spec.fromVersion, spec);
  }

  return specBySourceVersion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
