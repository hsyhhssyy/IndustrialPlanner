import type { RegistryContract } from "@/domain/registry/registry-contract";
import {
  ENTITY_INPUT_ROUTING_STRATEGY,
  ENTITY_SIMULATION_BEHAVIOR_TYPE,
} from "@/domain/registry";

import type {
  CompiledSimulationNode,
  CompiledSimulationPort,
  CompiledSimulationTopology,
  SimulationPortDirection,
} from "../types";

export const DENSE_SIMULATION_PROTOCOL_VERSION = 1 as const;
export const DENSE_INDEX_NONE = -1;

export interface DenseTopologyDictionary {
  readonly protocolVersion: typeof DENSE_SIMULATION_PROTOCOL_VERSION;
  readonly topologyId: string;
  readonly documentHash: string;
  readonly deviceIds: readonly string[];
  readonly slotIds: readonly string[];
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly recipeIds: readonly string[];
  readonly componentIds: readonly string[];
  readonly routingCursorKeys: readonly string[];
}

export interface DenseTopologyLayout {
  readonly dictionary: DenseTopologyDictionary;
  readonly deviceNodeOffsets: Uint32Array;
  readonly deviceNodeIndexes: Uint32Array;
  readonly deviceTransportComponentIndexes: Int32Array;
  readonly nodeDeviceIndexes: Uint32Array;
  readonly nodeSlotOffsets: Uint32Array;
  readonly nodeSlotIndexes: Uint32Array;
  readonly nodeWarehouseSinkFlags: Uint8Array;
  readonly slotNodeIndexes: Uint32Array;
  readonly slotCanonicalIndexes: Uint32Array;
  readonly slotStorageIndexes: Uint32Array;
  readonly storageSlotViewOffsets: Uint32Array;
  readonly storageSlotViewIndexes: Uint32Array;
  readonly slotCapacityGroupIndexes: Int32Array;
  readonly capacityGroupSlotOffsets: Uint32Array;
  readonly capacityGroupSlotIndexes: Uint32Array;
  readonly capacityGroupLimits: Float64Array;
  readonly slotTransportComponentIndexes: Int32Array;
  readonly slotCapacities: Float64Array;
  readonly slotDomainFlags: Uint32Array;
  readonly slotLockItemIndexes: Int32Array;
  readonly slotInitialItemIndexes: Int32Array;
  readonly slotInitialCounts: Float64Array;
  readonly slotInitialFlags: Uint8Array;
  readonly itemDomainFlags: Uint8Array;
  readonly edgeSourceNodeIndexes: Uint32Array;
  readonly edgeTargetNodeIndexes: Uint32Array;
  readonly edgeAcceptKinds: Uint8Array;
  readonly edgeAcceptValues: Int32Array;
  readonly edgeExcludedItemOffsets: Uint32Array;
  readonly edgeExcludedItemIndexes: Uint32Array;
  readonly edgeSourceRoutingGroupIndexes: Uint32Array;
  readonly edgeSourceRoutingPortIndexes: Uint32Array;
  readonly edgeTargetRoutingGroupIndexes: Uint32Array;
  readonly edgeTargetRoutingPortIndexes: Uint32Array;
  readonly routingGroupPortOffsets: Uint32Array;
  readonly routingGroupConnectedFlags: Uint8Array;
  readonly componentDeviceOffsets: Uint32Array;
  readonly componentDeviceIndexes: Uint32Array;
  readonly componentSlotOffsets: Uint32Array;
  readonly componentSlotIndexes: Uint32Array;
}

export interface DenseTopologyLookup {
  readonly deviceIndexById: ReadonlyMap<string, number>;
  readonly slotIndexById: ReadonlyMap<string, number>;
  readonly nodeIndexById: ReadonlyMap<string, number>;
  readonly edgeIndexById: ReadonlyMap<string, number>;
  readonly itemIndexById: ReadonlyMap<string, number>;
  readonly recipeIndexById: ReadonlyMap<string, number>;
  readonly componentIndexById: ReadonlyMap<string, number>;
}

