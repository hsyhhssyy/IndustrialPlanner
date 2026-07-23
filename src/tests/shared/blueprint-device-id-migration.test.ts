import { describe, expect, it } from "vitest";

import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import type { WorldEntity } from "@/domain/document/world-document";
import { WORLD_DOCUMENT_SCHEMA_VERSION } from "@/domain/document/world-document";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import {
  applyBlueprintDeviceIdMigrationRules,
  BLUEPRINT_DEVICE_ID_MIGRATION_SPECS,
  BLUEPRINT_DEVICE_ID_SCHEMA_VERSION,
  migrateBlueprintEntityDeviceIds,
} from "@/shared/blueprint-device-id-migration";
import { normalizeWorldDocument } from "@/shared/storage/world-document-storage";

function createEntity(definitionId: string, rotation: WorldEntity["rotation"] = 0): WorldEntity {
  return {
    id: "entity",
    definitionId,
    position: { x: 4, y: 8 },
    rotation,
    config: { retained: true },
    tags: ["retained"],
  };
}

function migrateOneEntity(
  definitionId: string,
  sourceSchemaVersion: number,
  targetSchemaVersion: number,
): ReturnType<typeof migrateBlueprintEntityDeviceIds> {
  return migrateBlueprintEntityDeviceIds(
    { entity: createEntity(definitionId) },
    sourceSchemaVersion,
    targetSchemaVersion,
  );
}

