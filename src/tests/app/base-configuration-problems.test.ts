import { describe, expect, it } from "vitest";

import {
  collectBaseConfigurationProblems,
  collectRuntimeInfiniteStorageEntityIds,
} from "@/app/shell/panels/base-configuration-problems";
import type {
  SlotLinkDefinition,
  WorldEntity,
} from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { INSPECTOR_TYPE } from "@/domain/registry/types/entity-inspector";
import type {
  SimulationDeviceRuntimeSlotItemReadModel,
} from "@/domain/simulation/types/simulation-types";
import { createRegistryContract } from "@/registry";

const registry = createRegistryContract();

describe("base configuration problems", () => {
  it("为每个作弊设备生成一条问题", () => {
    const entities = [
      createEntity("cheat-solid", "cheat_infinite_solid"),
      createEntity("cheat-liquid", "cheat_infinite_liquid"),
      createEntity("cheat-gas", "cheat_infinite_gas"),
    ];

    expect(collectProblems({ entities })).toEqual([
      createExpectedProblem("使用了作弊物品", "cheat-solid"),
      createExpectedProblem("使用了作弊物品", "cheat-liquid"),
      createExpectedProblem("使用了作弊物品", "cheat-gas"),
    ]);
  });

  it("单基地模式允许取货口矿物与两类采集泵的真实自然资源", () => {
    const allowedResourcesByDefinition = {
      unloader_1: [
        "item_copper_ore",
        "item_iron_ore",
        "item_originium_ore",
        "item_quartz_sand",
      ],
      gas_pump_1: ["item_gas_inert", "item_gas_xiranite"],
      water_pump_1: ["item_liquid_acid", "item_liquid_water"],
    } as const;
    const entities: WorldEntity[] = [];
    const slotLinks: SlotLinkDefinition[] = [];

    for (const [definitionId, itemIds] of Object.entries(allowedResourcesByDefinition)) {
      for (const itemId of itemIds) {
        const entityId = `${definitionId}:${itemId}`;
        const entry = createWarehouseInfiniteEntry(entityId, definitionId, itemId);
        entities.push(entry.entity);
        slotLinks.push(entry.slotLink);
      }
    }

    expect(collectProblems({ entities, slotLinks })).toEqual([]);
  });

  it("单基地模式对其他仓库链接无限资源按设备报错", () => {
    const invalidEntries = [
      createWarehouseInfiniteEntry("invalid-unloader", "unloader_1", "item_liquid_water"),
      createWarehouseInfiniteEntry("invalid-gas-pump", "gas_pump_1", "item_liquid_acid"),
      createWarehouseInfiniteEntry("invalid-water-pump", "water_pump_1", "item_gas_inert"),
      createWarehouseInfiniteEntry("invalid-hub", "sp_hub_1", "item_copper_ore"),
    ];
    const finiteEntry = createWarehouseInfiniteEntry(
      "finite-hub",
      "sp_hub_1",
      "item_copper_ore",
      false,
    );

    expect(collectProblems({
      entities: [...invalidEntries.map((entry) => entry.entity), finiteEntry.entity],
      slotLinks: [...invalidEntries.map((entry) => entry.slotLink), finiteEntry.slotLink],
    })).toEqual(invalidEntries.map((entry) =>
      createExpectedProblem("设置了不存在的无限资源", entry.entity.id),
    ));
  });

  it("多基地模式只禁止仓库取货口的任意无限资源", () => {
    const entries = [
      createWarehouseInfiniteEntry("multi-unloader", "unloader_1", "item_copper_ore"),
      createWarehouseInfiniteEntry("multi-gas-pump", "gas_pump_1", "item_liquid_water"),
      createWarehouseInfiniteEntry("multi-water-pump", "water_pump_1", "item_gas_inert"),
      createWarehouseInfiniteEntry("multi-hub", "sp_hub_1", "item_copper_ore"),
    ];

    expect(collectProblems({
      entities: entries.map((entry) => entry.entity),
      slotLinks: entries.map((entry) => entry.slotLink),
      multiBaseEnabled: true,
    })).toEqual([
      createExpectedProblem("设置了不存在的无限资源", "multi-unloader"),
    ]);
  });

  it("编辑配置或运行时状态中的普通槽位无限均按设备报错", () => {
    const configuredEntity = createEntity("configured-storage", "storager_1", {
      "storageSlotGroups[0].slots[0].ignoreStock": true,
      "storageSlotGroups[1].slots[0].ignoreStock": true,
    });
    const runtimeEntity = createEntity("runtime-storage", "storager_1");
    const finiteEntity = createEntity("finite-storage", "storager_1");
    const waterPump = createWarehouseInfiniteEntry(
      "runtime-water-pump",
      "water_pump_1",
      "item_liquid_water",
    );
    const runtimeSlotItemsByEntityId = new Map([
      [runtimeEntity.id, [createRuntimeSlotItem("storager_1", true)]],
      [finiteEntity.id, [createRuntimeSlotItem("storager_1", false)]],
      [waterPump.entity.id, [createRuntimeSlotItem("water_pump_1", true)]],
    ]);
    const entities = [configuredEntity, runtimeEntity, finiteEntity, waterPump.entity];
    const runtimeInfiniteStorageEntityIds = collectRuntimeInfiniteStorageEntityIds({
      entities,
      entityDefinitions: registry.entityDefinitions,
      runtimeSlotItemsByEntityId,
    });

    expect([...runtimeInfiniteStorageEntityIds]).toEqual(["runtime-storage"]);
    expect(collectProblems({
      entities,
      slotLinks: [waterPump.slotLink],
      runtimeInfiniteStorageEntityIds,
    })).toEqual([
      createExpectedProblem("设置了不可能实现的无限资源", "configured-storage"),
      createExpectedProblem("设置了不可能实现的无限资源", "runtime-storage"),
    ]);
  });
});

