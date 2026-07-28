import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  CacheLinkEndpointDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import {
  AnyDomain,
  ItemDomainFlag,
} from "@/domain/shared/item-domain-flags";
import { LOGISTICS_KIND } from "@/domain/shared/logistics";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  isItemAvailableByActivity,
  isRecipeAvailableByActivity,
} from "@/shared/registry/activity-availability";
import {
  isCustomPortPriorityGroupsEnabled,
  normalizePortPriorityGroup,
  readPortPriorityGroupOverrides,
  resolvePortPriorityGroupOverrideKey,
} from "@/shared/port-priority-groups";
import { isAutomaticRecipeChannelMode } from "@/shared/recipe-channel-behavior";
import {
  WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE,
  WATER_PURIFIER_DEFAULT_OUTPUT_MODE,
  WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY,
  WATER_PURIFIER_NODE_ENTITY_ID,
  WATER_PURIFIER_OUTPUT_ITEM_ID,
  WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY,
  WATER_PURIFIER_OUTPUT_SLOT_ID,
  WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
} from "@/shared/water-purifier-node";

import { hashStable } from "./deterministic";
import { STANDARD_TICK_RATE_PER_SECOND } from "./tick-rate";
import type {
  CompiledSimulationDevice,
  CompiledSimulationItem,
  CompiledSimulationNode,
  CompiledSimulationPhysicalConnection,
  CompiledSimulationPort,
  CompiledSimulationRecipeDefinition,
  CompiledSimulationRecipeChannel,
  CompiledSimulationRoutingEntry,
  CompiledSimulationSlot,
  CompiledSimulationSlotLink,
  CompiledSimulationTopology,
  CompiledSimulationTransferEdge,
  CompiledTransportComponent,
  CompiledSimulationBlockageAutoClearance,
  CompiledSimulationWaterPurifierNodeConfig,
  SimulationAcceptRule,
  SimulationAdmissionRule,
  SimulationCompileDiagnostic,
  SimulationItemDomainFilter,
  SimulationNodeViewRole,
  SimulationPowerStatus,
  SimulationPortDirection,
  SimulationPortKind,
  SimulationTransportClass,
} from "./types";
import { compileRecipeDefinition } from "./types";

// 从 EntityDefinition 解构的子类型别名。
// 订正（2026-05-06）：domain 当前只导出 EntityDefinition 顶层类型，simulation 通过索引类型取子结构。
type PortGroupDefinition = EntityDefinition["portGroups"][number];
type PortDefinition = PortGroupDefinition["ports"][number];
type StorageSlotGroupDefinition = EntityDefinition["storageSlotGroups"][number];
type StorageSlotDefinition = StorageSlotGroupDefinition["slots"][number];
type PortStorageBindingDefinition = EntityDefinition["portStorageBindings"][number];
type RecipeChannelDefinition = EntityDefinition["recipeChannels"][number];

interface CompileOptions {
  readonly document: WorldDocument;
  readonly registry: RegistryContract;
  readonly poweredEntityIds: ReadonlySet<string>;
  readonly activeActivityIds?: readonly string[];
}

interface DeviceCompileResult {
  readonly device: CompiledSimulationDevice;
  readonly nodes: readonly CompiledSimulationNode[];
  readonly slots: readonly CompiledSimulationSlot[];
  readonly ports: readonly CompiledSimulationPort[];
  readonly links: readonly CompiledSimulationSlotLink[];
}

interface StorageGroupNodeBinding {
  readonly inputNodeIds: readonly string[];
  readonly outputNodeIds: readonly string[];
  readonly ingredientNodeIds: readonly string[];
  readonly productNodeIds: readonly string[];
}

const EDGE_ORDER: readonly GridEdge[] = ["NORTH", "EAST", "SOUTH", "WEST"];

export function createSimulationDocumentHash(document: WorldDocument): string {
  return hashStable({
    baseId: document.baseId,
    entities: document.entities,
    entityOrder: document.entityOrder,
    slotLinks: document.slotLinks,
  });
}

export function compileSimulationTopology(
  options: CompileOptions,
): CompiledSimulationTopology {
  const standardTickRate = STANDARD_TICK_RATE_PER_SECOND;
  const diagnostics: SimulationCompileDiagnostic[] = [];
  const entityDefinitionMap = new Map(
    options.registry.entityDefinitions.map((definition) => [definition.id, definition]),
  );
  const activeActivityIds = options.activeActivityIds ?? [];
  const itemCatalog = compileItemCatalog(options.registry, activeActivityIds);
  const recipeCatalog = compileRecipeCatalog(options.registry, activeActivityIds);
  const inactiveActivityItemIds = new Set(options.registry.itemDefinitions
    .filter((item) => !isItemAvailableByActivity(item, activeActivityIds))
    .map((item) => item.id));

  const deviceOrder: string[] = [];
  const nodeOrder: string[] = [];
  const slotOrder: string[] = [];
  const portOrder: string[] = [];
  const physicalConnectionOrder: string[] = [];
  const edgeOrder: string[] = [];
  const devices: Record<string, CompiledSimulationDevice> = {};
  const nodes: Record<string, CompiledSimulationNode> = {};
  const slots: Record<string, CompiledSimulationSlot> = {};
  const ports: Record<string, CompiledSimulationPort> = {};
  const links: Record<string, CompiledSimulationSlotLink> = {};
  const physicalConnections: Record<string, CompiledSimulationPhysicalConnection> = {};
  const transferEdges: Record<string, CompiledSimulationTransferEdge> = {};
  const edgeIdsByInputPortId: Record<string, string[]> = {};
  const edgeIdsByOutputPortId: Record<string, string[]> = {};

  addDeviceCompileResult({
    result: compileWarehouseDevice(options.document, itemCatalog),
    devices,
    nodes,
    slots,
    ports,
    links,
    deviceOrder,
    nodeOrder,
    slotOrder,
    portOrder,
  });

  for (const entityId of getOrderedEntityIds(options.document)) {
    const entity = options.document.entities[entityId];
    if (entity === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "missing-ordered-entity",
        message: `Document entityOrder references missing entity "${entityId}".`,
        entityId,
      });
      continue;
    }

    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      diagnostics.push({
        severity: "error",
        code: "missing-entity-definition",
        message: `Missing entity definition "${entity.definitionId}".`,
        entityId: entity.id,
        definitionId: entity.definitionId,
      });
      continue;
    }

    addDeviceCompileResult({
      result: compileEntityDevice({
        entity,
        definition,
        registryQueries: options.registry.queries,
        itemCatalog,
        recipeCatalog,
        inactiveActivityItemIds,
        baseId: options.document.baseId,
        poweredEntityIds: options.poweredEntityIds,
      }),
      devices,
      nodes,
      slots,
      ports,
      links,
      deviceOrder,
      nodeOrder,
      slotOrder,
      portOrder,
    });

    // AI-REMOVED 2026-06-09:
    // Reason: EntityDefinition.links 字段已从领域模型中移除，所有槽位链接统一存放于 document.slotLinks。
    // Trigger: 用户要求将设备级链接与文档级链接合并为单一数据源。
    // Evidence: compileDefinitionSlotLinks 仅消费 EntityDefinition.links（已删除），无其他数据来源。
    // Replacement: compileDocumentSlotLinks 统一处理所有 slotLinks。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // for (const link of compileDefinitionSlotLinks({
    //   definition,
    //   entityConfig: entity.config,
    //   compiledEntityId: `device:${entity.id}`,
    //   compiledDevice: devices[`device:${entity.id}`],
    //   compiledSlots: slots,
    //   compiledNodes: nodes,
    //   baseId: options.document.baseId,
    // })) {
    //   links[link.id] = link;
    // }
  }

  for (const link of compileDocumentSlotLinks({
    document: options.document,
    devices,
    nodes,
    slots,
  })) {
    links[link.id] = link;
  }

  for (const connection of compilePhysicalConnections(
    portOrder.map((portId) => ports[portId]),
    devices,
    (definitionId) => options.registry.queries.isGeneralLogisticsDevice(definitionId),
  )) {
    physicalConnections[connection.id] = connection;
    physicalConnectionOrder.push(connection.id);

    const sourcePort = ports[connection.sourcePortId];
    const targetPort = ports[connection.targetPortId];
    if (sourcePort === undefined || targetPort === undefined) {
      continue;
    }

    for (const sourceNodeId of sourcePort.boundNodeIds) {
      for (const targetNodeId of targetPort.boundNodeIds) {
        const acceptRule = intersectAcceptRules(
          sourcePort.acceptRule,
          targetPort.acceptRule,
          itemCatalog,
        );
        if (acceptRule === null) {
          diagnostics.push({
            severity: "info",
            code: "empty-edge-accept-rule",
            message: `Connection "${connection.id}" has no accepted item domain overlap.`,
          });
          continue;
        }

        const edge: CompiledSimulationTransferEdge = {
          id: ["edge", sourceNodeId, targetNodeId, connection.id].join(":"),
          physicalConnectionId: connection.id,
          sourcePortId: sourcePort.id,
          targetPortId: targetPort.id,
          sourceNodeId,
          targetNodeId,
          acceptRule,
        };
        transferEdges[edge.id] = edge;
        edgeOrder.push(edge.id);
        (edgeIdsByOutputPortId[edge.sourcePortId] ??= []).push(edge.id);
        (edgeIdsByInputPortId[edge.targetPortId] ??= []).push(edge.id);
      }
    }
  }

  const { transportComponents, transportComponentIdByDeviceId } = compileTransportComponents(
    devices,
    physicalConnections,
    ports,
    nodes,
  );

  // Patch transportComponentId onto each device.
  for (const [deviceId, componentId] of transportComponentIdByDeviceId) {
    const device = devices[deviceId];
    if (device !== undefined) {
      (devices as Record<string, CompiledSimulationDevice>)[deviceId] = {
        ...device,
        transportComponentId: componentId,
      };
    }
  }

  const registryHash = hashStable({
    entities: options.registry.entityDefinitions,
    items: options.registry.itemDefinitions,
    recipes: options.registry.recipeDefinitions,
  });
  const documentHash = createSimulationDocumentHash(options.document);
  const totalPowerDemand = computeTotalPowerDemand(devices);
  const deviceOrderIndexById = Object.fromEntries(
    deviceOrder.map((deviceId, index) => [deviceId, index]),
  );
  const topologyHashInput = {
    documentHash,
    registryHash,
    standardTickRate,
    totalPowerDemand,
    itemCatalog,
    recipeCatalog,
    devices,
    nodes,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
    edgeIdsByInputPortId,
    edgeIdsByOutputPortId,
    deviceOrderIndexById,
    ordering: {
      deviceOrder,
      nodeOrder,
      slotOrder,
      portOrder,
      physicalConnectionOrder,
      edgeOrder,
    },
    transportComponents,
  };

  return {
    schemaVersion: 4,
    topologyId: hashStable(topologyHashInput),
    documentKey: options.document.documentKey,
    documentHash,
    registryHash,
    standardTickRate,
    totalPowerDemand,
    itemCatalog,
    recipeCatalog,
    devices,
    nodes,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
    edgeIdsByInputPortId,
    edgeIdsByOutputPortId,
    deviceOrderIndexById,
    ordering: {
      deviceOrder,
      nodeOrder,
      slotOrder,
      portOrder,
      physicalConnectionOrder,
      edgeOrder,
    },
    transportComponents,
    diagnostics,
  };
}

