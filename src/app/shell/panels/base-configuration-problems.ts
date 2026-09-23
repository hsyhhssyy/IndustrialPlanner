import type {
  SlotLinkDefinition,
  WorldEntity,
} from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  INSPECTOR_TYPE,
  type InfiniteStorageInspectorDeclaration,
  type SlotConfigInspectorDeclaration,
  type WarehouseItemLinkInspectorDeclaration,
} from "@/domain/registry/types/entity-inspector";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import type {
  SimulationDeviceRuntimeSlotItemReadModel,
} from "@/domain/simulation/types/simulation-types";
import { readAdmissionRule } from "@/shared/registry/admission-rule";

const CHEAT_ITEM_PROBLEM = "使用了作弊物品";
const MISSING_INFINITE_RESOURCE_PROBLEM = "设置了不存在的无限资源";
const IMPOSSIBLE_INFINITE_RESOURCE_PROBLEM = "设置了不可能实现的无限资源";

/**
 * 游戏对管道准入口每分钟准入量的硬性上限。
 *
 * AI-CORRECTION 2026-09-23: 用户确认该值由游戏规定，超过它的限速不会生效。
 * Inspector 的可调上限仍是 120/分钟，这里只用于标记无效配置。
 */
const PIPE_ADMISSION_RATE_MAX_PER_MINUTE = 60;

// AI-REMOVED 2026-08-19:
// Reason: 两类资源泵不再声明 warehouseItemLink inspector，也不再允许以仓库链接配置无限资源。
// Trigger: 新版泵改为手选配方真实生产。
// Evidence: Registry 中 gas_pump_1/water_pump_1 的仓库链接 inspector 与 placementDefaults 已移除。
// Replacement: 泵的 recipeChannels.default；非法旧产物由 schema 5 迁移为作弊设备。
// Risk: Low
// Human Review: Required
//
// Original code:
// const GAS_PUMP_INFINITE_ITEM_IDS = new Set([
//   "item_gas_inert",
//   "item_gas_xiranite",
// ]);
// const WATER_PUMP_INFINITE_ITEM_IDS = new Set([
//   "item_liquid_acid",
//   "item_liquid_water",
// ]);

export interface BaseConfigurationProblem {
  readonly message: string;
  readonly severity: "warning";
  readonly tooltip: string;
  readonly entityId: string;
}

interface CollectBaseConfigurationProblemsOptions {
  readonly entities: readonly WorldEntity[];
  readonly entityDefinitions: readonly EntityDefinition[];
  readonly itemDefinitions: readonly ItemDefinition[];
  readonly slotLinks: readonly SlotLinkDefinition[];
  readonly multiBaseEnabled: boolean;
  readonly runtimeInfiniteStorageEntityIds?: ReadonlySet<string>;
  readonly registryQueries: RegistryQuery;
}

interface CollectRuntimeInfiniteStorageEntityIdsOptions {
  readonly entities: readonly WorldEntity[];
  readonly entityDefinitions: readonly EntityDefinition[];
  readonly runtimeSlotItemsByEntityId: ReadonlyMap<
    string,
    readonly SimulationDeviceRuntimeSlotItemReadModel[]
  >;
}

interface StorageSlotRef {
  readonly storageGroupId: string;
  readonly storageGroupIndex: number;
  readonly slotId: string;
  readonly slotIndex: number;
  readonly defaultIgnoreStock: boolean;
}

