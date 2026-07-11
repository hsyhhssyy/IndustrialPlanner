import type { WorldEntity } from "@/domain/document/world-document";

export interface BlueprintDeviceIdMigrationSpec {
  readonly deviceId: string;
  readonly historicalDeviceIds: readonly string[];
}

export const BLUEPRINT_DEVICE_ID_MIGRATION_SPECS = [
  {
    deviceId: "item_port_mix_pool_2",
    historicalDeviceIds: ["item_port_mix_pool_large_1"],
  },
] as const satisfies readonly BlueprintDeviceIdMigrationSpec[];

const LATEST_DEVICE_ID_BY_HISTORICAL_ID = new Map<string, string>(
  BLUEPRINT_DEVICE_ID_MIGRATION_SPECS.flatMap((spec) =>
    spec.historicalDeviceIds.map((historicalId) => [historicalId, spec.deviceId] as const),
  ),
);

export function resolveLatestBlueprintDeviceId(deviceId: string): string {
  return LATEST_DEVICE_ID_BY_HISTORICAL_ID.get(deviceId) ?? deviceId;
}

export function migrateBlueprintEntityDeviceIds<TEntity extends WorldEntity>(
  entities: Record<string, TEntity>,
): Record<string, TEntity> {
  let nextEntities = entities;

  for (const [entityId, entity] of Object.entries(entities)) {
    const latestDeviceId = resolveLatestBlueprintDeviceId(entity.definitionId);

    if (latestDeviceId === entity.definitionId) {
      continue;
    }

    if (nextEntities === entities) {
      nextEntities = { ...entities };
    }

    nextEntities[entityId] = {
      ...entity,
      definitionId: latestDeviceId,
    };
  }

  return nextEntities;
}