interface DenseRoutingCompilation {
  readonly cursorKeys: readonly string[];
  readonly edgeSourceGroupIndexes: Uint32Array;
  readonly edgeSourcePortIndexes: Uint32Array;
  readonly edgeTargetGroupIndexes: Uint32Array;
  readonly edgeTargetPortIndexes: Uint32Array;
  readonly groupPortOffsets: Uint32Array;
  readonly groupConnectedFlags: Uint8Array;
}

export function compileDenseTopologyLayout(
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
): DenseTopologyLayout {
  const dictionary = createDenseTopologyDictionary(topology, registry);
  const lookup = createDenseTopologyLookup(dictionary);
  const deviceNodeOffsets = new Uint32Array(dictionary.deviceIds.length + 1);
  const deviceNodeIndexes: number[] = [];

  for (let deviceIndex = 0; deviceIndex < dictionary.deviceIds.length; deviceIndex += 1) {
    const deviceId = dictionary.deviceIds[deviceIndex]!;
    const device = requireRecordEntry(topology.devices, deviceId, "device");
    deviceNodeOffsets[deviceIndex] = deviceNodeIndexes.length;
    for (const nodeId of device.nodeIds) {
      deviceNodeIndexes.push(requireDenseIndex(lookup.nodeIndexById, nodeId, "node"));
    }
  }
  deviceNodeOffsets[dictionary.deviceIds.length] = deviceNodeIndexes.length;

  const deviceTransportComponentIndexes = new Int32Array(dictionary.deviceIds.length);
  deviceTransportComponentIndexes.fill(DENSE_INDEX_NONE);
  for (let deviceIndex = 0; deviceIndex < dictionary.deviceIds.length; deviceIndex += 1) {
    const deviceId = dictionary.deviceIds[deviceIndex]!;
    const componentId = requireRecordEntry(topology.devices, deviceId, "device")
      .transportComponentId;
    if (componentId !== null) {
      deviceTransportComponentIndexes[deviceIndex] = requireDenseIndex(
        lookup.componentIndexById,
        componentId,
        "component",
      );
    }
  }

  const nodeDeviceIndexes = new Uint32Array(dictionary.nodeIds.length);
  const nodeSlotOffsets = new Uint32Array(dictionary.nodeIds.length + 1);
  const nodeSlotIndexes: number[] = [];
  const nodeWarehouseSinkFlags = new Uint8Array(dictionary.nodeIds.length);
  const documentLinkedStorageGroups = collectDocumentLinkedStorageGroups(topology);
  for (let nodeIndex = 0; nodeIndex < dictionary.nodeIds.length; nodeIndex += 1) {
    const nodeId = dictionary.nodeIds[nodeIndex]!;
    const node = requireRecordEntry(topology.nodes, nodeId, "node");
    nodeDeviceIndexes[nodeIndex] = requireDenseIndex(
      lookup.deviceIndexById,
      node.deviceId,
      "device",
    );
    nodeSlotOffsets[nodeIndex] = nodeSlotIndexes.length;
    for (const slotId of node.slotIds) {
      nodeSlotIndexes.push(requireDenseIndex(lookup.slotIndexById, slotId, "slot"));
    }
    if (isDenseWarehouseSinkInputNode(
      topology,
      registry,
      node,
      documentLinkedStorageGroups,
    )) {
      nodeWarehouseSinkFlags[nodeIndex] = 1;
    }
  }
  nodeSlotOffsets[dictionary.nodeIds.length] = nodeSlotIndexes.length;

  const slotNodeIndexes = new Uint32Array(dictionary.slotIds.length);
  const slotCanonicalIndexes = new Uint32Array(dictionary.slotIds.length);
  const slotCapacities = new Float64Array(dictionary.slotIds.length);
  const slotDomainFlags = new Uint32Array(dictionary.slotIds.length);
  const slotLockItemIndexes = new Int32Array(dictionary.slotIds.length);
  const slotInitialItemIndexes = new Int32Array(dictionary.slotIds.length);
  const slotInitialCounts = new Float64Array(dictionary.slotIds.length);
  const slotInitialFlags = new Uint8Array(dictionary.slotIds.length);
  slotInitialItemIndexes.fill(DENSE_INDEX_NONE);
  slotLockItemIndexes.fill(DENSE_INDEX_NONE);

  for (let slotIndex = 0; slotIndex < dictionary.slotIds.length; slotIndex += 1) {
    const slotId = dictionary.slotIds[slotIndex]!;
    const slot = requireRecordEntry(topology.slots, slotId, "slot");
    slotCanonicalIndexes[slotIndex] = slotIndex;
    slotNodeIndexes[slotIndex] = requireDenseIndex(lookup.nodeIndexById, slot.nodeId, "node");
    slotCapacities[slotIndex] = slot.capacity;
    slotDomainFlags[slotIndex] = slot.domain;
    if (slot.lock !== null) {
      slotLockItemIndexes[slotIndex] = requireDenseIndex(
        lookup.itemIndexById,
        slot.lock,
        "item",
      );
    }
    slotInitialCounts[slotIndex] = Math.max(0, slot.initialCount);
    slotInitialFlags[slotIndex] = slot.ignoreStock ? 1 : 0;
    const initialItemType = slot.initialItemType ?? slot.lock;
    if (initialItemType !== null) {
      slotInitialItemIndexes[slotIndex] = requireDenseIndex(
        lookup.itemIndexById,
        initialItemType,
        "item",
      );
    }
  }

  for (const link of Object.values(topology.links)) {
    if (link.linkType !== "share-all") {
      continue;
    }
    for (const [sourceSlotId, targetSlotId] of Object.entries(
      link.targetSlotIdBySourceSlotId,
    )) {
      const sourceIndex = requireDenseIndex(lookup.slotIndexById, sourceSlotId, "slot");
      const targetIndex = requireDenseIndex(lookup.slotIndexById, targetSlotId, "slot");
      slotCanonicalIndexes[sourceIndex] = targetIndex;
      if (
        slotInitialItemIndexes[targetIndex] === DENSE_INDEX_NONE
        && slotInitialItemIndexes[sourceIndex] !== DENSE_INDEX_NONE
      ) {
        slotInitialItemIndexes[targetIndex] = slotInitialItemIndexes[sourceIndex]!;
      }
      slotInitialCounts[targetIndex] = slotInitialCounts[targetIndex]!
        + slotInitialCounts[sourceIndex]!;
      slotInitialItemIndexes[sourceIndex] = DENSE_INDEX_NONE;
      slotInitialCounts[sourceIndex] = 0;
    }
  }
  validateSlotAliasGraph(slotCanonicalIndexes, dictionary.slotIds);
  const slotStorageIndexes = flattenSlotAliases(slotCanonicalIndexes, dictionary.slotIds);
  const {
    offsets: storageSlotViewOffsets,
    indexes: storageSlotViewIndexes,
  } = createReverseIndex(slotStorageIndexes);
  const slotCapacityGroupIndexes = new Int32Array(dictionary.slotIds.length);
  slotCapacityGroupIndexes.fill(DENSE_INDEX_NONE);
  const capacityGroupSlotOffsets: number[] = [];
  const capacityGroupSlotIndexes: number[] = [];
  const capacityGroupLimits: number[] = [];
  for (const link of Object.values(topology.links)) {
    if (link.linkType === "share-all") {
      continue;
    }
    const slotIndexes = [...new Set(
      [...link.sourceSlotIds, ...link.targetSlotIds].map((slotId) =>
        slotStorageIndexes[requireDenseIndex(lookup.slotIndexById, slotId, "slot")]!
      ),
    )].sort(compareNumbers);
    const groupIndex = capacityGroupLimits.length;
    capacityGroupSlotOffsets.push(capacityGroupSlotIndexes.length);
    capacityGroupSlotIndexes.push(...slotIndexes);
    capacityGroupLimits.push(Math.max(
      0,
      ...[...link.sourceSlotIds, ...link.targetSlotIds].map(
        (slotId) => requireRecordEntry(topology.slots, slotId, "slot").capacity,
      ),
    ));
    for (const storageIndex of slotIndexes) {
      slotCapacityGroupIndexes[storageIndex] = groupIndex;
    }
  }
  capacityGroupSlotOffsets.push(capacityGroupSlotIndexes.length);

  const itemDomainFlags = new Uint8Array(dictionary.itemIds.length);
  for (let itemIndex = 0; itemIndex < dictionary.itemIds.length; itemIndex += 1) {
    const itemId = dictionary.itemIds[itemIndex]!;
    const domain = registry.queries.resolveItemDomain(itemId);
    if (domain === null) {
      throw new Error(`Dense topology cannot resolve item domain for "${itemId}".`);
    }
    itemDomainFlags[itemIndex] = domain;
  }

  const edgeSourceNodeIndexes = new Uint32Array(dictionary.edgeIds.length);
  const edgeTargetNodeIndexes = new Uint32Array(dictionary.edgeIds.length);
  const edgeAcceptKinds = new Uint8Array(dictionary.edgeIds.length);
  const edgeAcceptValues = new Int32Array(dictionary.edgeIds.length);
  edgeAcceptValues.fill(DENSE_INDEX_NONE);
  const edgeExcludedItemOffsets = new Uint32Array(dictionary.edgeIds.length + 1);
  const edgeExcludedItemIndexes: number[] = [];
  for (let edgeIndex = 0; edgeIndex < dictionary.edgeIds.length; edgeIndex += 1) {
    const edgeId = dictionary.edgeIds[edgeIndex]!;
    const edge = requireRecordEntry(topology.transferEdges, edgeId, "edge");
    edgeSourceNodeIndexes[edgeIndex] = requireDenseIndex(
      lookup.nodeIndexById,
      edge.sourceNodeId,
      "node",
    );
    edgeTargetNodeIndexes[edgeIndex] = requireDenseIndex(
      lookup.nodeIndexById,
      edge.targetNodeId,
      "node",
    );
    switch (edge.acceptRule.base.kind) {
      case "none":
        edgeAcceptKinds[edgeIndex] = 0;
        break;
      case "domain":
        edgeAcceptKinds[edgeIndex] = 1;
        edgeAcceptValues[edgeIndex] = edge.acceptRule.base.flags;
        break;
      case "item":
        edgeAcceptKinds[edgeIndex] = 2;
        edgeAcceptValues[edgeIndex] = requireDenseIndex(
          lookup.itemIndexById,
          edge.acceptRule.base.itemId,
          "item",
        );
        break;
    }
    edgeExcludedItemOffsets[edgeIndex] = edgeExcludedItemIndexes.length;
    for (const itemId of edge.acceptRule.exclude) {
      edgeExcludedItemIndexes.push(requireDenseIndex(lookup.itemIndexById, itemId, "item"));
    }
  }
  edgeExcludedItemOffsets[dictionary.edgeIds.length] = edgeExcludedItemIndexes.length;

  const routing = compileDenseRouting(topology, dictionary);

  const componentDeviceOffsets = new Uint32Array(dictionary.componentIds.length + 1);
  const componentDeviceIndexes: number[] = [];
  const componentSlotOffsets = new Uint32Array(dictionary.componentIds.length + 1);
  const componentSlotIndexes: number[] = [];
  const slotTransportComponentIndexes = new Int32Array(dictionary.slotIds.length);
  slotTransportComponentIndexes.fill(DENSE_INDEX_NONE);
  for (
    let componentIndex = 0;
    componentIndex < dictionary.componentIds.length;
    componentIndex += 1
  ) {
    const componentId = dictionary.componentIds[componentIndex]!;
    const component = requireRecordEntry(topology.transportComponents, componentId, "component");
    componentDeviceOffsets[componentIndex] = componentDeviceIndexes.length;
    componentSlotOffsets[componentIndex] = componentSlotIndexes.length;
    for (const deviceId of component.deviceIds) {
      componentDeviceIndexes.push(requireDenseIndex(lookup.deviceIndexById, deviceId, "device"));
    }
    for (const slotId of component.slotIds) {
      const slotIndex = requireDenseIndex(lookup.slotIndexById, slotId, "slot");
      slotTransportComponentIndexes[slotIndex] = componentIndex;
      const storageIndex = slotStorageIndexes[slotIndex]!;
      if (componentSlotIndexes.at(-1) !== storageIndex) {
        componentSlotIndexes.push(storageIndex);
      }
    }
  }
  componentDeviceOffsets[dictionary.componentIds.length] = componentDeviceIndexes.length;
  componentSlotOffsets[dictionary.componentIds.length] = componentSlotIndexes.length;

  return {
    dictionary,
    deviceNodeOffsets,
    deviceNodeIndexes: Uint32Array.from(deviceNodeIndexes),
    deviceTransportComponentIndexes,
    nodeDeviceIndexes,
    nodeSlotOffsets,
    nodeSlotIndexes: Uint32Array.from(nodeSlotIndexes),
    nodeWarehouseSinkFlags,
    slotNodeIndexes,
    slotCanonicalIndexes,
    slotStorageIndexes,
    storageSlotViewOffsets,
    storageSlotViewIndexes,
    slotCapacityGroupIndexes,
    capacityGroupSlotOffsets: Uint32Array.from(capacityGroupSlotOffsets),
    capacityGroupSlotIndexes: Uint32Array.from(capacityGroupSlotIndexes),
    capacityGroupLimits: Float64Array.from(capacityGroupLimits),
    slotTransportComponentIndexes,
    slotCapacities,
    slotDomainFlags,
    slotLockItemIndexes,
    slotInitialItemIndexes,
    slotInitialCounts,
    slotInitialFlags,
    itemDomainFlags,
    edgeSourceNodeIndexes,
    edgeTargetNodeIndexes,
    edgeAcceptKinds,
    edgeAcceptValues,
    edgeExcludedItemOffsets,
    edgeExcludedItemIndexes: Uint32Array.from(edgeExcludedItemIndexes),
    edgeSourceRoutingGroupIndexes: routing.edgeSourceGroupIndexes,
    edgeSourceRoutingPortIndexes: routing.edgeSourcePortIndexes,
    edgeTargetRoutingGroupIndexes: routing.edgeTargetGroupIndexes,
    edgeTargetRoutingPortIndexes: routing.edgeTargetPortIndexes,
    routingGroupPortOffsets: routing.groupPortOffsets,
    routingGroupConnectedFlags: routing.groupConnectedFlags,
    componentDeviceOffsets,
    componentDeviceIndexes: Uint32Array.from(componentDeviceIndexes),
    componentSlotOffsets,
    componentSlotIndexes: Uint32Array.from(componentSlotIndexes),
  };
}