function addDeviceCompileResult(options: {
  readonly result: DeviceCompileResult;
  readonly devices: Record<string, CompiledSimulationDevice>;
  readonly nodes: Record<string, CompiledSimulationNode>;
  readonly slots: Record<string, CompiledSimulationSlot>;
  readonly ports: Record<string, CompiledSimulationPort>;
  readonly links: Record<string, CompiledSimulationSlotLink>;
  readonly deviceOrder: string[];
  readonly nodeOrder: string[];
  readonly slotOrder: string[];
  readonly portOrder: string[];
}): void {
  options.devices[options.result.device.id] = options.result.device;
  options.deviceOrder.push(options.result.device.id);

  for (const node of options.result.nodes) {
    options.nodes[node.id] = node;
    options.nodeOrder.push(node.id);
  }

  for (const slot of options.result.slots) {
    options.slots[slot.id] = slot;
    options.slotOrder.push(slot.id);
  }

  for (const port of options.result.ports) {
    options.ports[port.id] = port;
    options.portOrder.push(port.id);
  }

  for (const link of options.result.links) {
    options.links[link.id] = link;
  }
}

function compileItemCatalog(
  registry: RegistryContract,
  activeActivityIds: readonly string[],
): Record<string, CompiledSimulationItem> {
  const catalog: Record<string, CompiledSimulationItem> = {};

  for (const item of [...registry.itemDefinitions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!isItemAvailableByActivity(item, activeActivityIds)) {
      continue;
    }

    catalog[item.id] = {
      id: item.id,
      domain: registry.queries.resolveItemDomain(item.id),
      tags: [...item.tags].sort(),
    };
  }

  return catalog;
}

function compileRecipeCatalog(
  registry: RegistryContract,
  activeActivityIds: readonly string[],
): Record<string, CompiledSimulationRecipeDefinition> {
  const catalog: Record<string, CompiledSimulationRecipeDefinition> = {};
  for (const recipe of [...registry.recipeDefinitions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!isRecipeAvailableByActivity(recipe, activeActivityIds)) {
      continue;
    }

    catalog[recipe.id] = compileRecipeDefinition(recipe, convertSecondsToSimulationTicks(recipe.durationSeconds));
  }
  return catalog;
}

function computeTotalPowerDemand(
  devices: Readonly<Record<string, CompiledSimulationDevice>>,
): number {
  return Object.values(devices).reduce((total, device) =>
    device.powerStatus === "in-power-range" ? total + device.powerDemand : total,
  0);
}

function compileWarehouseDevice(
  document: WorldDocument,
  itemCatalog: Record<string, CompiledSimulationItem>,
): DeviceCompileResult {
  const deviceId = `device:warehouse:${document.baseId}`;
  const nodeId = `${deviceId}/node:warehouse`;
  const slots: CompiledSimulationSlot[] = Object.keys(itemCatalog).sort().map((itemId) => ({
    id: `${nodeId}/slot:${itemId}`,
    nodeId,
    sourceStorageSlotGroupId: "warehouse",
    sourceSlotId: itemId,
    capacity: Number.MAX_SAFE_INTEGER,
    domain: itemCatalog[itemId]?.domain ?? AnyDomain,
    lock: itemId,
    initialItemType: itemId,
    initialCount: 0,
    ignoreStock: false,
    // AI-REMOVED 2026-06-06:
    // Reason: CompiledSimulationSlot 不再持有 submitMode；隐藏仓库槽不参与全局提交机制。
    // Trigger: 用户要求 submit mode 机制彻底删除，避免旧蓝图配置被运行时误消费。
    // Evidence: RUN_ID 20260606-041337-509040 中 submitMode 全局扫描清空目标存储箱。
    // Replacement: WarehouseSink 动态写入仓库槽。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // submitMode: "never" as const,
    // submitIntervalTicks: null,
  }));
  const node: CompiledSimulationNode = {
    id: nodeId,
    deviceId,
    sourceStorageSlotGroupId: "warehouse",
    slotIds: slots.map((slot) => slot.id),
    inputPortIds: [],
    outputPortIds: [],
    viewRole: "input-view",
    groupOrder: 0,
  };

  return {
    device: {
      id: deviceId,
      sourceEntityId: null,
      definitionId: "warehouse",
      position: null,
      rotation: null,
      footprint: null,
      tags: ["warehouse"],
      powerStatus: "no-power-needed",
      powerDemand: 0,
      requiresPower: false,
      logisticsKind: null,
      transportClass: "anchor",
      transportComponentId: null,
      nodeIds: [nodeId],
      recipeChannels: [],
      consumptionChannelCount: 0,
      allowDuplicateRecipesAcrossChannels: false,
      portIds: [],
      routing: {},
      configHash: hashStable({ baseId: document.baseId, itemIds: Object.keys(itemCatalog).sort() }),
      isProducer: false,
      blockageAutoClearance: null,
      waterPurifierNode: null,
    },
    nodes: [node],
    slots,
    ports: [],
    links: [],
  };
}

function resolvePowerDemand(definition: EntityDefinition): number {
  return Number.isFinite(definition.powerDemand)
    ? Math.max(0, definition.powerDemand)
    : 0;
}

function resolvePowerStatus(options: {
  readonly entityId: string;
  readonly powerDemand: number;
  readonly poweredEntityIds: ReadonlySet<string>;
}): SimulationPowerStatus {
  if (options.powerDemand === 0) {
    return "no-power-needed";
  }

  return options.poweredEntityIds.has(options.entityId)
    ? "in-power-range"
    : "out-of-power-range";
}