export function collectBaseConfigurationProblems(
  options: CollectBaseConfigurationProblemsOptions,
): BaseConfigurationProblem[] {
  const problems: BaseConfigurationProblem[] = [];
  const definitionById = new Map(
    options.entityDefinitions.map((definition) => [definition.id, definition]),
  );
  const itemById = new Map(
    options.itemDefinitions.map((item) => [item.id, item]),
  );
  const warehouseItemIdBySourceSlot = buildWarehouseItemIdBySourceSlot(options.slotLinks);

  for (const entity of options.entities) {
    const definition = definitionById.get(entity.definitionId);
    if (definition?.uiGroup === "cheat") {
      problems.push(createWarning(CHEAT_ITEM_PROBLEM, entity.id));
    }
  }

  for (const entity of options.entities) {
    const definition = definitionById.get(entity.definitionId);
    if (
      definition !== undefined
      && hasInvalidWarehouseInfiniteResource({
        definition,
        entity,
        itemById,
        multiBaseEnabled: options.multiBaseEnabled,
        warehouseItemIdBySourceSlot,
      })
    ) {
      problems.push(createWarning(MISSING_INFINITE_RESOURCE_PROBLEM, entity.id));
    }
  }

  const runtimeInfiniteStorageEntityIds = options.runtimeInfiniteStorageEntityIds
    ?? new Set<string>();
  for (const entity of options.entities) {
    const definition = definitionById.get(entity.definitionId);
    if (
      definition !== undefined
      && (
        hasConfiguredInfiniteStorageSlot(definition, entity)
        || runtimeInfiniteStorageEntityIds.has(entity.id)
      )
    ) {
      problems.push(createWarning(IMPOSSIBLE_INFINITE_RESOURCE_PROBLEM, entity.id));
    }
  }

  for (const entity of options.entities) {
    const definition = definitionById.get(entity.definitionId);
    if (definition === undefined) continue;
    if (!isPipeAdmissionDefinition(definition.id, options.registryQueries)) continue;

    const exceededRate = resolveExceededAdmissionRate(definition, entity);
    if (exceededRate === null) continue;

    problems.push(createAdmissionRateProblem(exceededRate, entity.id));
  }

  return problems;
}

/** 管道准入口判定与 Inspector 保持同一口径：物流角色为准入口，且属于管道物流设备。 */
function isPipeAdmissionDefinition(definitionId: string, registryQueries: RegistryQuery): boolean {
  return registryQueries.resolveLogisticsRole(definitionId) === "admission"
    && registryQueries.isPipeLogistics(definitionId);
}

/** 返回该设备已配置的、超过游戏上限的最大每分钟准入速率；未超限时返回 null。 */
function resolveExceededAdmissionRate(
  definition: EntityDefinition,
  entity: WorldEntity,
): number | null {
  let exceeded: number | null = null;

  for (let groupIndex = 0; groupIndex < definition.portGroups.length; groupIndex += 1) {
    const group = definition.portGroups[groupIndex];
    if (group === undefined) continue;

    for (let portIndex = 0; portIndex < group.ports.length; portIndex += 1) {
      const rule = readAdmissionRule(
        entity.config[`portGroups[${groupIndex}].ports[${portIndex}].admissionRule`],
      );
      const rate = rule?.perMinuteLimit ?? null;
      if (rate === null || rate <= PIPE_ADMISSION_RATE_MAX_PER_MINUTE) continue;

      exceeded = exceeded === null ? rate : Math.max(exceeded, rate);
    }
  }

  return exceeded;
}

function createAdmissionRateProblem(rate: number, entityId: string): BaseConfigurationProblem {
  return {
    message: `管道准入口限速 ${rate}/分钟 超过 ${PIPE_ADMISSION_RATE_MAX_PER_MINUTE}/分钟`,
    severity: "warning",
    tooltip: `游戏内管道准入口的每分钟准入上限为 ${PIPE_ADMISSION_RATE_MAX_PER_MINUTE}，超过该值的配置不会生效，请把限速下调到 ${PIPE_ADMISSION_RATE_MAX_PER_MINUTE} 或以下。`,
    entityId,
  };
}