export function createDenseTopologyDictionary(
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
): DenseTopologyDictionary {
  return {
    protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
    topologyId: topology.topologyId,
    documentHash: topology.documentHash,
    deviceIds: [...topology.ordering.deviceOrder],
    slotIds: [...topology.ordering.slotOrder],
    nodeIds: [...topology.ordering.nodeOrder],
    edgeIds: [...topology.ordering.edgeOrder],
    itemIds: registry.itemDefinitions.map((definition) => definition.id).sort(compareStableIds),
    recipeIds: registry.recipeDefinitions.map((definition) => definition.id).sort(compareStableIds),
    componentIds: Object.keys(topology.transportComponents).sort(compareStableIds),
    routingCursorKeys: compileDenseRoutingCursorKeys(topology),
  };
}

function compileDenseRouting(
  topology: CompiledSimulationTopology,
  dictionary: DenseTopologyDictionary,
): DenseRoutingCompilation {
  // AI-REMOVED 2026-09-03:
  // Reason: 路由编译只消费 topology 与 dictionary，DenseTopologyLookup 参数没有语义用途。
  // Trigger: 定向 ESLint 报告未使用参数。
  // Evidence: 函数通过 dictionary.edgeIds 和 topology 解析全部端口位置。
  // Replacement: None。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // _lookup: DenseTopologyLookup,
  const groups = collectDenseRoutingGroups(topology);
  if (!arraysEqual(groups.map((group) => group.key), dictionary.routingCursorKeys)) {
    throw new Error("Dense routing dictionary does not match compiled routing groups.");
  }

  const groupPortOffsets = new Uint32Array(groups.length + 1);
  const groupConnectedFlags: number[] = [];
  const portLocations = new Map<string, { readonly groupIndex: number; readonly portIndex: number }>();
  const connectedPortIds = new Set<string>();
  for (const edgeId of dictionary.edgeIds) {
    const edge = requireRecordEntry(topology.transferEdges, edgeId, "edge");
    connectedPortIds.add(edge.sourcePortId);
    connectedPortIds.add(edge.targetPortId);
  }
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex]!;
    const groupStart = groupPortOffsets[groupIndex]!;
    for (let portIndex = 0; portIndex < group.ports.length; portIndex += 1) {
      const port = group.ports[portIndex]!;
      portLocations.set(port.id, { groupIndex, portIndex });
      groupConnectedFlags.push(connectedPortIds.has(port.id) ? 1 : 0);
    }
    groupPortOffsets[groupIndex + 1] = groupStart + group.ports.length;
  }

  const edgeSourceGroupIndexes = new Uint32Array(dictionary.edgeIds.length);
  const edgeSourcePortIndexes = new Uint32Array(dictionary.edgeIds.length);
  const edgeTargetGroupIndexes = new Uint32Array(dictionary.edgeIds.length);
  const edgeTargetPortIndexes = new Uint32Array(dictionary.edgeIds.length);
  for (let edgeIndex = 0; edgeIndex < dictionary.edgeIds.length; edgeIndex += 1) {
    const edgeId = dictionary.edgeIds[edgeIndex]!;
    const edge = requireRecordEntry(topology.transferEdges, edgeId, "edge");
    const source = portLocations.get(edge.sourcePortId);
    const target = portLocations.get(edge.targetPortId);
    if (source === undefined || target === undefined) {
      throw new Error(`Dense routing cannot resolve ports for edge "${edgeId}".`);
    }
    edgeSourceGroupIndexes[edgeIndex] = source.groupIndex;
    edgeSourcePortIndexes[edgeIndex] = source.portIndex;
    edgeTargetGroupIndexes[edgeIndex] = target.groupIndex;
    edgeTargetPortIndexes[edgeIndex] = target.portIndex;
  }

  return {
    cursorKeys: dictionary.routingCursorKeys,
    edgeSourceGroupIndexes,
    edgeSourcePortIndexes,
    edgeTargetGroupIndexes,
    edgeTargetPortIndexes,
    groupPortOffsets,
    groupConnectedFlags: Uint8Array.from(groupConnectedFlags),
  };
}