function compileEntityDevice(options: {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly registryQueries: RegistryContract["queries"];
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly recipeCatalog: Record<string, CompiledSimulationRecipeDefinition>;
  readonly inactiveActivityItemIds: ReadonlySet<string>;
  readonly baseId: string;
  readonly poweredEntityIds: ReadonlySet<string>;
}): DeviceCompileResult {
  const deviceId = `device:${options.entity.id}`;
  const definition = applyPortPriorityGroupConfig(
    mergeEntityDefinitionConfig(options.definition, options.entity.config),
    options.entity.config,
  );
  const transportClass = resolveTransportClass(options.registryQueries, definition);
  const logisticsKind = options.registryQueries.isBeltFamily(definition.id)
    ? LOGISTICS_KIND.belt
    : options.registryQueries.isPipeFamily(definition.id)
      ? LOGISTICS_KIND.pipe
      : null;
  const powerDemand = resolvePowerDemand(definition);
  const powerStatus = resolvePowerStatus({
    entityId: options.entity.id,
    powerDemand,
    poweredEntityIds: options.poweredEntityIds,
  });
  const nodes: CompiledSimulationNode[] = [];
  const slots: CompiledSimulationSlot[] = [];
  const ports: CompiledSimulationPort[] = [];
  const links: CompiledSimulationSlotLink[] = [];
  const nodeBindingsByStorageGroupId = new Map<string, StorageGroupNodeBinding>();

  compileStorageSlotGroups({
    deviceId,
    definition,
    nodes,
    slots,
    links,
    nodeBindingsByStorageGroupId,
    itemCatalog: options.itemCatalog,
  });
  compileSyntheticNodesForUnboundPorts({
    deviceId,
    definition,
    isPipeFamily: logisticsKind === LOGISTICS_KIND.pipe,
    nodes,
    slots,
    nodeBindingsByStorageGroupId,
  });
  compilePorts({
    deviceId,
    entity: options.entity,
    definition,
    nodeBindingsByStorageGroupId,
    itemCatalog: options.itemCatalog,
    ports,
    inactiveActivityItemIds: options.inactiveActivityItemIds,
  });

  const nodesWithPorts = attachPortsToNodes(nodes, ports);
  nodes.splice(0, nodes.length, ...nodesWithPorts);

  const recipeChannels = compileRecipeChannels(
    definition.recipeChannels,
    definition.recipeChannelBehavior,
    nodeBindingsByStorageGroupId,
    options.entity,
    options.recipeCatalog,
  );
  const consumptionChannelCount = recipeChannels.findIndex(
    (channel) => channel.type !== "consumption-channel",
  );
  const device: CompiledSimulationDevice = {
    id: deviceId,
    sourceEntityId: options.entity.id,
    definitionId: definition.id,
    position: { ...options.entity.position },
    rotation: options.entity.rotation,
    footprint: { ...definition.footprint },
    tags: [...definition.tags].sort(),
    powerStatus,
    powerDemand,
    requiresPower: definition.requiresPower,
    logisticsKind,
    transportClass,
    transportComponentId: null,
    nodeIds: nodes.map((node) => node.id),
    recipeChannels,
    consumptionChannelCount: consumptionChannelCount < 0
      ? recipeChannels.length
      : consumptionChannelCount,
    allowDuplicateRecipesAcrossChannels:
      definition.recipeChannelBehavior?.allowDuplicateRecipesAcrossChannels ?? false,
    portIds: ports.map((port) => port.id),
    routing: compileRouting(definition),
    configHash: hashStable({
      entity: options.entity,
      definition,
    }),
    isProducer: definition.tags.includes("Producer"),
    blockageAutoClearance: compileBlockageAutoClearance(definition, options.entity.config),
    waterPurifierNode: compileWaterPurifierNode(definition.id, options.entity.config),
  };

  return {
    device,
    nodes,
    slots,
    ports,
    links,
  };
}

// AI-REMOVED 2026-07-23:
// Reason: 固定窗口计量配置不再参与拓扑编译。
// Trigger: 用户要求真实槽位与十秒 consumption-channel 配方。
// Evidence: compileRecipeChannels 已编译频道用途和直接节点引用。
// Replacement: compileRecipeChannels + consumptionChannelCount。
// Risk: Medium
// Human Review: Required
//
// Original code:
// function compileMeteredConsumption(...) { ... }

function compileStorageSlotGroups(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly nodes: CompiledSimulationNode[];
  readonly slots: CompiledSimulationSlot[];
  readonly links: CompiledSimulationSlotLink[];
  readonly nodeBindingsByStorageGroupId: Map<string, StorageGroupNodeBinding>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
}): void {
  options.definition.storageSlotGroups.forEach((storageGroup, groupIndex) => {
    const portDirections = resolveStorageGroupPortDirections(options.definition, storageGroup.id);
    const nodeSet = compileStorageNodeSet({
      deviceId: options.deviceId,
      storageGroup,
      slots: storageGroup.slots,
      slotStartIndex: 0,
      baseNodeId: `${options.deviceId}/node:${storageGroup.id}`,
      groupOrder: groupIndex,
      hasInputBinding: portDirections.hasInput,
      hasOutputBinding: portDirections.hasOutput,
      nodes: options.nodes,
      compiledSlots: options.slots,
      links: options.links,
      itemCatalog: options.itemCatalog,
    });
    options.nodeBindingsByStorageGroupId.set(storageGroup.id, nodeSet);
  });
}

function compileStorageNodeSet(options: {
  readonly deviceId: string;
  readonly storageGroup: StorageSlotGroupDefinition;
  readonly slots: readonly StorageSlotDefinition[];
  readonly slotStartIndex: number;
  readonly baseNodeId: string;
  readonly groupOrder: number;
  readonly hasInputBinding: boolean;
  readonly hasOutputBinding: boolean;
  readonly nodes: CompiledSimulationNode[];
  readonly compiledSlots: CompiledSimulationSlot[];
  readonly links: CompiledSimulationSlotLink[];
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
}): StorageGroupNodeBinding {
  if (options.hasInputBinding && options.hasOutputBinding) {
    const linkType = options.storageGroup.splitLinkType ?? "share-all";
    const inputNodeId = `${options.baseNodeId}.input-view`;
    const outputNodeId = `${options.baseNodeId}.output-view`;
    const inputSlotIds: string[] = [];
    const outputSlotIds: string[] = [];
    const targetSlotIdBySourceSlotId: Record<string, string> = {};

    options.slots.forEach((slot, slotOffset) => {
      const slotIndex = options.slotStartIndex + slotOffset;
      const inputSlot = compileSlot({
        slot,
        slotIndex,
        nodeId: inputNodeId,
        storageGroup: options.storageGroup,
        slotIdSuffix: ".in-view",
        initialItemType: null,
        initialCount: 0,
        itemCatalog: options.itemCatalog,
      });
      const outputSlot = compileSlot({
        slot,
        slotIndex,
        nodeId: outputNodeId,
        storageGroup: options.storageGroup,
        slotIdSuffix: ".out-view",
        itemCatalog: options.itemCatalog,
      });
      options.compiledSlots.push(inputSlot, outputSlot);
      inputSlotIds.push(inputSlot.id);
      outputSlotIds.push(outputSlot.id);
      targetSlotIdBySourceSlotId[inputSlot.id] = outputSlot.id;
    });

    options.nodes.push(createCompiledNode({
      id: inputNodeId,
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: options.storageGroup.id,
      slotIds: inputSlotIds,
      groupOrder: options.groupOrder,
      viewRole: "input-view",
    }));
    options.nodes.push(createCompiledNode({
      id: outputNodeId,
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: options.storageGroup.id,
      slotIds: outputSlotIds,
      groupOrder: options.groupOrder + 0.5,
      viewRole: "output-view",
    }));
    options.links.push({
      id: ["link", options.deviceId, options.storageGroup.id, "input-view-to-output-view"].join(":"),
      linkType: linkType,
      sourceSlotIds: inputSlotIds,
      targetSlotIds: outputSlotIds,
      targetSlotIdBySourceSlotId,
    });

    return createSplitStorageGroupNodeBinding({
      inputNodeId,
      outputNodeId,
    });
  }

  const nodeId = options.baseNodeId;
  const slotIds: string[] = [];
  options.slots.forEach((slot, slotOffset) => {
    const compiledSlot = compileSlot({
      slot,
      slotIndex: options.slotStartIndex + slotOffset,
      nodeId,
      storageGroup: options.storageGroup,
      itemCatalog: options.itemCatalog,
    });
    options.compiledSlots.push(compiledSlot);
    slotIds.push(compiledSlot.id);
  });
  // AI-CORRECTION 2026-05-13: viewRole 现在纯粹由端口绑定方向决定，不需要 slotType。
  const viewRole: SimulationNodeViewRole = options.hasInputBinding ? "input-view"
    : options.hasOutputBinding ? "output-view"
    : "input-view";
  options.nodes.push(createCompiledNode({
    id: nodeId,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.storageGroup.id,
    slotIds,
    groupOrder: options.groupOrder,
    viewRole,
  }));

  return {
    inputNodeIds: options.hasInputBinding ? [nodeId] : [],
    outputNodeIds: options.hasOutputBinding ? [nodeId] : [],
    // AI-REMOVED 2026-06-06:
    // Reason: Recipe Channel 的 ingredient/product 角色不应被端口方向过滤；单节点存储组应按 channel 声明角色参与配方。
    // Trigger: 用户要求按《仿真运行原理》恢复“配方原料/产物由 Recipe Channel 决定”的原始设计。
    // Evidence: .docs/common/模拟器/仿真运行原理.md §3.5 明确 channel 的 ingredient/product 与端口 input/output 正交，互不约束。
    // Replacement: 下方 ingredientNodeIds/productNodeIds 均指向该单节点；端口物流能力仍由 inputNodeIds/outputNodeIds 保持。
    // Risk: Medium - 依赖旧端口过滤兜底的错误 channel 定义必须先修正；当前已修正粉碎机/填充器/液体填充器。
    // Human Review: Required
    //
    // Original code:
    // ingredientNodeIds: options.hasInputBinding ? [nodeId] : [],
    // productNodeIds: options.hasOutputBinding ? [nodeId] : [],
    ingredientNodeIds: [nodeId],
    productNodeIds: [nodeId],
  };
}

// AI-REMOVED 2026-05-13: resolveSplitStorageViewConfig
// Reason: slotType no longer exists; split linkType is now read directly from storageGroup.splitLinkType.
// Trigger: Recipe Channel 重构
// Replacement: storageGroup.splitLinkType ?? "share-all"
// Risk: Low