export function collectRuntimeInfiniteStorageEntityIds(
  options: CollectRuntimeInfiniteStorageEntityIdsOptions,
): ReadonlySet<string> {
  const result = new Set<string>();
  const definitionById = new Map(
    options.entityDefinitions.map((definition) => [definition.id, definition]),
  );

  for (const entity of options.entities) {
    const definition = definitionById.get(entity.definitionId);
    const runtimeSlotItems = options.runtimeSlotItemsByEntityId.get(entity.id);
    if (definition === undefined || runtimeSlotItems === undefined) {
      continue;
    }

    const genericSlotKeys = new Set(
      collectGenericSlotConfigRefs(definition).map(createStorageSlotKey),
    );
    if (runtimeSlotItems.some((slotItem) =>
      slotItem.ignoreStock
      && genericSlotKeys.has(createStorageSlotKey(slotItem)),
    )) {
      result.add(entity.id);
    }
  }

  return result;
}

function hasInvalidWarehouseInfiniteResource(options: {
  readonly definition: EntityDefinition;
  readonly entity: WorldEntity;
  readonly itemById: ReadonlyMap<string, ItemDefinition>;
  readonly multiBaseEnabled: boolean;
  readonly warehouseItemIdBySourceSlot: ReadonlyMap<string, string>;
}): boolean {
  for (const slotRef of collectWarehouseSlotRefs(options.definition)) {
    if (!readConfiguredIgnoreStock(options.entity, slotRef)) {
      continue;
    }

    if (options.multiBaseEnabled) {
      if (options.definition.id === "unloader_1") {
        return true;
      }
      continue;
    }

    const itemId = options.warehouseItemIdBySourceSlot.get(
      createWarehouseSourceSlotKey(
        options.entity.id,
        slotRef.storageGroupId,
        slotRef.slotId,
      ),
    ) ?? null;
    if (!isAllowedSingleBaseInfiniteResource(options.definition.id, itemId, options.itemById)) {
      return true;
    }
  }

  return false;
}

function isAllowedSingleBaseInfiniteResource(
  definitionId: string,
  itemId: string | null,
  itemById: ReadonlyMap<string, ItemDefinition>,
): boolean {
  if (itemId === null) {
    return false;
  }
  if (definitionId === "unloader_1") {
    const item = itemById.get(itemId);
    return item?.tags.includes("自然资源") === true
      && item.tags.includes("矿石");
  }
  // AI-REMOVED 2026-08-19:
  // Reason: 新版资源泵不再属于仓库无限资源白名单。
  // Trigger: 新版泵彻底移除 warehouseItemLink inspector。
  // Evidence: collectWarehouseSlotRefs 已无法从两类泵定义中得到任何仓库槽位。
  // Replacement: 泵的手选配方 channel。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // if (definitionId === "gas_pump_1") {
  //   return GAS_PUMP_INFINITE_ITEM_IDS.has(itemId);
  // }
  // if (definitionId === "water_pump_1") {
  //   return WATER_PUMP_INFINITE_ITEM_IDS.has(itemId);
  // }
  return false;
}

function hasConfiguredInfiniteStorageSlot(
  definition: EntityDefinition,
  entity: WorldEntity,
): boolean {
  return collectGenericSlotConfigRefs(definition).some((slotRef) =>
    readConfiguredIgnoreStock(entity, slotRef),
  );
}

function collectGenericSlotConfigRefs(definition: EntityDefinition): StorageSlotRef[] {
  const managedSlotKeys = new Set<string>();
  for (const slotRef of collectWarehouseSlotRefs(definition)) {
    managedSlotKeys.add(createStorageSlotKey(slotRef));
  }
  for (const inspector of definition.inspectors) {
    if (inspector.type !== INSPECTOR_TYPE.infiniteStorage) {
      continue;
    }
    for (const slotRef of collectDeclaredSlotRefs(definition, inspector)) {
      managedSlotKeys.add(createStorageSlotKey(slotRef));
    }
  }

  const genericSlotRefs = new Map<string, StorageSlotRef>();
  for (const inspector of definition.inspectors) {
    if (inspector.type !== INSPECTOR_TYPE.slotConfig) {
      continue;
    }
    for (const slotRef of collectDeclaredSlotRefs(definition, inspector)) {
      const slotKey = createStorageSlotKey(slotRef);
      if (!managedSlotKeys.has(slotKey)) {
        genericSlotRefs.set(slotKey, slotRef);
      }
    }
  }

  return [...genericSlotRefs.values()];
}

