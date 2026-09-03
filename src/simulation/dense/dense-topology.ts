import type { RegistryContract } from "@/domain/registry/registry-contract";

import type { CompiledSimulationTopology } from "../types";

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
}

export interface DenseTopologyLayout {
  readonly dictionary: DenseTopologyDictionary;
  readonly deviceNodeOffsets: Uint32Array;
  readonly deviceNodeIndexes: Uint32Array;
  readonly nodeDeviceIndexes: Uint32Array;
  readonly slotNodeIndexes: Uint32Array;
  readonly slotCanonicalIndexes: Uint32Array;
  readonly slotCapacities: Float64Array;
  readonly slotInitialItemIndexes: Int32Array;
  readonly slotInitialCounts: Float64Array;
  readonly slotInitialFlags: Uint8Array;
  readonly edgeSourceNodeIndexes: Uint32Array;
  readonly edgeTargetNodeIndexes: Uint32Array;
  readonly componentDeviceOffsets: Uint32Array;
  readonly componentDeviceIndexes: Uint32Array;
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

  const nodeDeviceIndexes = new Uint32Array(dictionary.nodeIds.length);
  for (let nodeIndex = 0; nodeIndex < dictionary.nodeIds.length; nodeIndex += 1) {
    const nodeId = dictionary.nodeIds[nodeIndex]!;
    const node = requireRecordEntry(topology.nodes, nodeId, "node");
    nodeDeviceIndexes[nodeIndex] = requireDenseIndex(
      lookup.deviceIndexById,
      node.deviceId,
      "device",
    );
  }

  const slotNodeIndexes = new Uint32Array(dictionary.slotIds.length);
  const slotCanonicalIndexes = new Uint32Array(dictionary.slotIds.length);
  const slotCapacities = new Float64Array(dictionary.slotIds.length);
  const slotInitialItemIndexes = new Int32Array(dictionary.slotIds.length);
  const slotInitialCounts = new Float64Array(dictionary.slotIds.length);
  const slotInitialFlags = new Uint8Array(dictionary.slotIds.length);
  slotInitialItemIndexes.fill(DENSE_INDEX_NONE);

  for (let slotIndex = 0; slotIndex < dictionary.slotIds.length; slotIndex += 1) {
    const slotId = dictionary.slotIds[slotIndex]!;
    const slot = requireRecordEntry(topology.slots, slotId, "slot");
    slotCanonicalIndexes[slotIndex] = slotIndex;
    slotNodeIndexes[slotIndex] = requireDenseIndex(lookup.nodeIndexById, slot.nodeId, "node");
    slotCapacities[slotIndex] = slot.capacity;
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

  const edgeSourceNodeIndexes = new Uint32Array(dictionary.edgeIds.length);
  const edgeTargetNodeIndexes = new Uint32Array(dictionary.edgeIds.length);
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
  }

  const componentDeviceOffsets = new Uint32Array(dictionary.componentIds.length + 1);
  const componentDeviceIndexes: number[] = [];
  for (
    let componentIndex = 0;
    componentIndex < dictionary.componentIds.length;
    componentIndex += 1
  ) {
    const componentId = dictionary.componentIds[componentIndex]!;
    const component = requireRecordEntry(topology.transportComponents, componentId, "component");
    componentDeviceOffsets[componentIndex] = componentDeviceIndexes.length;
    for (const deviceId of component.deviceIds) {
      componentDeviceIndexes.push(requireDenseIndex(lookup.deviceIndexById, deviceId, "device"));
    }
  }
  componentDeviceOffsets[dictionary.componentIds.length] = componentDeviceIndexes.length;

  return {
    dictionary,
    deviceNodeOffsets,
    deviceNodeIndexes: Uint32Array.from(deviceNodeIndexes),
    nodeDeviceIndexes,
    slotNodeIndexes,
    slotCanonicalIndexes,
    slotCapacities,
    slotInitialItemIndexes,
    slotInitialCounts,
    slotInitialFlags,
    edgeSourceNodeIndexes,
    edgeTargetNodeIndexes,
    componentDeviceOffsets,
    componentDeviceIndexes: Uint32Array.from(componentDeviceIndexes),
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
  };
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