// AI-REMOVED 2026-05-13: resolveSingleStorageNodeViewRole
// Reason: viewRole is now purely determined by port binding direction, not slotType.
// Trigger: Recipe Channel 重构
// Replacement: hasInputBinding ? "input-view" : hasOutputBinding ? "output-view" : "input-view"
// Risk: Low

function createSplitStorageGroupNodeBinding(options: {
  readonly inputNodeId: string;
  readonly outputNodeId: string;
}): StorageGroupNodeBinding {
  // AI-CORRECTION 2026-05-13: ingredientNodeIds/productNodeIds 现在由 Recipe Channel 编译决定。
  // 展开后的 input-view 始终标记为 ingredient，output-view 始终标记为 product。
  return {
    inputNodeIds: [options.inputNodeId],
    outputNodeIds: [options.outputNodeId],
    ingredientNodeIds: [options.inputNodeId],
    productNodeIds: [options.outputNodeId],
  };
}

// AI-REMOVED 2026-05-13: isIngredientSlotType / isProductSlotType
// Reason: SimulationSlotType no longer exists.
// Trigger: Recipe Channel 重构, slotType field removed.
// Replacement: ingredientNodeIds/productNodeIds now come from Recipe Channel compilation.
// Risk: Low

function createCompiledNode(options: {
  readonly id: string;
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string | null;
  readonly slotIds: readonly string[];
  readonly groupOrder: number;
  readonly viewRole: SimulationNodeViewRole;
}): CompiledSimulationNode {
  // AI-CORRECTION 2026-05-13: slotType 字段已从 CompiledSimulationNode 删除。
  return {
    id: options.id,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.sourceStorageSlotGroupId,
    viewRole: options.viewRole,
    slotIds: options.slotIds,
    inputPortIds: [],
    outputPortIds: [],
    groupOrder: options.groupOrder,
  };
}

function compileSyntheticNodesForUnboundPorts(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  /** 管道设备族使用容量 2；管道物流设备不包括管道节，但两者都属于该族。 */
  readonly isPipeFamily: boolean;
  readonly nodes: CompiledSimulationNode[];
  readonly slots: CompiledSimulationSlot[];
  readonly nodeBindingsByStorageGroupId: Map<string, StorageGroupNodeBinding>;
}): void {
  const boundPortGroupIds = new Set(options.definition.portStorageBindings.map((binding) => binding.portGroupId));
  const needsInput = options.definition.portGroups.some((portGroup) =>
    !boundPortGroupIds.has(portGroup.id)
    && (portGroup.direction === "input" || portGroup.direction === "bidirectional"),
  );
  const needsOutput = options.definition.portGroups.some((portGroup) =>
    !boundPortGroupIds.has(portGroup.id)
    && (portGroup.direction === "output" || portGroup.direction === "bidirectional"),
  );
  // AI-CORRECTION 2026-07-27: 管道设备族由 RegistryQuery 编译结果判定，不再依赖 PipeFamily tag。
  const syntheticSlotCapacity = options.isPipeFamily ? 2 : 1;

  if (needsInput) {
    addSyntheticNode({
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: "synthetic-input",
      groupOrder: options.nodes.length,
      nodes: options.nodes,
      slots: options.slots,
      nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
      domain: inferStorageDomainFromPortGroups(options.definition.portGroups, "input"),
      bindDirection: "input",
      capacity: syntheticSlotCapacity,
    });
  }

  if (needsOutput) {
    addSyntheticNode({
      deviceId: options.deviceId,
      sourceStorageSlotGroupId: "synthetic-output",
      groupOrder: options.nodes.length,
      nodes: options.nodes,
      slots: options.slots,
      nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
      domain: inferStorageDomainFromPortGroups(options.definition.portGroups, "output"),
      bindDirection: "output",
      capacity: syntheticSlotCapacity,
    });
  }
}

function addSyntheticNode(options: {
  readonly deviceId: string;
  readonly sourceStorageSlotGroupId: string;
  readonly groupOrder: number;
  readonly nodes: CompiledSimulationNode[];
  readonly slots: CompiledSimulationSlot[];
  readonly nodeBindingsByStorageGroupId: Map<string, StorageGroupNodeBinding>;
  readonly domain: SimulationItemDomainFilter;
  readonly bindDirection: SimulationPortDirection;
  readonly capacity: number;
}): void {
  const nodeId = `${options.deviceId}/node:${options.sourceStorageSlotGroupId}`;
  const slotId = `${nodeId}/slot:slot_1`;
  // AI-CORRECTION 2026-05-13: slotType removed. ingredientNodeIds/productNodeIds now determined by Recipe Channel.
  options.nodes.push(createCompiledNode({
    id: nodeId,
    deviceId: options.deviceId,
    sourceStorageSlotGroupId: options.sourceStorageSlotGroupId,
    slotIds: [slotId],
    groupOrder: options.groupOrder,
    viewRole: options.bindDirection === "input" ? "input-view" : "output-view",
  }));
  options.slots.push({
    id: slotId,
    nodeId,
    sourceStorageSlotGroupId: options.sourceStorageSlotGroupId,
    sourceSlotId: "slot_1",
    capacity: options.capacity,
    domain: options.domain,
    lock: null,
    initialItemType: null,
    initialCount: 0,
    ignoreStock: false,
    // AI-REMOVED 2026-06-06:
    // Reason: Synthetic slot 不再编译 submitMode；入仓语义由设备标签和目标节点决定。
    // Trigger: submit mode 机制彻底删除。
    // Evidence: REQ-087 方案要求仓库存货口使用动态 warehouse sink，不使用 tick 末尾 submit。
    // Replacement: runtime-slot-access.findInputSlotForItem 动态返回仓库目标槽。
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // submitMode: "never",
    // submitIntervalTicks: null,
  });
  options.nodeBindingsByStorageGroupId.set(options.sourceStorageSlotGroupId, {
    inputNodeIds: options.bindDirection === "input" ? [nodeId] : [],
    outputNodeIds: options.bindDirection === "output" ? [nodeId] : [],
    // AI-REMOVED 2026-06-06:
    // Reason: synthetic 缓存组的配方角色也应由 Recipe Channel 引用决定，而不是由未绑定端口方向过滤。
    // Trigger: 用户要求按《仿真运行原理》恢复“配方原料/产物由 Recipe Channel 决定”的原始设计。
    // Evidence: .docs/common/模拟器/仿真运行原理.md §3.5：若某存储组只绑定单侧端口、未展开，则该 Node 按 channel 声明角色参与。
    // Replacement: 下方 ingredientNodeIds/productNodeIds 均指向 synthetic 单节点；端口物流能力仍由 inputNodeIds/outputNodeIds 保持。
    // Risk: Medium - 若 registry 中 synthetic channel 声明错误，将不再被端口方向兜底隐藏。
    // Human Review: Required
    //
    // Original code:
    // ingredientNodeIds: options.bindDirection === "input" ? [nodeId] : [],
    // productNodeIds: options.bindDirection === "output" ? [nodeId] : [],
    ingredientNodeIds: [nodeId],
    productNodeIds: [nodeId],
  });
}

// AI-REMOVED 2026-07-23:
// Reason: 所有 synthetic 槽位固定容量 1 会使严格管道的 2 件配方永远无法取得或放下 2 件。
// Trigger: 用户要求 PipeFamily 槽位容量上限统一为 2。
// Evidence: .docs/common/模拟器/仿真运行原理.md v5 §6.2；严格直管与弯管使用 synthetic-input/output。
// Replacement: compileSyntheticNodesForUnboundPorts 根据 PipeFamily 计算 syntheticSlotCapacity 并传入 addSyntheticNode。
// Risk: Low - 非 PipeFamily synthetic 槽位仍保持容量 1。
// Human Review: Required
//
// Original code:
// capacity: 1,