function collectProblems(options: {
  readonly entities: readonly WorldEntity[];
  readonly slotLinks?: readonly SlotLinkDefinition[];
  readonly multiBaseEnabled?: boolean;
  readonly runtimeInfiniteStorageEntityIds?: ReadonlySet<string>;
}) {
  return collectBaseConfigurationProblems({
    entities: options.entities,
    entityDefinitions: registry.entityDefinitions,
    itemDefinitions: registry.itemDefinitions,
    slotLinks: options.slotLinks ?? [],
    multiBaseEnabled: options.multiBaseEnabled ?? false,
    runtimeInfiniteStorageEntityIds: options.runtimeInfiniteStorageEntityIds,
  });
}

function createEntity(
  id: string,
  definitionId: string,
  config: Record<string, unknown> = {},
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x: 0, y: 0 },
    rotation: 0,
    config,
    tags: [],
  };
}

function createWarehouseInfiniteEntry(
  entityId: string,
  definitionId: string,
  itemId: string,
  ignoreStock = true,
): { entity: WorldEntity; slotLink: SlotLinkDefinition } {
  const definition = getDefinition(definitionId);
  const declaration = definition.inspectors.find(
    (inspector) => inspector.type === INSPECTOR_TYPE.warehouseItemLink,
  );
  if (declaration?.type !== INSPECTOR_TYPE.warehouseItemLink) {
    throw new Error(`Definition ${definitionId} has no warehouse item link inspector.`);
  }
  const storageGroupId = declaration.slotGroupIds[0];
  const storageGroupIndex = definition.storageSlotGroups.findIndex(
    (storageGroup) => storageGroup.id === storageGroupId,
  );
  const storageGroup = definition.storageSlotGroups[storageGroupIndex];
  const slot = storageGroup?.slots.find((candidate) =>
    declaration.slotIds === undefined || declaration.slotIds.includes(candidate.id),
  );
  if (
    storageGroupId === undefined ||
    storageGroupIndex < 0 ||
    storageGroup === undefined ||
    slot === undefined
  ) {
    throw new Error(`Definition ${definitionId} has no declared warehouse slot.`);
  }
  const slotIndex = storageGroup.slots.indexOf(slot);
  const entity = createEntity(entityId, definitionId, {
    [`storageSlotGroups[${storageGroupIndex}].slots[${slotIndex}].ignoreStock`]: ignoreStock,
  });
  return {
    entity,
    slotLink: {
      id: `warehouse-link:${entityId}:${storageGroupId}:${slot.id}`,
      linkType: "share-all",
      source: {
        entityId,
        storageSlotGroupId: storageGroupId,
        slotId: slot.id,
      },
      target: {
        entityId: "warehouse",
        storageSlotGroupId: "warehouse",
        slotId: itemId,
      },
    },
  };
}

function createRuntimeSlotItem(
  definitionId: string,
  ignoreStock: boolean,
): SimulationDeviceRuntimeSlotItemReadModel {
  const definition = getDefinition(definitionId);
  const declaration = definition.inspectors.find(
    (inspector) => inspector.type === INSPECTOR_TYPE.slotConfig,
  );
  if (declaration?.type !== INSPECTOR_TYPE.slotConfig) {
    throw new Error(`Definition ${definitionId} has no slot config inspector.`);
  }
  const storageGroupId = declaration.slotGroupIds[0];
  const storageGroup = definition.storageSlotGroups.find(
    (candidate) => candidate.id === storageGroupId,
  );
  const slot = storageGroup?.slots[0];
  if (storageGroupId === undefined || slot === undefined) {
    throw new Error(`Definition ${definitionId} has no declared slot config slot.`);
  }
  return {
    storageGroupId,
    slotId: slot.id,
    viewRole: "single-view",
    itemType: "item_copper_ore",
    count: 1,
    reserved: 0,
    ignoreStock,
  };
}

function getDefinition(definitionId: string): EntityDefinition {
  const definition = registry.entityDefinitions.find((candidate) => candidate.id === definitionId);
  if (definition === undefined) {
    throw new Error(`Definition ${definitionId} does not exist.`);
  }
  return definition;
}

function createExpectedProblem(message: string, entityId: string) {
  return {
    message,
    severity: "warning",
    tooltip: message,
    entityId,
  };
}