describe("blueprint device id migration version chain", () => {
  it("declares one contiguous migration for every schema version up to current", () => {
    expect(BLUEPRINT_DEVICE_ID_SCHEMA_VERSION).toBe(4);
    expect(BLUEPRINT_SCHEMA_VERSION).toBe(BLUEPRINT_DEVICE_ID_SCHEMA_VERSION);
    expect(WORLD_DOCUMENT_SCHEMA_VERSION).toBe(BLUEPRINT_DEVICE_ID_SCHEMA_VERSION);
    expect(BLUEPRINT_DEVICE_ID_MIGRATION_SPECS.map((spec) => [
      spec.fromVersion,
      spec.toVersion,
    ])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it.each([
    { source: 1, target: 1, sourceId: "item_port_mix_pool_large_1", expectedId: "item_port_mix_pool_large_1" },
    { source: 1, target: 2, sourceId: "item_port_mix_pool_large_1", expectedId: "item_port_mix_pool_2" },
    { source: 1, target: 3, sourceId: "item_port_mix_pool_large_1", expectedId: "mix_pool_2" },
    { source: 1, target: 4, sourceId: "item_port_mix_pool_large_1", expectedId: "mix_pool_2" },
    { source: 2, target: 2, sourceId: "item_port_mix_pool_2", expectedId: "item_port_mix_pool_2" },
    { source: 2, target: 3, sourceId: "item_port_mix_pool_2", expectedId: "mix_pool_2" },
    { source: 2, target: 4, sourceId: "item_port_mix_pool_2", expectedId: "mix_pool_2" },
    { source: 3, target: 3, sourceId: "mix_pool_2", expectedId: "mix_pool_2" },
    { source: 3, target: 4, sourceId: "mix_pool_2", expectedId: "mix_pool_2" },
    { source: 4, target: 4, sourceId: "mix_pool_2", expectedId: "mix_pool_2" },
  ])(
    "covers the complete supported migration matrix: schema $source to $target",
    ({ source, target, sourceId, expectedId }) => {
      const result = migrateOneEntity(sourceId, source, target);

      expect(result?.schemaVersion).toBe(target);
      expect(result?.entities.entity).toMatchObject({
        definitionId: expectedId,
        rotation: 0,
        position: { x: 4, y: 8 },
        config: { retained: true },
        tags: ["retained"],
      });
    },
  );

  it("asserts every intermediate state while migrating schema 1 to current", () => {
    const version1Entities = {
      pool: createEntity("item_port_mix_pool_large_1"),
      grinder: createEntity("item_port_grinder_1", 270),
    };

    const version2 = migrateBlueprintEntityDeviceIds(version1Entities, 1, 2);

    expect(version2?.schemaVersion).toBe(2);
    expect(version2?.entities.pool).toMatchObject({
      definitionId: "item_port_mix_pool_2",
      rotation: 0,
      position: { x: 4, y: 8 },
      config: { retained: true },
      tags: ["retained"],
    });
    expect(version2?.entities.grinder).toMatchObject({
      definitionId: "item_port_grinder_1",
      rotation: 270,
    });

    const version3 = migrateBlueprintEntityDeviceIds(version2?.entities ?? {}, 2, 3);

    expect(version3?.schemaVersion).toBe(3);
    expect(version3?.entities.pool).toMatchObject({
      definitionId: "mix_pool_2",
      rotation: 0,
    });
    expect(version3?.entities.grinder).toMatchObject({
      definitionId: "grinder_1",
      rotation: 270,
    });

    const version4 = migrateBlueprintEntityDeviceIds(version3?.entities ?? {}, 3, 4);

    expect(version4?.schemaVersion).toBe(4);
    expect(version4?.entities).toEqual(version3?.entities);

    const directToCurrent = migrateBlueprintEntityDeviceIds(version1Entities, 1);

    expect(directToCurrent).toEqual(version4);
  });

  it.each([
    {
      sourceSchemaVersion: 1,
      sourceDeviceId: "item_port_mix_pool_large_1",
      expectedDeviceId: "mix_pool_2",
    },
    {
      sourceSchemaVersion: 2,
      sourceDeviceId: "item_port_mix_pool_2",
      expectedDeviceId: "mix_pool_2",
    },
    {
      sourceSchemaVersion: 3,
      sourceDeviceId: "mix_pool_2",
      expectedDeviceId: "mix_pool_2",
    },
    {
      sourceSchemaVersion: 4,
      sourceDeviceId: "mix_pool_2",
      expectedDeviceId: "mix_pool_2",
    },
  ])(
    "migrates schema $sourceSchemaVersion to current schema from its own canonical state",
    ({ sourceSchemaVersion, sourceDeviceId, expectedDeviceId }) => {
      const result = migrateOneEntity(
        sourceDeviceId,
        sourceSchemaVersion,
        BLUEPRINT_DEVICE_ID_SCHEMA_VERSION,
      );

      expect(result?.schemaVersion).toBe(BLUEPRINT_DEVICE_ID_SCHEMA_VERSION);
      expect(result?.entities.entity?.definitionId).toBe(expectedDeviceId);
      expect(result?.entities.entity?.rotation).toBe(0);
    },
  );

  it.each([
    { schemaVersion: 1, deviceId: "item_port_mix_pool_large_1" },
    { schemaVersion: 2, deviceId: "item_port_mix_pool_2" },
    { schemaVersion: 3, deviceId: "mix_pool_2" },
    { schemaVersion: 4, deviceId: "mix_pool_2" },
  ])(
    "normalizes blueprint and world documents from schema $schemaVersion to schema 4",
    ({ schemaVersion, deviceId }) => {
      const entity = createEntity(deviceId);
      const blueprint = normalizeBlueprintDocument({
        schemaVersion,
        blueprintId: `blueprint-v${schemaVersion}`,
        version: "v1.3.0",
        name: `Blueprint v${schemaVersion}`,
        description: "",
        baseId: "wuling_protocol_core",
        initialGridPoint: { x: 0, y: 0 },
        entities: { entity },
        entityOrder: ["entity"],
        slotLinks: [],
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z",
      });
      const world = normalizeWorldDocument({
        schemaVersion,
        documentKey: `world-v${schemaVersion}`,
        baseId: "wuling_protocol_core",
        meta: {
          id: `world-v${schemaVersion}`,
          name: `World v${schemaVersion}`,
          createdAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:00:00.000Z",
        },
        entities: { entity },
        entityOrder: ["entity"],
        slotLinks: [],
        documentSettings: {
          viewport: {
            center: { x: 0, y: 0 },
            gridSize: 1,
            displayRotation: 0,
          },
          powerMode: "infinite",
        },
      });

      expect(blueprint).toMatchObject({
        schemaVersion: 4,
        entities: { entity: { definitionId: "mix_pool_2", rotation: 0 } },
      });
      expect(world).toMatchObject({
        schemaVersion: 4,
        entities: { entity: { definitionId: "mix_pool_2", rotation: 0 } },
      });
    },
  );

  it("applies rotation offsets as part of a device migration rule", () => {
    const entities = {
      entity: createEntity("old_direction_device", 270),
    };

    const migrated = applyBlueprintDeviceIdMigrationRules(entities, [{
      fromDeviceId: "old_direction_device",
      toDeviceId: "new_direction_device",
      rotationOffset: 90,
    }]);

    expect(migrated.entity).toMatchObject({
      definitionId: "new_direction_device",
      rotation: 0,
      position: { x: 4, y: 8 },
      config: { retained: true },
      tags: ["retained"],
    });
  });

  it("keeps every production schema 2 to 3 rotation offset at zero in this release", () => {
    const version3Spec = BLUEPRINT_DEVICE_ID_MIGRATION_SPECS.find((spec) => spec.toVersion === 3);

    expect(version3Spec?.deviceRules.length).toBe(47);
    expect(version3Spec?.deviceRules.every((rule) => rule.rotationOffset === 0)).toBe(true);
  });

  it.each([
    { definitionId: "log_admission", oldRate: 0, expectedRate: 6 },
    { definitionId: "log_admission", oldRate: 1, expectedRate: 6 },
    { definitionId: "log_admission", oldRate: 2, expectedRate: 6 },
    { definitionId: "log_admission", oldRate: 3, expectedRate: 6 },
    { definitionId: "log_admission", oldRate: 7, expectedRate: 12 },
    { definitionId: "log_admission", oldRate: 30, expectedRate: 30 },
    { definitionId: "log_admission", oldRate: 31, expectedRate: 30 },
    { definitionId: "pipe_admission", oldRate: 119, expectedRate: 120 },
    { definitionId: "pipe_admission", oldRate: 121, expectedRate: 120 },
  ])(
    "normalizes schema 3 $definitionId rate $oldRate to $expectedRate per minute",
    ({ definitionId, oldRate, expectedRate }) => {
      const entity = createEntity(definitionId);
      entity.config = {
        retained: true,
        "portGroups[0].ports[0].admissionRule": {
          itemId: "item_liquid_water",
          limit: null,
          perMinuteLimit: oldRate,
        },
      };

      const result = migrateBlueprintEntityDeviceIds({ entity }, 3, 4);

      expect(result?.entities.entity?.config).toEqual({
        retained: true,
        "portGroups[0].ports[0].admissionRule": {
          itemId: "item_liquid_water",
          limit: null,
          perMinuteLimit: expectedRate,
        },
      });
    },
  );

  it("keeps empty admission rate settings disabled during schema 4 migration", () => {
    const entity = createEntity("pipe_admission");
    entity.config = {
      "portGroups[0].ports[0].admissionRule": {
        itemId: "item_liquid_water",
        limit: 2,
        perMinuteLimit: null,
      },
    };

    const result = migrateBlueprintEntityDeviceIds({ entity }, 3, 4);

    expect(result?.entities.entity?.config).toEqual(entity.config);
  });

  it("keeps an absent admission rate setting disabled during schema 4 migration", () => {
    const entity = createEntity("log_admission");
    entity.config = {
      "portGroups[0].ports[0].admissionRule": {
        itemId: "item_iron_ore",
        limit: 2,
      },
    };

    const result = migrateBlueprintEntityDeviceIds({ entity }, 3, 4);

    expect(result?.entities.entity?.config).toEqual(entity.config);
  });

  it("normalizes admission rates after historical admission device ids are migrated", () => {
    const entity = createEntity("item_log_admission");
    entity.config = {
      "portGroups[0].ports[0].admissionRule": {
        itemId: "item_iron_ore",
        limit: null,
        perMinuteLimit: 1,
      },
    };

    const result = migrateBlueprintEntityDeviceIds({ entity }, 2, 4);

    expect(result?.entities.entity).toMatchObject({
      definitionId: "log_admission",
      config: {
        "portGroups[0].ports[0].admissionRule": {
          itemId: "item_iron_ore",
          limit: null,
          perMinuteLimit: 6,
        },
      },
    });
  });

  it.each(
    BLUEPRINT_DEVICE_ID_MIGRATION_SPECS.flatMap((spec) =>
      spec.deviceRules.map((rule) => ({ spec, rule })),
    ),
  )(
    "applies the declared schema $spec.fromVersion to $spec.toVersion rule for $rule.fromDeviceId",
    ({ spec, rule }) => {
      const result = migrateOneEntity(rule.fromDeviceId, spec.fromVersion, spec.toVersion);

      expect(result?.schemaVersion).toBe(spec.toVersion);
      expect(result?.entities.entity).toMatchObject({
        definitionId: rule.toDeviceId,
        rotation: rule.rotationOffset,
      });
    },
  );

  it("maps every schema 3 target to a registered prefix-free entity definition", () => {
    const registeredIds = new Set(ENTITY_DEFINITIONS.map((definition) => definition.id));
    const version3Spec = BLUEPRINT_DEVICE_ID_MIGRATION_SPECS.find((spec) => spec.toVersion === 3);

    expect(ENTITY_DEFINITIONS).toHaveLength(62);
    expect(ENTITY_DEFINITIONS.filter((definition) => definition.id.startsWith("item_"))).toEqual([]);
    expect(version3Spec?.deviceRules.every((rule) => registeredIds.has(rule.toDeviceId))).toBe(true);
    expect(new Set(version3Spec?.deviceRules.map((rule) => rule.fromDeviceId)).size).toBe(
      version3Spec?.deviceRules.length,
    );
    expect(new Set(version3Spec?.deviceRules.map((rule) => rule.toDeviceId)).size).toBe(
      version3Spec?.deviceRules.length,
    );
  });

  it("rejects unsupported, future, reversed, and non-integer migration ranges", () => {
    const entities = { entity: createEntity("mix_pool_2") };

    expect(migrateBlueprintEntityDeviceIds(entities, 0)).toBeNull();
    expect(migrateBlueprintEntityDeviceIds(entities, 5)).toBeNull();
    expect(migrateBlueprintEntityDeviceIds(entities, 2, 1)).toBeNull();
    expect(migrateBlueprintEntityDeviceIds(entities, 1.5)).toBeNull();
  });
});