function compileSlot(options: {
  readonly slot: StorageSlotDefinition;
  readonly slotIndex: number;
  readonly nodeId: string;
  readonly storageGroup: StorageSlotGroupDefinition;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly slotIdSuffix?: string;
  readonly initialItemType?: string | null;
  readonly initialCount?: number;
}): CompiledSimulationSlot {
  // AI-REMOVED 2026-06-06:
  // Reason: slot.submitMode / submitIntervalSeconds 不再进入 CompiledSimulationSlot。
  // Trigger: 用户要求 submit mode 机制彻底删除；全局 submit 阶段已移除。
  // Evidence: RUN_ID 20260606-041337-509040 证明该机制会误消费旧蓝图中的 every-tick 配置。
  // Replacement: WarehouseSink 动态入仓；协议存储箱 r_warehouse_submit 配方提交。
  // Risk: Medium - domain 层旧配置仍存在但 simulation 忽略。
  // Human Review: Required
  //
  // Original code:
  // const submitMode = options.slot.submitMode;
  // const submitInterval = submitMode === "every-n-seconds"
  //   ? convertSecondsToSimulationTicks(options.slot.submitIntervalSeconds ?? 10)
  //   : null;
  const rawLock = options.slot.lock;
  const lock = rawLock !== null && options.itemCatalog[rawLock] !== undefined
    ? rawLock
    : null;
  const hasInitialItemTypeOverride = Object.prototype.hasOwnProperty.call(options, "initialItemType");
  const rawItemType = hasInitialItemTypeOverride
    ? options.initialItemType ?? null
    : options.slot.initialItemType ?? rawLock;
  const itemType = rawItemType !== null && options.itemCatalog[rawItemType] !== undefined
    ? rawItemType
    : null;
  const initialCount = itemType === null
    ? 0
    : options.initialCount ?? options.slot.initialCount;
  const configuredItemBecameUnavailable = rawItemType !== null && itemType === null;

  return {
    id: `${options.nodeId}/slot:${options.slot.id}${options.slotIdSuffix ?? ""}`,
    nodeId: options.nodeId,
    sourceStorageSlotGroupId: options.storageGroup.id,
    sourceSlotId: options.slot.id,
    capacity: options.slot.capacity,
    domain: resolveSlotDomain(options.storageGroup, options.slot),
    lock,
    initialItemType: itemType,
    initialCount,
    ignoreStock: configuredItemBecameUnavailable ? false : options.slot.ignoreStock,
    // AI-REMOVED 2026-06-06:
    // Reason: submitMode 字段从 active compiled slot shape 删除。
    // Trigger: 用户要求 submit mode 机制彻底删除。
    // Evidence: REQ-087 已指定入仓由动态 sink 或配方交货承担。
    // Replacement: WarehouseSink tag + r_warehouse_submit recipe.
    // Risk: Low
    // Human Review: Required
    //
    // Original code:
    // submitMode,
    // submitIntervalTicks: submitInterval,
  };
}

function compilePorts(options: {
  readonly deviceId: string;
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly ports: CompiledSimulationPort[];
  readonly inactiveActivityItemIds: ReadonlySet<string>;
}): void {
  const bindingByPortGroupId = new Map<string, PortStorageBindingDefinition[]>();
  for (const binding of options.definition.portStorageBindings) {
    const bindings = bindingByPortGroupId.get(binding.portGroupId) ?? [];
    bindings.push(binding);
    bindingByPortGroupId.set(binding.portGroupId, bindings);
  }

  let order = 0;
  for (const portGroup of options.definition.portGroups) {
    for (const direction of resolvePortGroupDirections(portGroup.direction)) {
      for (const port of portGroup.ports) {
        const localCell = rotateLocalPortCell({
          footprint: options.definition.footprint,
          port,
          rotation: options.entity.rotation,
        });
        const edge = rotateGridEdge(port.edge, options.entity.rotation);
        const insideGridPoint = {
          x: options.entity.position.x + localCell.x,
          y: options.entity.position.y + localCell.y,
        };
        const delta = resolveEdgeDelta(edge);
        const outsideGridPoint = {
          x: insideGridPoint.x + delta.x,
          y: insideGridPoint.y + delta.y,
        };
        const portId = [
          options.deviceId,
          `port:${portGroup.id}.${port.id}.${direction}`,
        ].join("/");
        const portAcceptRule = readPortAcceptRule(port);
        const fallbackAcceptRule = portAcceptRule.base.kind === "item"
          && options.inactiveActivityItemIds.has(portAcceptRule.base.itemId)
          ? createNoneAcceptRule()
          : acceptRuleFromPortKind(portGroup.kind);
        const acceptRule = portAcceptRule.base.kind === "none"
          ? portAcceptRule
          : (intersectAcceptRules(
              acceptRuleConstraintFromPortKind(portGroup.kind),
              portAcceptRule,
              options.itemCatalog,
            ) ?? fallbackAcceptRule);

        options.ports.push({
          id: portId,
          deviceId: options.deviceId,
          portGroupId: portGroup.id,
          portDefinitionId: port.id,
          kind: portGroup.kind,
          isPipe: portGroup.isPipe,
          direction,
          insideGridPoint,
          outsideGridPoint,
          edge,
          boundNodeIds: resolveBoundNodeIds({
            portGroup,
            direction,
            bindingByPortGroupId,
            nodeBindingsByStorageGroupId: options.nodeBindingsByStorageGroupId,
          }),
          acceptRule,
          admissionRule: direction === "input" ? readPortAdmissionRule(port) : null,
          priorityGroup: normalizePortPriorityGroup(port.priorityGroup),
          roundRobinSeed: port.roundRobinSeed,
          order,
        });
        order += 1;
      }
    }
  }
}

function resolveBoundNodeIds(options: {
  readonly portGroup: PortGroupDefinition;
  readonly direction: SimulationPortDirection;
  readonly bindingByPortGroupId: ReadonlyMap<string, readonly PortStorageBindingDefinition[]>;
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
}): readonly string[] {
  const bindings = options.bindingByPortGroupId.get(options.portGroup.id) ?? [];
  const boundFromBindings = bindings.flatMap((binding) =>
    resolveBindingNodeIds(options.nodeBindingsByStorageGroupId.get(binding.storageSlotGroupId), options.direction),
  );
  if (boundFromBindings.length > 0) {
    return boundFromBindings;
  }

  const syntheticGroupId = options.direction === "input"
    ? "synthetic-input"
    : "synthetic-output";
  return resolveBindingNodeIds(options.nodeBindingsByStorageGroupId.get(syntheticGroupId), options.direction);
}

function resolveBindingNodeIds(
  binding: StorageGroupNodeBinding | undefined,
  direction: SimulationPortDirection,
): readonly string[] {
  if (binding === undefined) {
    return [];
  }
  return direction === "input" ? binding.inputNodeIds : binding.outputNodeIds;
}

function attachPortsToNodes(
  nodes: readonly CompiledSimulationNode[],
  ports: readonly CompiledSimulationPort[],
): CompiledSimulationNode[] {
  return nodes.map((node) => ({
    ...node,
    inputPortIds: ports
      .filter((port) => port.direction === "input" && port.boundNodeIds.includes(node.id))
      .map((port) => port.id),
    outputPortIds: ports
      .filter((port) => port.direction === "output" && port.boundNodeIds.includes(node.id))
      .map((port) => port.id),
  }));
}

function compileRouting(
  definition: EntityDefinition,
): Record<string, CompiledSimulationRoutingEntry> {
  const routing: Record<string, CompiledSimulationRoutingEntry> = {};

  for (const portGroup of definition.portGroups) {
    for (const port of portGroup.ports) {
      const portRef = `${portGroup.id}.${port.id}`;
      routing[portRef] = {
        priorityGroup: normalizePortPriorityGroup(port.priorityGroup),
        roundRobinSeed: port.roundRobinSeed,
      };
    }
  }

  return routing;
}

function compileBlockageAutoClearance(
  definition: EntityDefinition,
  config: Readonly<Record<string, unknown>>,
): CompiledSimulationBlockageAutoClearance | null {
  const declaration = definition.blockageAutoClearance;
  if (declaration === undefined) {
    return null;
  }

  const configuredEnabled = config[declaration.enabledConfigKey];
  const enabled = typeof configuredEnabled === "boolean"
    ? configuredEnabled
    : declaration.enabledByDefault;
  const channelIds = [...new Set(declaration.channelIds.filter((id) => id.length > 0))];
  const slotRefs = declaration.slotRefs
    .filter((slotRef) => slotRef.storageSlotGroupId.length > 0)
    .map((slotRef) => ({
      storageSlotGroupId: slotRef.storageSlotGroupId,
      slotId: slotRef.slotId ?? null,
    }));
  const blockedChannelThreshold = Number.isFinite(declaration.blockedChannelThreshold)
    ? Math.max(1, Math.trunc(declaration.blockedChannelThreshold))
    : 1;

  if (channelIds.length === 0 || slotRefs.length === 0) {
    return null;
  }

  return {
    enabled,
    channelIds,
    slotRefs,
    blockedChannelThreshold,
  };
}

function compileWaterPurifierNode(
  definitionId: string,
  config: Readonly<Record<string, unknown>>,
): CompiledSimulationWaterPurifierNodeConfig | null {
  if (definitionId !== WATER_PURIFIER_NODE_ENTITY_ID) {
    return null;
  }

  const rawMode = config[WATER_PURIFIER_OUTPUT_MODE_CONFIG_KEY];
  const outputMode = rawMode === "manual-rate" || rawMode === "input-derived"
    ? rawMode
    : WATER_PURIFIER_DEFAULT_OUTPUT_MODE;
  const rawManualOutputPerMinute = config[WATER_PURIFIER_MANUAL_OUTPUT_PER_MINUTE_CONFIG_KEY];
  const manualOutputPerMinute = typeof rawManualOutputPerMinute === "number"
    && Number.isFinite(rawManualOutputPerMinute)
    ? Math.max(0, rawManualOutputPerMinute)
    : WATER_PURIFIER_DEFAULT_MANUAL_OUTPUT_PER_MINUTE;

  return {
    outputMode,
    manualOutputPerMinute,
    outputStorageGroupId: WATER_PURIFIER_OUTPUT_STORAGE_GROUP_ID,
    outputSlotId: WATER_PURIFIER_OUTPUT_SLOT_ID,
    outputItemId: WATER_PURIFIER_OUTPUT_ITEM_ID,
  };
}

