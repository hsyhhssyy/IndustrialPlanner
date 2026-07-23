import type { WorldEntity } from "@/domain/document/world-document";
import type { GridRotation } from "@/domain/shared/grid";
import { rotateGridRotation } from "@/shared/geometry/grid";

export const BLUEPRINT_DEVICE_ID_SCHEMA_VERSION = 4;

const ADMISSION_RULE_CONFIG_PATH = "portGroups[0].ports[0].admissionRule";
const ADMISSION_RATE_STEP_PER_MINUTE = 6;
const ADMISSION_RATE_MAX_BY_DEFINITION_ID: Readonly<Record<string, number>> = {
  log_admission: 30,
  pipe_admission: 120,
};

export interface BlueprintDeviceIdMigrationRule {
  readonly fromDeviceId: string;
  readonly toDeviceId: string;
  readonly rotationOffset: GridRotation;
}

export interface BlueprintDeviceIdMigrationSpec {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly deviceRules: readonly BlueprintDeviceIdMigrationRule[];
  readonly entityConfigMigration?: "normalize-admission-rate";
}

export interface BlueprintEntityDeviceIdMigrationResult<TEntity extends WorldEntity> {
  readonly schemaVersion: number;
  readonly entities: Record<string, TEntity>;
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
    entityConfigMigration: "normalize-admission-rate",
  },
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
  if (
    !Number.isInteger(sourceSchemaVersion)
    || !Number.isInteger(targetSchemaVersion)
    || sourceSchemaVersion < 1
    || targetSchemaVersion < sourceSchemaVersion
    || targetSchemaVersion > BLUEPRINT_DEVICE_ID_SCHEMA_VERSION
  ) {
    return null;
  }

  let schemaVersion = sourceSchemaVersion;
  let nextEntities = entities;

  while (schemaVersion < targetSchemaVersion) {
    const spec = MIGRATION_SPEC_BY_SOURCE_VERSION.get(schemaVersion);

    if (spec === undefined || spec.toVersion !== schemaVersion + 1) {
      return null;
    }

    nextEntities = applyBlueprintDeviceIdMigrationRules(nextEntities, spec.deviceRules);
    if (spec.entityConfigMigration === "normalize-admission-rate") {
      nextEntities = applyAdmissionRateConfigMigration(nextEntities);
    }
    schemaVersion = spec.toVersion;
  }

  return {
    schemaVersion,
    entities: nextEntities,
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
        ADMISSION_RATE_STEP_PER_MINUTE,
        Math.ceil(rawRate / ADMISSION_RATE_STEP_PER_MINUTE) * ADMISSION_RATE_STEP_PER_MINUTE,
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
