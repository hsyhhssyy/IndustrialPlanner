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

  it("单基地模式允许取货口通过仓库链接无限提供矿物", () => {
    const allowedResourcesByDefinition = {
      unloader_1: [
        "item_copper_ore",
        "item_iron_ore",
        "item_originium_ore",
        "item_quartz_sand",
      ],
      // AI-REMOVED 2026-08-19:
      // Reason: 两类采集泵不再拥有 warehouseItemLink inspector，真实自然资源改由手选配方生产。
      // Trigger: 新版泵彻底退出仓库代理模式。
      // Evidence: Registry 契约测试已断言两类泵无 warehouse-item-link inspector。
      // Replacement: recipe-channel-definition.test.ts + resource-pump-production.test.ts
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // gas_pump_1: ["item_gas_inert", "item_gas_xiranite"],
      // water_pump_1: ["item_liquid_acid", "item_liquid_water"],
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
      createWarehouseInfiniteEntry("invalid-hub", "sp_hub_1", "item_copper_ore"),
      // AI-REMOVED 2026-08-19:
      // Reason: 新版泵没有可用于构造仓库链接的 inspector。
      // Trigger: 泵改为真实配方生产。
      // Evidence: createWarehouseInfiniteEntry 会拒绝没有 warehouse-item-link inspector 的设备。
      // Replacement: schema 5 迁移测试覆盖旧泵非法物品替换。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // createWarehouseInfiniteEntry("invalid-gas-pump", "gas_pump_1", "item_liquid_acid"),
      // createWarehouseInfiniteEntry("invalid-water-pump", "water_pump_1", "item_gas_inert"),
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
      createWarehouseInfiniteEntry("multi-hub", "sp_hub_1", "item_copper_ore"),
      // AI-REMOVED 2026-08-19:
      // Reason: 新版泵不再参与多基地仓库出口分类。
      // Trigger: 泵移除 warehouseItemLink inspector。
      // Evidence: 多基地与单基地均由相同泵配方生产，不再读取仓库源槽。
      // Replacement: 真实泵仿真回归。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // createWarehouseInfiniteEntry("multi-gas-pump", "gas_pump_1", "item_liquid_water"),
      // createWarehouseInfiniteEntry("multi-water-pump", "water_pump_1", "item_gas_inert"),
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
    const waterPump = createEntity("runtime-water-pump", "water_pump_1");
    const runtimeSlotItemsByEntityId = new Map([
      [runtimeEntity.id, [createRuntimeSlotItem("storager_1", true)]],
      [finiteEntity.id, [createRuntimeSlotItem("storager_1", false)]],
      [waterPump.id, [createRuntimeSlotItem("water_pump_1", true)]],
    ]);
    const entities = [configuredEntity, runtimeEntity, finiteEntity, waterPump];
    const runtimeInfiniteStorageEntityIds = collectRuntimeInfiniteStorageEntityIds({
      entities,
      entityDefinitions: registry.entityDefinitions,
      runtimeSlotItemsByEntityId,
    });

    expect([...runtimeInfiniteStorageEntityIds]).toEqual(["runtime-storage", "runtime-water-pump"]);
    expect(collectProblems({
      entities,
      runtimeInfiniteStorageEntityIds,
    })).toEqual([
      createExpectedProblem("设置了不可能实现的无限资源", "configured-storage"),
      createExpectedProblem("设置了不可能实现的无限资源", "runtime-storage"),
      createExpectedProblem("设置了不可能实现的无限资源", "runtime-water-pump"),
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