function compileDocumentSlotLinks(options: {
  readonly document: WorldDocument;
  readonly devices: Readonly<Record<string, CompiledSimulationDevice>>;
  readonly nodes: Readonly<Record<string, CompiledSimulationNode>>;
  readonly slots: Readonly<Record<string, CompiledSimulationSlot>>;
}): CompiledSimulationSlotLink[] {
  const links: CompiledSimulationSlotLink[] = [];
  const baseId = options.document.baseId;

  for (const link of [...options.document.slotLinks].sort((left, right) => left.id.localeCompare(right.id))) {
    const sourceSlotIds = resolveDocumentLinkEndpointSlotIds({
      endpoint: link.source,
      endpointRole: "source",
      devices: options.devices,
      nodes: options.nodes,
      slots: options.slots,
      baseId,
    });
    const targetSlotIds = resolveDocumentLinkEndpointSlotIds({
      endpoint: link.target,
      endpointRole: "target",
      devices: options.devices,
      nodes: options.nodes,
      slots: options.slots,
      baseId,
    });
    const targetSlotIdBySourceSlotId = pairSourceSlotsToTargetSlots(sourceSlotIds, targetSlotIds);
    const linkedSourceSlotIds = Object.keys(targetSlotIdBySourceSlotId).sort();
    const linkedTargetSlotIds = [...new Set(Object.values(targetSlotIdBySourceSlotId))].sort();
    if (linkedSourceSlotIds.length === 0 || linkedTargetSlotIds.length === 0) {
      continue;
    }

    links.push({
      id: `document-link:${link.id}`,
      linkType: link.linkType,
      sourceSlotIds: linkedSourceSlotIds,
      targetSlotIds: linkedTargetSlotIds,
      targetSlotIdBySourceSlotId,
    });
  }

  return links;
}

function resolveDocumentLinkEndpointSlotIds(options: {
  readonly endpoint: CacheLinkEndpointDefinition;
  readonly endpointRole: "source" | "target";
  readonly devices: Readonly<Record<string, CompiledSimulationDevice>>;
  readonly nodes: Readonly<Record<string, CompiledSimulationNode>>;
  readonly slots: Readonly<Record<string, CompiledSimulationSlot>>;
  readonly baseId: string;
}): readonly string[] {
  let entityId = options.endpoint.entityId;
  // AI-CORRECTION 2026-06-09: warehouse 实体 ID 在编译时需解析为 device:warehouse:${baseId}。
  // 此前该逻辑在 compileDefinitionSlotLinks 中，EntityDefinition.links 移除后迁移至此。
  if (entityId === "warehouse" || entityId.startsWith("warehouse:")) {
    entityId = `device:warehouse:${options.baseId}`;
  }
  const deviceEntityId = (entityId.startsWith("device:") ? entityId : `device:${entityId}`);
  const device = options.devices[deviceEntityId];
  if (device === undefined) {
    return [];
  }

  const matching = device.nodeIds.flatMap((nodeId) => {
    const node = options.nodes[nodeId];
    if (node === undefined || node.sourceStorageSlotGroupId !== options.endpoint.storageSlotGroupId) {
      return [];
    }
    return node.slotIds.filter((slotId) => {
      const slot = options.slots[slotId];
      return slot?.sourceSlotId === options.endpoint.slotId;
    });
  });

  const preferred = matching.filter((slotId) => {
    const node = options.nodes[options.slots[slotId]?.nodeId ?? ""];
    if (node === undefined) {
      return false;
    }
    return options.endpointRole === "source"
      ? node.viewRole !== "output-view"
      : node.viewRole !== "input-view";
  });

  return (preferred.length > 0 ? preferred : matching).sort();
}

function pairSourceSlotsToTargetSlots(
  sourceSlotIds: readonly string[],
  targetSlotIds: readonly string[],
): Record<string, string> {
  const targetSlotIdBySourceSlotId: Record<string, string> = {};
  if (targetSlotIds.length === 0) {
    return targetSlotIdBySourceSlotId;
  }

  sourceSlotIds.forEach((sourceSlotId, index) => {
    targetSlotIdBySourceSlotId[sourceSlotId] = targetSlotIds[Math.min(index, targetSlotIds.length - 1)] ?? targetSlotIds[0] ?? sourceSlotId;
  });
  return targetSlotIdBySourceSlotId;
}


// AI-CORRECTION 2026-05-13: compileRecipeChannels 替代 resolveDeviceRecipeNodeIds。
// 从 Recipe Channel 声明编译 ingredientNodeIds / productNodeIds。
function compileRecipeChannels(
  channelDefs: readonly RecipeChannelDefinition[],
  recipeChannelBehavior: EntityDefinition["recipeChannelBehavior"],
  bindings: ReadonlyMap<string, StorageGroupNodeBinding>,
  entity: WorldEntity,
  recipeCatalog: Readonly<Record<string, CompiledSimulationRecipeDefinition>>,
): readonly CompiledSimulationRecipeChannel[] {
  if (!channelDefs || channelDefs.length === 0) { return []; }
  const modeSwitchable = recipeChannelBehavior?.automaticModeConfigKey !== undefined;
  const automaticMode = isAutomaticRecipeChannelMode(recipeChannelBehavior, entity.config);
  const compiled = channelDefs.map((ch) => {
    const selectedRecipeId = (entity.config?.channelRecipes as Record<string, string> | undefined)?.[ch.id] ?? null;

    return {
      id: ch.id,
      type: ch.type ?? "normal-channel",
      ingredientNodeIds: [...new Set(ch.ingredientStorageGroupIds.flatMap(
        (gid: string) => bindings.get(gid)?.ingredientNodeIds ?? [],
      ))],
      productNodeIds: [...new Set(ch.productStorageGroupIds.flatMap(
        (gid: string) => bindings.get(gid)?.productNodeIds ?? [],
      ))],
      manualRecipeOnly: modeSwitchable ? !automaticMode : ch.manualRecipeOnly ?? false,
      defaultRecipeId: selectedRecipeId !== null && recipeCatalog[selectedRecipeId] !== undefined
        ? selectedRecipeId
        : null,
    };
  });
  compiled.sort((left, right) => {
    const leftOrder = left.type === "consumption-channel" ? 0 : 1;
    const rightOrder = right.type === "consumption-channel" ? 0 : 1;
    return leftOrder - rightOrder;
  });
  return compiled;
}

function compilePhysicalConnections(
  maybePorts: readonly (CompiledSimulationPort | undefined)[],
  devices: Record<string, CompiledSimulationDevice>,
  isGeneralLogisticsDevice: (definitionId: string) => boolean,
): CompiledSimulationPhysicalConnection[] {
  const sourcePorts = maybePorts.filter((port): port is CompiledSimulationPort =>
    port !== undefined && port.direction === "output",
  );
  const targetPorts = maybePorts.filter((port): port is CompiledSimulationPort =>
    port !== undefined && port.direction === "input",
  );
  const connections: CompiledSimulationPhysicalConnection[] = [];

  for (const sourcePort of sourcePorts) {
    for (const targetPort of targetPorts) {
      if (sourcePort.isPipe !== targetPort.isPipe || sourcePort.deviceId === targetPort.deviceId) {
        continue;
      }
      if (
        areGridPointsEqual(sourcePort.outsideGridPoint, targetPort.insideGridPoint)
        && areGridPointsEqual(sourcePort.insideGridPoint, targetPort.outsideGridPoint)
      ) {
        // 设备间不可直接相连：两端均非通用物流设备时，跳过不建立连接。
        // AI-CORRECTION 2026-07-27: 此处“通用物流设备”指完整传送带族或管道设备族；
        // 传送带物流设备不包括传送带节，管道物流设备不包括管道节。
        // 允许设备紧贴摆放，但端口不生效。
        const sourceDevice = devices[sourcePort.deviceId];
        const targetDevice = devices[targetPort.deviceId];
        if (
          sourceDevice !== undefined
          && targetDevice !== undefined
          && !isGeneralLogisticsDevice(sourceDevice.definitionId)
          && !isGeneralLogisticsDevice(targetDevice.definitionId)
        ) {
          continue;
        }

        connections.push({
          id: `connection:${sourcePort.id}->${targetPort.id}`,
          sourcePortId: sourcePort.id,
          targetPortId: targetPort.id,
          sourceInsideGridPoint: sourcePort.insideGridPoint,
          targetInsideGridPoint: targetPort.insideGridPoint,
        });
      }
    }
  }

  return connections;
}

function getOrderedEntityIds(document: WorldDocument): string[] {
  const ordered = document.entityOrder.filter((entityId, index, array) =>
    document.entities[entityId] !== undefined && array.indexOf(entityId) === index,
  );
  const missingFromOrder = Object.keys(document.entities)
    .filter((entityId) => !ordered.includes(entityId))
    .sort();

  return [...ordered, ...missingFromOrder];
}

function resolveStorageGroupPortDirections(
  definition: EntityDefinition,
  storageGroupId: string,
): { readonly hasInput: boolean; readonly hasOutput: boolean } {
  let hasInput = false;
  let hasOutput = false;
  for (const binding of definition.portStorageBindings) {
    if (binding.storageSlotGroupId !== storageGroupId) {
      continue;
    }
    const portGroup = definition.portGroups.find((candidate) => candidate.id === binding.portGroupId);
    if (portGroup === undefined) {
      continue;
    }
    if (portGroup.direction === "input" || portGroup.direction === "bidirectional") {
      hasInput = true;
    }
    if (portGroup.direction === "output" || portGroup.direction === "bidirectional") {
      hasOutput = true;
    }
  }
  return { hasInput, hasOutput };
}