function collectDocumentLinkedStorageGroups(
  topology: CompiledSimulationTopology,
): ReadonlySet<string> {
  const linked = new Set<string>();
  for (const link of Object.values(topology.links)) {
    if (!link.id.startsWith("document-link:")) {
      continue;
    }
    for (const slotId of [...link.sourceSlotIds, ...link.targetSlotIds]) {
      const slot = topology.slots[slotId];
      const node = slot === undefined ? undefined : topology.nodes[slot.nodeId];
      if (node?.sourceStorageSlotGroupId !== null && node !== undefined) {
        linked.add(`${node.deviceId}\u0000${node.sourceStorageSlotGroupId}`);
      }
    }
  }
  return linked;
}

function isDenseWarehouseSinkInputNode(
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
  node: CompiledSimulationNode,
  documentLinkedStorageGroups: ReadonlySet<string>,
): boolean {
  if (node.viewRole !== "input-view") {
    return false;
  }
  const device = topology.devices[node.deviceId];
  if (device === undefined) {
    return false;
  }
  if (
    registry.queries.findEntityDefinition(device.definitionId)
      ?.tags.includes("WarehouseSink") === true
  ) {
    return true;
  }
  const storageSlotGroupId = node.sourceStorageSlotGroupId;
  if (storageSlotGroupId === null) {
    return false;
  }
  return device.simulationBehaviors.some((behavior) =>
    behavior.type === ENTITY_SIMULATION_BEHAVIOR_TYPE.inputRouting
    && behavior.strategy === ENTITY_INPUT_ROUTING_STRATEGY.warehouseSinkWhenUnlinked
    && behavior.storageSlotGroupIds.includes(storageSlotGroupId)
  ) && !documentLinkedStorageGroups.has(`${device.id}\u0000${storageSlotGroupId}`);
}