function collectWarehouseSlotRefs(definition: EntityDefinition): StorageSlotRef[] {
  const slotRefs = new Map<string, StorageSlotRef>();
  for (const inspector of definition.inspectors) {
    if (inspector.type !== INSPECTOR_TYPE.warehouseItemLink) {
      continue;
    }
    for (const slotRef of collectDeclaredSlotRefs(definition, inspector)) {
      slotRefs.set(createStorageSlotKey(slotRef), slotRef);
    }
  }
  return [...slotRefs.values()];
}

function collectDeclaredSlotRefs(
  definition: EntityDefinition,
  declaration:
    | InfiniteStorageInspectorDeclaration
    | SlotConfigInspectorDeclaration
    | WarehouseItemLinkInspectorDeclaration,
): StorageSlotRef[] {
  const result: StorageSlotRef[] = [];
  const explicitSlotIds = declaration.type === INSPECTOR_TYPE.warehouseItemLink
    ? new Set(declaration.slotIds ?? [])
    : null;

  for (const storageGroupId of declaration.slotGroupIds) {
    const storageGroupIndex = definition.storageSlotGroups.findIndex(
      (storageGroup) => storageGroup.id === storageGroupId,
    );
    if (storageGroupIndex < 0) {
      continue;
    }
    const storageGroup = definition.storageSlotGroups[storageGroupIndex];
    if (storageGroup === undefined) {
      continue;
    }

    for (let slotIndex = 0; slotIndex < storageGroup.slots.length; slotIndex += 1) {
      const slot = storageGroup.slots[slotIndex];
      if (
        slot === undefined
        || (explicitSlotIds !== null && explicitSlotIds.size > 0 && !explicitSlotIds.has(slot.id))
      ) {
        continue;
      }
      result.push({
        storageGroupId,
        storageGroupIndex,
        slotId: slot.id,
        slotIndex,
        defaultIgnoreStock: slot.ignoreStock,
      });
    }
  }

  return result;
}

function buildWarehouseItemIdBySourceSlot(
  slotLinks: readonly SlotLinkDefinition[],
): ReadonlyMap<string, string> {
  const itemIdBySourceSlot = new Map<string, string>();
  for (const slotLink of slotLinks) {
    if (slotLink.target.entityId !== "warehouse") {
      continue;
    }
    itemIdBySourceSlot.set(
      createWarehouseSourceSlotKey(
        slotLink.source.entityId,
        slotLink.source.storageSlotGroupId,
        slotLink.source.slotId,
      ),
      slotLink.target.slotId,
    );
  }
  return itemIdBySourceSlot;
}

function readConfiguredIgnoreStock(entity: WorldEntity, slotRef: StorageSlotRef): boolean {
  const path = `storageSlotGroups[${slotRef.storageGroupIndex}].slots[${slotRef.slotIndex}].ignoreStock`;
  const configuredValue = entity.config[path];
  return typeof configuredValue === "boolean"
    ? configuredValue
    : slotRef.defaultIgnoreStock;
}

function createWarning(message: string, entityId: string): BaseConfigurationProblem {
  return {
    message,
    severity: "warning",
    tooltip: message,
    entityId,
  };
}

function createStorageSlotKey(slot: {
  readonly storageGroupId: string;
  readonly slotId: string;
}): string {
  return `${slot.storageGroupId}\u0000${slot.slotId}`;
}

function createWarehouseSourceSlotKey(
  entityId: string,
  storageGroupId: string,
  slotId: string,
): string {
  return `${entityId}\u0000${createStorageSlotKey({ storageGroupId, slotId })}`;
}