// AI-REMOVED 2026-05-13: resolveSlotType
// Reason: role field removed from StorageSlotGroupDefinition.
// Trigger: Recipe Channel 重构.
// Replacement: None needed; slotType concept eliminated.
// Risk: Low

// AI-REMOVED 2026-05-13: resolveDeviceRecipeNodeIds
// Reason: ingredientNodeIds/productNodeIds now compiled from Recipe Channel declarations.
// Trigger: Recipe Channel 重构.
// Replacement: compileRecipeChannels()
// Risk: Low

function resolveSlotDomain(
  storageGroup: StorageSlotGroupDefinition,
  slot: StorageSlotDefinition,
): SimulationItemDomainFilter {
  // AI-CORRECTION 2026-05-30: itemFilterType="any" 必须直接返回 "any"，
  // 不能 fallthrough 到 storageGroup.kind 分支。
  // 原逻辑对 "any" 无匹配，落入 kind==="item"→返回 "solid"，
  // 导致反应池共享输入缓存（kind="item", filterType="any"）拒绝液体。
  // AI-CORRECTION 2026-07-28: itemFilterType 与 storageGroup.kind 均为位标志，联合域无需分支展开。
  return slot.itemFilterType ?? storageGroup.kind;
}

function inferStorageDomainFromPortGroups(
  portGroups: readonly PortGroupDefinition[],
  direction: SimulationPortDirection,
): SimulationItemDomainFilter {
  const matchingPortGroups = portGroups.filter((portGroup) =>
    portGroup.direction === direction || portGroup.direction === "bidirectional",
  );
  if (matchingPortGroups.length === 0) {
    return AnyDomain;
  }

  const inferredFlags = matchingPortGroups.reduce<SimulationItemDomainFilter>((groupFlags, portGroup) =>
    groupFlags | portGroup.ports.reduce<SimulationItemDomainFilter>((portFlags, port) => {
      if (port.acceptRule.base.kind === "none") {
        return portFlags;
      }
      if (port.acceptRule.base.kind === "domain") {
        return portFlags | (portGroup.kind & port.acceptRule.base.flags);
      }
      return portFlags | portGroup.kind;
    }, ItemDomainFlag.None),
  ItemDomainFlag.None);

  return inferredFlags === ItemDomainFlag.None
    ? matchingPortGroups.reduce<SimulationItemDomainFilter>(
        (flags, portGroup) => flags | portGroup.kind,
        ItemDomainFlag.None,
      )
    : inferredFlags;
}

function resolvePortGroupDirections(
  direction: PortGroupDefinition["direction"],
): readonly SimulationPortDirection[] {
  if (direction === "bidirectional") {
    return ["input", "output"];
  }
  return [direction];
}

function acceptRuleFromPortKind(kind: SimulationPortKind): SimulationAcceptRule {
  return {
    base: { kind: "domain", flags: kind },
    exclude: [],
  };
}

function acceptRuleConstraintFromPortKind(kind: SimulationPortKind): SimulationAcceptRule {
  return {
    base: { kind: "domain", flags: kind },
    exclude: [],
  };
}

function createNoneAcceptRule(): SimulationAcceptRule {
  return {
    base: { kind: "none" },
    exclude: [],
  };
}

function readPortAcceptRule(port: PortDefinition): SimulationAcceptRule {
  return {
    base: port.acceptRule.base,
    exclude: [...port.acceptRule.exclude].sort(),
  };
}

function readPortAdmissionRule(port: PortDefinition): SimulationAdmissionRule | null {
  const rule = port.admissionRule;
  if (rule === undefined || rule === null) {
    return null;
  }

  const itemId = typeof rule.itemId === "string" && rule.itemId.length > 0
    ? rule.itemId
    : null;
  const limit = typeof rule.limit === "number" && Number.isFinite(rule.limit)
    ? Math.max(0, Math.floor(rule.limit))
    : null;
  const perMinuteLimit = typeof rule.perMinuteLimit === "number" && Number.isFinite(rule.perMinuteLimit)
    ? Math.max(0, Math.floor(rule.perMinuteLimit))
    : null;

  return { itemId, limit, perMinuteLimit };
}

function intersectAcceptRules(
  left: SimulationAcceptRule,
  right: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): SimulationAcceptRule | null {
  const leftCandidates = resolveAcceptRuleCandidateDomains(left, itemCatalog);
  const rightCandidates = resolveAcceptRuleCandidateDomains(right, itemCatalog);
  const sharedFlags = leftCandidates.flags & rightCandidates.flags;
  const exclude = [...new Set([...left.exclude, ...right.exclude])].sort();

  if (leftCandidates.itemId !== null && rightCandidates.itemId !== null) {
    if (
      leftCandidates.itemId !== rightCandidates.itemId
      || exclude.includes(leftCandidates.itemId)
      || itemCatalog[leftCandidates.itemId] === undefined
    ) {
      return null;
    }
    return {
      base: { kind: "item", itemId: leftCandidates.itemId },
      exclude,
    };
  }

  const itemId = leftCandidates.itemId ?? rightCandidates.itemId;
  if (itemId !== null) {
    const domain = itemCatalog[itemId]?.domain;
    if (domain === undefined) {
      return null;
    }

    if ((sharedFlags & domain) === 0 || exclude.includes(itemId)) {
      return null;
    }
    return {
      base: { kind: "item", itemId },
      exclude,
    };
  }

  if (sharedFlags === ItemDomainFlag.None) {
    return null;
  }

  return {
    base: { kind: "domain", flags: sharedFlags },
    exclude,
  };
}

function resolveAcceptRuleCandidateDomains(
  rule: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): {
  readonly flags: SimulationItemDomainFilter;
  readonly itemId: string | null;
} {
  switch (rule.base.kind) {
    case "domain":
      return { flags: rule.base.flags, itemId: null };
    case "item": {
      const item = itemCatalog[rule.base.itemId];
      if (item === undefined) {
        return {
          flags: ItemDomainFlag.None,
          itemId: rule.base.itemId,
        };
      }

      return {
        flags: item.domain,
        itemId: rule.base.itemId,
      };
    }
    case "none":
      return { flags: ItemDomainFlag.None, itemId: null };
  }
}

// AI-REMOVED 2026-06-12:
// Reason: 边的 count = min(sourcePort.count, targetPort.count) 是 per-tick 限流旧设计。
// Trigger: 用户要求删除 per tick count，并改为准入口跨 tick admission counter。
// Evidence: CompiledSimulationTransferEdge.count 已注释化删除。
// Replacement: target input port 的 admissionRule。
// Risk: Medium - 分流求解逻辑需通过 targetPortId 查询 runtime counter。
// Human Review: Required
//
// Original code:
// function minCountLimit(
//   left: SimulationCountLimit,
//   right: SimulationCountLimit,
// ): SimulationCountLimit {
//   if (left === "unlimited") {
//     return right;
//   }
//   if (right === "unlimited") {
//     return left;
//   }
//   return Math.min(left, right);
// }

/**
 * 解析设备的运输类别。
 *
 * 判定逻辑：
 * 1. 在 DEDICATED_LOGISTICS_DEVICE_KINDS 中注册的 → strict-belt 或 strict-pipe。
 *    当前仅 belt_straight_1x1 / belt_turn_cw_1x1 / belt_turn_ccw_1x1 为 strict-belt，
 *    pipe_straight_1x1 / pipe_turn_cw_1x1 / pipe_turn_ccw_1x1 为 strict-pipe。
 *    AI-CORRECTION 2026-07-27: 上述两组现分别称为传送带节、管道节，
 *    由 RegistryQuery.isBelt / isPipe 判定，不再读取旧映射。
 *
 * 2. 通用物流设备（item_pipe_splitter、item_pipe_converger、item_pipe_connector、
 *    item_log_splitter、item_log_converger、item_log_connector、
 *    item_pipe_admission、item_log_admission）不在专用物流注册表中，
 *    AI-CORRECTION 2026-07-19: 当前上述设备定义 ID 已移除 item_ 前缀；原名仅作历史审计。
 *    AI-CORRECTION 2026-07-27: “通用物流设备”现分别称为传送带物流设备、管道物流设备；
 *    两者分别不包括传送带节、管道节。
 *    因此 resolveDedicatedLogisticsKind 返回 null → 归为 anchor。
 *    这是有意设计：这些设备有自己的 buffer 和搬运配方，不应受管道域锁约束，
 *    且它们应分割 strict-pipe 的 TransportComponent。
 *
 * 3. 无端口且无存储槽的空壳设备 → non-graph（不进求解图）。
 *
 * 4. 其余有端口/有存储槽的设备（生产设备、仓库设备等） → anchor。
 */