function compileDenseRoutingCursorKeys(
  topology: CompiledSimulationTopology,
): readonly string[] {
  return collectDenseRoutingGroups(topology).map((group) => group.key);
}

function collectDenseRoutingGroups(
  topology: CompiledSimulationTopology,
): readonly { readonly key: string; readonly ports: readonly CompiledSimulationPort[] }[] {
  const groups: Array<{ readonly key: string; readonly ports: readonly CompiledSimulationPort[] }> = [];
  for (const nodeId of topology.ordering.nodeOrder) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    groups.push(
      ...collectDenseNodeRoutingGroups(topology, node, "input", node.inputPortIds),
      ...collectDenseNodeRoutingGroups(topology, node, "output", node.outputPortIds),
    );
  }
  return groups;
}

function collectDenseNodeRoutingGroups(
  topology: CompiledSimulationTopology,
  node: CompiledSimulationNode,
  direction: SimulationPortDirection,
  portIds: readonly string[],
): readonly { readonly key: string; readonly ports: readonly CompiledSimulationPort[] }[] {
  const portsByKey = new Map<string, CompiledSimulationPort[]>();
  for (const portId of portIds) {
    const port = topology.ports[portId];
    if (port === undefined) {
      continue;
    }
    const transportKind = port.isPipe ? "pipe" : "belt";
    const key = `${node.deviceId}:node:${node.id}:${direction}:${transportKind}:kind-${port.kind}:priority-${port.priorityGroup}`;
    const ports = portsByKey.get(key) ?? [];
    ports.push(port);
    portsByKey.set(key, ports);
  }
  return [...portsByKey.entries()]
    .map(([key, ports]) => ({
      key,
      ports: ports.sort(compareDenseRoutingPorts),
    }))
    .sort(compareDenseRoutingGroups);
}

