import type {
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";

import { hashStable } from "./deterministic";
import type {
  CompiledSimulationDevice,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationTopologyMigration,
} from "./types";

interface CreateSimulationTopologyMigrationOptions {
  readonly previousDocument: WorldDocument | null;
  readonly nextDocument: WorldDocument;
  readonly previousTopology: CompiledSimulationTopology | null;
  readonly nextTopology: CompiledSimulationTopology;
  readonly baseTickNumber: number;
}

export function createSimulationTopologyMigration(
  options: CreateSimulationTopologyMigrationOptions,
): SimulationTopologyMigration | null {
  if (options.previousDocument === null || options.previousTopology === null) {
    return null;
  }

  const resetDeviceIds = new Set<string>();
  for (const entityId of Object.keys(options.nextDocument.entities).sort()) {
    const previousEntity = options.previousDocument.entities[entityId];
    const nextEntity = options.nextDocument.entities[entityId];
    if (previousEntity === undefined || nextEntity === undefined) {
      continue;
    }

    const deviceId = `device:${entityId}`;
    if (
      hasEntityRuntimeShapeChanged({
        previousEntity,
        nextEntity,
        previousTopology: options.previousTopology,
        nextTopology: options.nextTopology,
        deviceId,
      })
      || createDocumentSlotLinkSignature(options.previousDocument, entityId)
        !== createDocumentSlotLinkSignature(options.nextDocument, entityId)
    ) {
      resetDeviceIds.add(deviceId);
    }
  }

  return {
    baseTickNumber: Math.max(0, Math.trunc(options.baseTickNumber)),
    resetDeviceIds: [...resetDeviceIds].sort(),
  };
}

function hasEntityRuntimeShapeChanged(options: {
  readonly previousEntity: WorldEntity;
  readonly nextEntity: WorldEntity;
  readonly previousTopology: CompiledSimulationTopology;
  readonly nextTopology: CompiledSimulationTopology;
  readonly deviceId: string;
}): boolean {
  if (options.previousEntity.definitionId !== options.nextEntity.definitionId) {
    return true;
  }

  const previousDevice = options.previousTopology.devices[options.deviceId];
  const nextDevice = options.nextTopology.devices[options.deviceId];
  if (previousDevice === undefined || nextDevice === undefined) {
    return true;
  }

  return createDeviceRuntimeShapeSignature(options.previousTopology, previousDevice)
    !== createDeviceRuntimeShapeSignature(options.nextTopology, nextDevice);
}

function createDeviceRuntimeShapeSignature(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): string {
  const slotIds = listDeviceSlotIds(topology, device).sort();
  const slotIdSet = new Set(slotIds);
  const linkSignatureInput = Object.values(topology.links)
    .filter((link) =>
      link.sourceSlotIds.some((slotId) => slotIdSet.has(slotId))
      || link.targetSlotIds.some((slotId) => slotIdSet.has(slotId)),
    )
    .map((link) => ({
      id: link.id,
      linkType: link.linkType,
      sourceSlotIds: [...link.sourceSlotIds].sort(),
      targetSlotIds: [...link.targetSlotIds].sort(),
      targetSlotIdBySourceSlotId: link.targetSlotIdBySourceSlotId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return hashStable({
    definitionId: device.definitionId,
    nodeIds: [...device.nodeIds].sort(),
    ingredientNodeIds: [...device.ingredientNodeIds].sort(),
    productNodeIds: [...device.productNodeIds].sort(),
    slots: slotIds.map((slotId) => createSlotRuntimeShape(topology.slots[slotId])),
    links: linkSignatureInput,
  });
}

function createSlotRuntimeShape(slot: CompiledSimulationSlot | undefined): unknown {
  if (slot === undefined) {
    return null;
  }

  return {
    id: slot.id,
    nodeId: slot.nodeId,
    sourceStorageSlotGroupId: slot.sourceStorageSlotGroupId,
    sourceSlotId: slot.sourceSlotId,
    capacity: slot.capacity,
    domain: slot.domain,
    lock: slot.lock,
    initialItemType: slot.initialItemType,
    initialCount: slot.initialCount,
    ignoreStock: slot.ignoreStock,
    submitMode: slot.submitMode,
    submitIntervalTicks: slot.submitIntervalTicks,
  };
}

function createDocumentSlotLinkSignature(
  document: WorldDocument,
  entityId: string,
): string {
  return hashStable(document.slotLinks
    .filter((link) => isLinkRelatedToEntity(link, entityId))
    .map((link) => ({
      id: link.id,
      linkType: link.linkType,
      source: link.source,
      target: link.target,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

function isLinkRelatedToEntity(
  link: SlotLinkDefinition,
  entityId: string,
): boolean {
  return link.source.entityId === entityId || link.target.entityId === entityId;
}

function listDeviceSlotIds(
  topology: CompiledSimulationTopology,
  device: CompiledSimulationDevice,
): string[] {
  return device.nodeIds.flatMap((nodeId) => topology.nodes[nodeId]?.slotIds ?? []);
}
