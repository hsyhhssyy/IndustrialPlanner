import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  CacheLinkEndpointDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import type { GridEdge, GridPoint, GridRotation } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

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
  SimulationAcceptRule,
  SimulationCompileDiagnostic,
  SimulationCountLimit,
  SimulationItemDomain,
  SimulationNodeViewRole,
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
  const itemCatalog = compileItemCatalog(options.registry);
  const recipeCatalog = compileRecipeCatalog(options.registry);

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
  }

  for (const link of compileDocumentSlotLinks({
    document: options.document,
    devices,
    nodes,
    slots,
  })) {
    links[link.id] = link;
  }

  for (const connection of compilePhysicalConnections(portOrder.map((portId) => ports[portId]))) {
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
          count: minCountLimit(sourcePort.count, targetPort.count),
        };
        transferEdges[edge.id] = edge;
        edgeOrder.push(edge.id);
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
  const topologyHashInput = {
    documentHash,
    registryHash,
    standardTickRate,
    itemCatalog,
    recipeCatalog,
    devices,
    nodes,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
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
    schemaVersion: 3,
    topologyId: hashStable(topologyHashInput),
    documentKey: options.document.documentKey,
    documentHash,
    registryHash,
    standardTickRate,
    itemCatalog,
    recipeCatalog,
    devices,
    nodes,
    slots,
    ports,
    links,
    physicalConnections,
    transferEdges,
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
): Record<string, CompiledSimulationItem> {
  const catalog: Record<string, CompiledSimulationItem> = {};

  for (const item of [...registry.itemDefinitions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    catalog[item.id] = {
      id: item.id,
      domain: inferItemDomain(item.id, item.tags),
      tags: [...item.tags].sort(),
    };
  }

  return catalog;
}

function compileRecipeCatalog(
  registry: RegistryContract,
): Record<string, CompiledSimulationRecipeDefinition> {
  const catalog: Record<string, CompiledSimulationRecipeDefinition> = {};
  for (const recipe of [...registry.recipeDefinitions].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    catalog[recipe.id] = compileRecipeDefinition(recipe, convertSecondsToSimulationTicks(recipe.durationSeconds));
  }
  return catalog;
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
    domain: itemCatalog[itemId]?.domain ?? "any",
    lock: itemId,
    initialItemType: itemId,
    initialCount: 0,
    ignoreStock: false,
    submitMode: "never" as const,
    submitIntervalTicks: null,
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
      tags: ["warehouse"],
      transportClass: "anchor",
      transportComponentId: null,
      nodeIds: [nodeId],
      recipeChannels: [],
      portIds: [],
      routing: {},
      configHash: hashStable({ baseId: document.baseId, itemIds: Object.keys(itemCatalog).sort() }),
    },
    nodes: [node],
    slots,
    ports: [],
    links: [],
  };
}

function compileEntityDevice(options: {
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly registryQueries: RegistryContract["queries"];
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
}): DeviceCompileResult {
  const deviceId = `device:${options.entity.id}`;
  const definition = mergeEntityDefinitionConfig(options.definition, options.entity.config);
  const transportClass = resolveTransportClass(options.registryQueries, definition);
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
  });
  compileSyntheticNodesForUnboundPorts({
    deviceId,
    definition,
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
  });

  const nodesWithPorts = attachPortsToNodes(nodes, ports);
  nodes.splice(0, nodes.length, ...nodesWithPorts);

  const device: CompiledSimulationDevice = {
    id: deviceId,
    sourceEntityId: options.entity.id,
    definitionId: definition.id,
    position: { ...options.entity.position },
    rotation: options.entity.rotation,
    tags: [...definition.tags].sort(),
    transportClass,
    transportComponentId: null,
    nodeIds: nodes.map((node) => node.id),
    recipeChannels: compileRecipeChannels(definition.recipeChannels, nodeBindingsByStorageGroupId),
    portIds: ports.map((port) => port.id),
    routing: compileRouting(definition),
    configHash: hashStable({
      entity: options.entity,
      definition,
    }),
  };

  return {
    device,
    nodes,
    slots,
    ports,
    links,
  };
}

function compileStorageSlotGroups(options: {
  readonly deviceId: string;
  readonly definition: EntityDefinition;
  readonly nodes: CompiledSimulationNode[];
  readonly slots: CompiledSimulationSlot[];
  readonly links: CompiledSimulationSlotLink[];
  readonly nodeBindingsByStorageGroupId: Map<string, StorageGroupNodeBinding>;
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
      });
      const outputSlot = compileSlot({
        slot,
        slotIndex,
        nodeId: outputNodeId,
        storageGroup: options.storageGroup,
        slotIdSuffix: ".out-view",
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
    ingredientNodeIds: options.hasInputBinding ? [nodeId] : [],
    productNodeIds: options.hasOutputBinding ? [nodeId] : [],
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
  readonly domain: SimulationItemDomain | "any";
  readonly bindDirection: SimulationPortDirection;
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
    capacity: 1,
    domain: options.domain,
    lock: null,
    initialItemType: null,
    initialCount: 0,
    ignoreStock: false,
    submitMode: "never",
    submitIntervalTicks: null,
  });
  options.nodeBindingsByStorageGroupId.set(options.sourceStorageSlotGroupId, {
    inputNodeIds: options.bindDirection === "input" ? [nodeId] : [],
    outputNodeIds: options.bindDirection === "output" ? [nodeId] : [],
    ingredientNodeIds: options.bindDirection === "input" ? [nodeId] : [],
    productNodeIds: options.bindDirection === "output" ? [nodeId] : [],
  });
}