function compareDenseRoutingGroups(
  left: { readonly key: string; readonly ports: readonly CompiledSimulationPort[] },
  right: { readonly key: string; readonly ports: readonly CompiledSimulationPort[] },
): number {
  const leftPort = left.ports[0];
  const rightPort = right.ports[0];
  if (leftPort === undefined || rightPort === undefined) {
    return compareStableIds(left.key, right.key);
  }
  return leftPort.priorityGroup - rightPort.priorityGroup
    || leftPort.order - rightPort.order
    || compareStableIds(left.key, right.key);
}

function compareDenseRoutingPorts(
  left: CompiledSimulationPort,
  right: CompiledSimulationPort,
): number {
  return left.roundRobinSeed - right.roundRobinSeed
    || left.order - right.order
    || compareStableIds(left.id, right.id);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createDenseTopologyLookup(
  dictionary: DenseTopologyDictionary,
): DenseTopologyLookup {
  return {
    deviceIndexById: createIndex(dictionary.deviceIds, "device"),
    slotIndexById: createIndex(dictionary.slotIds, "slot"),
    nodeIndexById: createIndex(dictionary.nodeIds, "node"),
    edgeIndexById: createIndex(dictionary.edgeIds, "edge"),
    itemIndexById: createIndex(dictionary.itemIds, "item"),
    recipeIndexById: createIndex(dictionary.recipeIds, "recipe"),
    componentIndexById: createIndex(dictionary.componentIds, "component"),
  };
}

function createIndex(ids: readonly string[], kind: string): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  for (let denseIndex = 0; denseIndex < ids.length; denseIndex += 1) {
    const id = ids[denseIndex]!;
    if (index.has(id)) {
      throw new Error(`Dense topology contains duplicate ${kind} id "${id}".`);
    }
    index.set(id, denseIndex);
  }
  return index;
}

