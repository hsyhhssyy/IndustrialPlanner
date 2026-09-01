import {
  migrateModuleIconItemIds,
  parseModuleIconItemIds,
} from "@/app/module-icon";

export const MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION = 2;
const LEGACY_MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION = 1;

interface ModuleBalancingCustomModuleIconMigrationInput {
  readonly schemaVersion: unknown;
  readonly iconItemIds: unknown;
  readonly legacyIconId: unknown;
  readonly inputItemIds: readonly string[];
  readonly outputItemIds: readonly string[];
}

interface ModuleBalancingCustomModuleIconMigrationState {
  readonly iconItemIds: unknown;
  readonly legacyIconId: unknown;
}

interface ModuleBalancingCustomModuleMigrationSpec {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (
    state: ModuleBalancingCustomModuleIconMigrationState,
    input: ModuleBalancingCustomModuleIconMigrationInput,
  ) => ModuleBalancingCustomModuleIconMigrationState | null;
}

const MODULE_BALANCING_CUSTOM_MODULE_MIGRATION_SPECS: readonly ModuleBalancingCustomModuleMigrationSpec[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: (state, input) => {
      const iconItemIds = migrateModuleIconItemIds(
        undefined,
        state.legacyIconId,
        input.inputItemIds,
        input.outputItemIds,
      );

      return iconItemIds === null
        ? null
        : {
            iconItemIds,
            legacyIconId: state.legacyIconId,
          };
    },
  },
] as const;

const MODULE_BALANCING_CUSTOM_MODULE_MIGRATION_SPEC_BY_SOURCE_VERSION = new Map<
  number,
  ModuleBalancingCustomModuleMigrationSpec
>(
  MODULE_BALANCING_CUSTOM_MODULE_MIGRATION_SPECS.map((spec) => [spec.fromVersion, spec]),
);

/**
 * 未声明 schemaVersion 的历史模块按 schema 1 处理；未来版本由同步层静默跳过。
 */
export function resolveModuleBalancingCustomModuleSchemaVersion(value: unknown): number | null {
  if (value === undefined) {
    return LEGACY_MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION;
  }

  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

export function isUnsupportedModuleBalancingCustomModuleVersion(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const schemaVersion = resolveModuleBalancingCustomModuleSchemaVersion(value.schemaVersion);

  return schemaVersion !== null
    && schemaVersion > MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION;
}

/**
 * 严格逐版本迁移模块图标字段，迁移链缺口、非法版本和未来版本均拒绝解释。
 */
export function migrateModuleBalancingCustomModuleIconItemIds(
  input: ModuleBalancingCustomModuleIconMigrationInput,
): string[] | null {
  const sourceSchemaVersion = resolveModuleBalancingCustomModuleSchemaVersion(input.schemaVersion);
  if (
    sourceSchemaVersion === null
    || sourceSchemaVersion > MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION
  ) {
    return null;
  }

  let schemaVersion = sourceSchemaVersion;
  let state: ModuleBalancingCustomModuleIconMigrationState = {
    iconItemIds: input.iconItemIds,
    legacyIconId: input.legacyIconId,
  };

  while (schemaVersion < MODULE_BALANCING_CUSTOM_MODULE_SCHEMA_VERSION) {
    const spec = MODULE_BALANCING_CUSTOM_MODULE_MIGRATION_SPEC_BY_SOURCE_VERSION.get(schemaVersion);
    if (spec === undefined || spec.toVersion !== schemaVersion + 1) {
      return null;
    }

    const migratedState = spec.migrate(state, input);
    if (migratedState === null) {
      return null;
    }
    state = migratedState;
    schemaVersion = spec.toVersion;
  }

  return parseModuleIconItemIds(state.iconItemIds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