function compileSlot(options: {
  readonly slot: StorageSlotDefinition;
  readonly slotIndex: number;
  readonly nodeId: string;
  readonly storageGroup: StorageSlotGroupDefinition;
  readonly slotIdSuffix?: string;
  readonly initialItemType?: string | null;
  readonly initialCount?: number;
}): CompiledSimulationSlot {
  const submitMode = options.slot.submitMode;
  const submitInterval = submitMode === "every-n-seconds"
    ? convertSecondsToSimulationTicks(options.slot.submitIntervalSeconds ?? 10)
    : null;
  const lock = options.slot.lock;
  const hasInitialItemTypeOverride = Object.prototype.hasOwnProperty.call(options, "initialItemType");
  const itemType = hasInitialItemTypeOverride
    ? options.initialItemType ?? null
    : options.slot.initialItemType ?? lock;

  return {
    id: `${options.nodeId}/slot:${options.slot.id}${options.slotIdSuffix ?? ""}`,
    nodeId: options.nodeId,
    sourceStorageSlotGroupId: options.storageGroup.id,
    sourceSlotId: options.slot.id,
    capacity: options.slot.capacity,
    domain: resolveSlotDomain(options.storageGroup, options.slot),
    lock,
    initialItemType: itemType,
    initialCount: options.initialCount ?? options.slot.initialCount,
    ignoreStock: options.slot.ignoreStock,
    submitMode,
    submitIntervalTicks: submitInterval,
  };
}

function compilePorts(options: {
  readonly deviceId: string;
  readonly entity: WorldEntity;
  readonly definition: EntityDefinition;
  readonly nodeBindingsByStorageGroupId: ReadonlyMap<string, StorageGroupNodeBinding>;
  readonly itemCatalog: Record<string, CompiledSimulationItem>;
  readonly ports: CompiledSimulationPort[];
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
        const acceptRule = intersectAcceptRules(
          acceptRuleFromPortKind(portGroup.kind),
          readPortAcceptRule(port),
          options.itemCatalog,
        ) ?? acceptRuleFromPortKind(portGroup.kind);

        options.ports.push({
          id: portId,
          deviceId: options.deviceId,
          portGroupId: portGroup.id,
          portDefinitionId: port.id,
          kind: portGroup.kind,
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
          count: port.count,
          priorityGroup: port.priorityGroup,
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
        priorityGroup: port.priorityGroup,
        roundRobinSeed: port.roundRobinSeed,
      };
    }
  }

  return routing;
}