function resolveTransportClass(
  registryQueries: RegistryContract["queries"],
  definition: EntityDefinition,
): SimulationTransportClass {
  const dedicatedLogisticsKind = registryQueries.resolveDedicatedLogisticsKind(definition.id);

  if (dedicatedLogisticsKind === LOGISTICS_KIND.belt) {
    return "strict-belt";
  }

  if (dedicatedLogisticsKind === LOGISTICS_KIND.pipe) {
    return "strict-pipe";
  }

  if (definition.portGroups.length === 0 && definition.storageSlotGroups.length === 0) {
    return "non-graph";
  }
  return "anchor";
}

/**
 * 检测相连的同类型严格管道设备构成的无向连通分量。
 *
 * 仅 strict-pipe 需要域锁（管道独占一种液体）；strict-belt 可混合运输，不建组件。
 *
 * 设计要点：
 * - 仅 strict-pipe 设备参与 TransportComponent 构建。
 * - anchor 设备（分流器/汇流器/桥接器/准入口、生产设备等）不参与，且会**分割**连通分量。
 *   例如：pipe → splitter(anchor) → pipe 中，splitter 两侧的 pipe 属于不同的 TransportComponent。
 *   这是有意设计——分流器等设备有自己的 buffer 和独立搬运配方，不应被管道域锁约束。
 * - 邻接判定仅通过 physical connections：两个 strict-pipe 端口在网格上相邻且同 transportClass 才算连通。
 * - BFS 遍历所有 strict-pipe 设备，每个连通分量分配一个唯一的 transportComponentId。
 */
function compileTransportComponents(
  devices: Record<string, CompiledSimulationDevice>,
  physicalConnections: Record<string, CompiledSimulationPhysicalConnection>,
  ports: Record<string, CompiledSimulationPort>,
  nodes: Record<string, CompiledSimulationNode>,
): {
  readonly transportComponents: Record<string, CompiledTransportComponent>;
  readonly transportComponentIdByDeviceId: ReadonlyMap<string, string>;
} {
  const targetClasses = new Set<SimulationTransportClass>(["strict-pipe"]);
  const targetDeviceIds = new Set(
    Object.values(devices)
      .filter((device) => targetClasses.has(device.transportClass))
      .map((device) => device.id),
  );

  if (targetDeviceIds.size === 0) {
    return { transportComponents: {}, transportComponentIdByDeviceId: new Map() };
  }

  // 构建邻接表：通过 physical connections 找到相连的设备。
  const adjacency = new Map<string, Set<string>>();
  for (const deviceId of targetDeviceIds) {
    adjacency.set(deviceId, new Set());
  }

  for (const connection of Object.values(physicalConnections)) {
    const sourceDeviceId = ports[connection.sourcePortId]?.deviceId;
    const targetDeviceId = ports[connection.targetPortId]?.deviceId;

    if (sourceDeviceId === undefined || targetDeviceId === undefined) {
      continue;
    }
    if (!targetDeviceIds.has(sourceDeviceId) || !targetDeviceIds.has(targetDeviceId)) {
      continue;
    }

    const sourceDevice = devices[sourceDeviceId];
    const targetDevice = devices[targetDeviceId];
    if (sourceDevice === undefined || targetDevice === undefined) {
      continue;
    }
    // 仅同 transportClass 的设备才连通。
    if (sourceDevice.transportClass !== targetDevice.transportClass) {
      continue;
    }

    adjacency.get(sourceDeviceId)?.add(targetDeviceId);
    adjacency.get(targetDeviceId)?.add(sourceDeviceId);
  }

  // BFS 找连通分量，收集 nodeIds 与 slotIds。
  const visited = new Set<string>();
  const transportComponents: Record<string, CompiledTransportComponent> = {};
  const transportComponentIdByDeviceId = new Map<string, string>();
  let componentIndex = 0;

  for (const deviceId of targetDeviceIds) {
    if (visited.has(deviceId)) {
      continue;
    }

    const componentDeviceIds: string[] = [];
    const queue = [deviceId];
    visited.add(deviceId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      componentDeviceIds.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    componentDeviceIds.sort();

    // 收集该组件内所有 nodeIds 与 slotIds。
    const componentNodeIds: string[] = [];
    const componentSlotIds: string[] = [];
    for (const id of componentDeviceIds) {
      const device = devices[id];
      if (device === undefined) {
        continue;
      }
      for (const nodeId of device.nodeIds) {
        componentNodeIds.push(nodeId);
        const node = nodes[nodeId];
        if (node !== undefined) {
          componentSlotIds.push(...node.slotIds);
        }
      }
    }

    const componentId = `transport-component:${componentIndex}`;
    transportComponents[componentId] = {
      deviceIds: componentDeviceIds,
      nodeIds: [...new Set(componentNodeIds)].sort(),
      slotIds: [...new Set(componentSlotIds)].sort(),
    };
    for (const id of componentDeviceIds) {
      transportComponentIdByDeviceId.set(id, componentId);
    }
    componentIndex += 1;
  }

  return { transportComponents, transportComponentIdByDeviceId };
}

function rotateLocalPortCell(options: {
  readonly footprint: { readonly width: number; readonly height: number };
  readonly port: PortDefinition;
  readonly rotation: GridRotation;
}): GridPoint {
  switch (options.rotation) {
    case 0:
      return { x: options.port.localCellX, y: options.port.localCellY };
    case 90:
      return {
        x: options.footprint.height - 1 - options.port.localCellY,
        y: options.port.localCellX,
      };
    case 180:
      return {
        x: options.footprint.width - 1 - options.port.localCellX,
        y: options.footprint.height - 1 - options.port.localCellY,
      };
    case 270:
      return {
        x: options.port.localCellY,
        y: options.footprint.width - 1 - options.port.localCellX,
      };
  }
}

function rotateGridEdge(edge: GridEdge, rotation: GridRotation): GridEdge {
  const rotationSteps = rotation / 90;
  const edgeIndex = EDGE_ORDER.indexOf(edge);
  return EDGE_ORDER[(edgeIndex + rotationSteps) % EDGE_ORDER.length] ?? edge;
}

function resolveEdgeDelta(edge: GridEdge): GridPoint {
  switch (edge) {
    case "NORTH":
      return { x: 0, y: -1 };
    case "EAST":
      return { x: 1, y: 0 };
    case "SOUTH":
      return { x: 0, y: 1 };
    case "WEST":
      return { x: -1, y: 0 };
  }
}

function areGridPointsEqual(left: GridPoint, right: GridPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function convertSecondsToSimulationTicks(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds * STANDARD_TICK_RATE_PER_SECOND));
}

function mergeEntityDefinitionConfig(
  definition: EntityDefinition,
  config: WorldEntity["config"],
): EntityDefinition {
  return deepMergeJson(
    cloneJson(definition),
    materializeConfigOverrides(config),
  ) as EntityDefinition;
}

function applyPortPriorityGroupConfig(
  definition: EntityDefinition,
  config: WorldEntity["config"],
): EntityDefinition {
  const customEnabled = isCustomPortPriorityGroupsEnabled(config);
  const overrides = readPortPriorityGroupOverrides(config);

  return {
    ...definition,
    portGroups: definition.portGroups.map((portGroup) => ({
      ...portGroup,
      ports: portGroup.ports.map((port) => {
        const overrideKey = resolvePortPriorityGroupOverrideKey(portGroup.id, port.id);

        return {
          ...port,
          priorityGroup: customEnabled
            ? normalizePortPriorityGroup(overrides[overrideKey])
            : normalizePortPriorityGroup(port.priorityGroup),
        };
      }),
    })),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function materializeConfigOverrides(config: WorldEntity["config"]): Record<string, unknown> {
  const materialized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (key.includes(".") || key.includes("[")) {
      assignPathValue(materialized, parseConfigPath(key), value);
      continue;
    }

    materialized[key] = value;
  }

  return materialized;
}

function parseConfigPath(path: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(path)) !== null) {
    const property = match[1];
    const index = match[2];

    if (property !== undefined) {
      tokens.push(property);
      continue;
    }

    if (index !== undefined) {
      tokens.push(Number(index));
    }
  }

  return tokens;
}

function assignPathValue(
  target: Record<string, unknown>,
  path: readonly (string | number)[],
  value: unknown,
): void {
  let cursor: Record<string, unknown> | unknown[] = target;

  path.forEach((token, index) => {
    const isLast = index === path.length - 1;

    if (isLast) {
      cursor[token as keyof typeof cursor] = value as never;
      return;
    }

    const nextToken = path[index + 1];
    const currentValue = cursor[token as keyof typeof cursor];
    if (typeof currentValue === "object" && currentValue !== null) {
      cursor = currentValue as Record<string, unknown> | unknown[];
      return;
    }

    const nextValue: Record<string, unknown> | unknown[] =
      typeof nextToken === "number" ? [] : {};
    cursor[token as keyof typeof cursor] = nextValue as never;
    cursor = nextValue;
  });
}

function deepMergeJson(left: unknown, right: unknown): unknown {
  if (Array.isArray(left) && Array.isArray(right)) {
    const merged = [...left];
    right.forEach((rightValue, index) => {
      merged[index] = index in merged
        ? deepMergeJson(merged[index], rightValue)
        : rightValue;
    });
    return merged;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const merged: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      merged[key] = key in merged
        ? deepMergeJson(merged[key], value)
        : value;
    }
    return merged;
  }

  return right;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