function requireDenseIndex(
  index: ReadonlyMap<string, number>,
  id: string,
  kind: string,
): number {
  const value = index.get(id);
  if (value === undefined) {
    throw new Error(`Dense topology cannot resolve ${kind} id "${id}".`);
  }
  return value;
}

function requireRecordEntry<T>(
  record: Readonly<Record<string, T>>,
  id: string,
  kind: string,
): T {
  const value = record[id];
  if (value === undefined) {
    throw new Error(`Dense topology ordering references missing ${kind} id "${id}".`);
  }
  return value;
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function validateSlotAliasGraph(
  slotCanonicalIndexes: Uint32Array,
  slotIds: readonly string[],
): void {
  for (let startIndex = 0; startIndex < slotCanonicalIndexes.length; startIndex += 1) {
    let current = startIndex;
    for (let depth = 0; depth <= slotCanonicalIndexes.length; depth += 1) {
      const next = slotCanonicalIndexes[current]!;
      if (next === current) {
        break;
      }
      if (depth === slotCanonicalIndexes.length) {
        throw new Error(`Dense topology contains a slot alias cycle at "${slotIds[startIndex]}".`);
      }
      current = next;
    }
  }
}

function flattenSlotAliases(
  slotCanonicalIndexes: Uint32Array,
  slotIds: readonly string[],
): Uint32Array {
  const storageIndexes = new Uint32Array(slotCanonicalIndexes.length);
  for (let startIndex = 0; startIndex < slotCanonicalIndexes.length; startIndex += 1) {
    let current = startIndex;
    for (let depth = 0; depth <= slotCanonicalIndexes.length; depth += 1) {
      const next = slotCanonicalIndexes[current]!;
      if (next === current) {
        storageIndexes[startIndex] = current;
        break;
      }
      if (depth === slotCanonicalIndexes.length) {
        throw new Error(`Dense topology contains a slot alias cycle at "${slotIds[startIndex]}".`);
      }
      current = next;
    }
  }
  return storageIndexes;
}

function createReverseIndex(values: Uint32Array): {
  readonly offsets: Uint32Array;
  readonly indexes: Uint32Array;
} {
  const counts = new Uint32Array(values.length);
  for (const value of values) {
    counts[value] = counts[value]! + 1;
  }

  const offsets = new Uint32Array(values.length + 1);
  for (let index = 0; index < counts.length; index += 1) {
    offsets[index + 1] = offsets[index]! + counts[index]!;
  }

  const cursors = offsets.slice(0, values.length);
  const indexes = new Uint32Array(values.length);
  for (let viewIndex = 0; viewIndex < values.length; viewIndex += 1) {
    const storageIndex = values[viewIndex]!;
    const offset = cursors[storageIndex]!;
    indexes[offset] = viewIndex;
    cursors[storageIndex] = offset + 1;
  }
  return { offsets, indexes };
}