function compileDocumentSlotLinks(options: {
  readonly document: WorldDocument;
  readonly devices: Readonly<Record<string, CompiledSimulationDevice>>;
  readonly nodes: Readonly<Record<string, CompiledSimulationNode>>;
  readonly slots: Readonly<Record<string, CompiledSimulationSlot>>;
}): CompiledSimulationSlotLink[] {
  const links: CompiledSimulationSlotLink[] = [];

  for (const link of [...options.document.slotLinks].sort((left, right) => left.id.localeCompare(right.id))) {
    const sourceSlotIds = resolveDocumentLinkEndpointSlotIds({
      endpoint: link.source,
      endpointRole: "source",
      devices: options.devices,
      nodes: options.nodes,
      slots: options.slots,
    });
    const targetSlotIds = resolveDocumentLinkEndpointSlotIds({
      endpoint: link.target,
      endpointRole: "target",
      devices: options.devices,
      nodes: options.nodes,
      slots: options.slots,
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
}): readonly string[] {
  const device = options.devices[`device:${options.endpoint.entityId}`];
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
  bindings: ReadonlyMap<string, StorageGroupNodeBinding>,
): readonly CompiledSimulationRecipeChannel[] {
  if (!channelDefs || channelDefs.length === 0) { return []; }
  return channelDefs.map((ch) => ({
    id: ch.id,
    ingredientNodeIds: [...new Set(ch.ingredientStorageGroupIds.flatMap(
      (gid: string) => bindings.get(gid)?.ingredientNodeIds ?? [],
    ))],
    productNodeIds: [...new Set(ch.productStorageGroupIds.flatMap(
      (gid: string) => bindings.get(gid)?.productNodeIds ?? [],
    ))],
  }));
}

function compilePhysicalConnections(
  maybePorts: readonly (CompiledSimulationPort | undefined)[],
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
      if (sourcePort.kind !== targetPort.kind || sourcePort.deviceId === targetPort.deviceId) {
        continue;
      }
      if (
        areGridPointsEqual(sourcePort.outsideGridPoint, targetPort.insideGridPoint)
        && areGridPointsEqual(sourcePort.insideGridPoint, targetPort.outsideGridPoint)
      ) {
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
): SimulationItemDomain | "any" {
  if (slot.itemFilterType === "solid" || slot.itemFilterType === "liquid") {
    return slot.itemFilterType;
  }
  if (storageGroup.kind === "fluid") {
    return "liquid";
  }
  if (storageGroup.kind === "item") {
    return "solid";
  }
  return "any";
}

function inferStorageDomainFromPortGroups(
  portGroups: readonly PortGroupDefinition[],
  direction: SimulationPortDirection,
): SimulationItemDomain | "any" {
  const matchingKinds = new Set(portGroups
    .filter((portGroup) =>
      portGroup.direction === direction || portGroup.direction === "bidirectional",
    )
    .map((portGroup) => portGroup.kind));
  if (matchingKinds.size !== 1) {
    return "any";
  }
  return matchingKinds.has("fluid") ? "liquid" : "solid";
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
    base: kind === "fluid" ? { kind: "liquid" } : { kind: "solid" },
    exclude: [],
  };
}

function readPortAcceptRule(port: PortDefinition): SimulationAcceptRule {
  return {
    base: port.acceptRule.base,
    exclude: [...port.acceptRule.exclude].sort(),
  };
}

function intersectAcceptRules(
  left: SimulationAcceptRule,
  right: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): SimulationAcceptRule | null {
  const leftCandidates = resolveAcceptRuleCandidateDomains(left, itemCatalog);
  const rightCandidates = resolveAcceptRuleCandidateDomains(right, itemCatalog);
  const sharedDomains = leftCandidates.domains.filter((domain) =>
    rightCandidates.domains.includes(domain),
  );
  const exclude = [...new Set([...left.exclude, ...right.exclude])].sort();

  if (leftCandidates.itemId !== null && rightCandidates.itemId !== null) {
    if (leftCandidates.itemId !== rightCandidates.itemId || exclude.includes(leftCandidates.itemId)) {
      return null;
    }
    return {
      base: { kind: "item", itemId: leftCandidates.itemId },
      exclude,
    };
  }

  const itemId = leftCandidates.itemId ?? rightCandidates.itemId;
  if (itemId !== null) {
    const domain = itemCatalog[itemId]?.domain ?? inferItemDomain(itemId, []);
    if (!sharedDomains.includes(domain) || exclude.includes(itemId)) {
      return null;
    }
    return {
      base: { kind: "item", itemId },
      exclude,
    };
  }

  if (sharedDomains.length === 0) {
    return null;
  }

  if (sharedDomains.length === 1) {
    return {
      base: { kind: sharedDomains[0] ?? "solid" },
      exclude,
    };
  }

  return {
    base: { kind: "any" },
    exclude,
  };
}

function resolveAcceptRuleCandidateDomains(
  rule: SimulationAcceptRule,
  itemCatalog: Record<string, CompiledSimulationItem>,
): {
  readonly domains: SimulationItemDomain[];
  readonly itemId: string | null;
} {
  switch (rule.base.kind) {
    case "any":
      return { domains: ["solid", "liquid"], itemId: null };
    case "solid":
      return { domains: ["solid"], itemId: null };
    case "liquid":
      return { domains: ["liquid"], itemId: null };
    case "item":
      return {
        domains: [itemCatalog[rule.base.itemId]?.domain ?? inferItemDomain(rule.base.itemId, [])],
        itemId: rule.base.itemId,
      };
  }
}

function minCountLimit(
  left: SimulationCountLimit,
  right: SimulationCountLimit,
): SimulationCountLimit {
  if (left === "unlimited") {
    return right;
  }
  if (right === "unlimited") {
    return left;
  }
  return Math.min(left, right);
}

function resolveTransportClass(
  registryQueries: RegistryContract["queries"],
  definition: EntityDefinition,
): SimulationTransportClass {
  const dedicatedLogisticsKind = registryQueries.resolveDedicatedLogisticsKind(definition.id);

  if (dedicatedLogisticsKind === "belt") {
    return "strict-belt";
  }

  if (dedicatedLogisticsKind === "pipe") {
    return "strict-pipe";
  }

  if (definition.portGroups.length === 0 && definition.storageSlotGroups.length === 0) {
    return "non-graph";
  }
  return "anchor";
}

/**
 * 检测相连的同类型严格管道设备构成的无向连通分量。
 * 仅 strict-pipe 需要域锁（管道独占一种液体）；strict-belt 可混合运输，不建组件。
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

function inferItemDomain(
  itemId: string,
  tags: readonly string[],
): SimulationItemDomain {
  if (
    itemId.includes("_liquid")
    || itemId.startsWith("liquid_")
    || tags.includes("liquid")
    || tags.includes("fluid")
  ) {
    return "liquid";
  }

  return "solid";
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
