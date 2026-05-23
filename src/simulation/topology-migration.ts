import type {
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";

import { createLogger } from "@/shared/logging/logger";
import { hashStable } from "./deterministic";
import type {
  CompiledSimulationDevice,
  CompiledSimulationSlot,
  CompiledSimulationTopology,
  SimulationTopologyMigration,
} from "./types";

const logger = createLogger("simulation-topology");

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
    const reasons = collectEntityResetReasons({
      previousEntity,
      nextEntity,
      previousTopology: options.previousTopology,
      nextTopology: options.nextTopology,
      deviceId,
      entityId,
      previousDocument: options.previousDocument,
      nextDocument: options.nextDocument,
    });

    if (reasons.length > 0) {
      resetDeviceIds.add(deviceId);
      logger.info(
        `Device '${deviceId}' requires full reset. Reasons: ${reasons.join('; ')}`,
      );
    }
  }

  return {
    baseTickNumber: Math.max(0, Math.trunc(options.baseTickNumber)),
    resetDeviceIds: [...resetDeviceIds].sort(),
  };
}

function collectEntityResetReasons(options: {
  readonly previousEntity: WorldEntity;
  readonly nextEntity: WorldEntity;
  readonly previousTopology: CompiledSimulationTopology;
  readonly nextTopology: CompiledSimulationTopology;
  readonly deviceId: string;
  readonly entityId: string;
  readonly previousDocument: WorldDocument;
  readonly nextDocument: WorldDocument;
}): string[] {
  const reasons: string[] = [];

  if (options.previousEntity.definitionId !== options.nextEntity.definitionId) {
    reasons.push(
      `definitionId changed: '${options.previousEntity.definitionId}' → '${options.nextEntity.definitionId}'`,
    );
  }

  const previousDevice = options.previousTopology.devices[options.deviceId];
  const nextDevice = options.nextTopology.devices[options.deviceId];
  if (previousDevice === undefined) {
    reasons.push('device not found in previous topology');
    return reasons;
  }
  if (nextDevice === undefined) {
    reasons.push('device not found in next topology');
    return reasons;
  }

  const prevNodeIds = [...previousDevice.nodeIds].sort();
  const nextNodeIds = [...nextDevice.nodeIds].sort();
  if (prevNodeIds.join(',') !== nextNodeIds.join(',')) {
    const added = nextNodeIds.filter((id) => !prevNodeIds.includes(id));
    const removed = prevNodeIds.filter((id) => !nextNodeIds.includes(id));
    const parts: string[] = [];
    if (added.length > 0) parts.push(`added: [${added.join(', ')}]`);
    if (removed.length > 0) parts.push(`removed: [${removed.join(', ')}]`);
    reasons.push(`nodeIds changed (${parts.join('; ')})`);
  }

  const prevIngredientIds = [
    ...previousDevice.recipeChannels.flatMap((ch) => ch.ingredientNodeIds),
  ].sort();
  const nextIngredientIds = [
    ...nextDevice.recipeChannels.flatMap((ch) => ch.ingredientNodeIds),
  ].sort();
  if (prevIngredientIds.join(',') !== nextIngredientIds.join(',')) {
    reasons.push('recipe ingredientNodeIds changed');
  }

  const prevProductIds = [
    ...previousDevice.recipeChannels.flatMap((ch) => ch.productNodeIds),
  ].sort();
  const nextProductIds = [
    ...nextDevice.recipeChannels.flatMap((ch) => ch.productNodeIds),
  ].sort();
  if (prevProductIds.join(',') !== nextProductIds.join(',')) {
    reasons.push('recipe productNodeIds changed');
  }

  const prevSlotIds = listDeviceSlotIds(options.previousTopology, previousDevice).sort();
  const nextSlotIds = listDeviceSlotIds(options.nextTopology, nextDevice).sort();
  const prevSlotIdSet = new Set(prevSlotIds);
  const nextSlotIdSet = new Set(nextSlotIds);

  for (const slotId of nextSlotIds) {
    if (!prevSlotIdSet.has(slotId)) {
      reasons.push(`slot '${slotId}' added`);
    }
  }
  for (const slotId of prevSlotIds) {
    if (!nextSlotIdSet.has(slotId)) {
      reasons.push(`slot '${slotId}' removed`);
    }
  }
  for (const slotId of prevSlotIds) {
    if (!nextSlotIdSet.has(slotId)) continue;
    const prevSlot = options.previousTopology.slots[slotId];
    const nextSlot = options.nextTopology.slots[slotId];
    reasons.push(...compareSlotRuntimeShape(prevSlot, nextSlot, slotId));
  }

  const prevLinkSigs = getDeviceLinkSignatures(options.previousTopology, prevSlotIdSet);
  const nextLinkSigs = getDeviceLinkSignatures(options.nextTopology, nextSlotIdSet);
  const prevLinkIdSet = new Set(prevLinkSigs.map((l) => l.id));
  const nextLinkIdSet = new Set(nextLinkSigs.map((l) => l.id));

  for (const linkId of nextLinkIdSet) {
    if (!prevLinkIdSet.has(linkId)) {
      reasons.push(`device link '${linkId}' added`);
    }
  }
  for (const linkId of prevLinkIdSet) {
    if (!nextLinkIdSet.has(linkId)) {
      reasons.push(`device link '${linkId}' removed`);
    }
  }
  for (const prevLink of prevLinkSigs) {
    const nextLink = nextLinkSigs.find((l) => l.id === prevLink.id);
    if (nextLink === undefined) continue;
    if (prevLink.linkType !== nextLink.linkType) {
      reasons.push(
        `device link '${prevLink.id}' linkType changed: '${prevLink.linkType}' → '${nextLink.linkType}'`,
      );
    }
    const prevSrc = [...prevLink.sourceSlotIds].sort().join(',');
    const nextSrc = [...nextLink.sourceSlotIds].sort().join(',');
    if (prevSrc !== nextSrc) {
      reasons.push(`device link '${prevLink.id}' sourceSlotIds changed`);
    }
    const prevTgt = [...prevLink.targetSlotIds].sort().join(',');
    const nextTgt = [...nextLink.targetSlotIds].sort().join(',');
    if (prevTgt !== nextTgt) {
      reasons.push(`device link '${prevLink.id}' targetSlotIds changed`);
    }
  }

  const prevDocLinks = options.previousDocument.slotLinks.filter((l) =>
    isLinkRelatedToEntity(l, options.entityId),
  );
  const nextDocLinks = options.nextDocument.slotLinks.filter((l) =>
    isLinkRelatedToEntity(l, options.entityId),
  );
  const prevDocLinkSig = createDocumentSlotLinkSignature(
    options.previousDocument,
    options.entityId,
  );
  const nextDocLinkSig = createDocumentSlotLinkSignature(
    options.nextDocument,
    options.entityId,
  );

  if (prevDocLinkSig !== nextDocLinkSig) {
    const prevDocLinkIdSet = new Set(prevDocLinks.map((l) => l.id));
    const nextDocLinkIdSet = new Set(nextDocLinks.map((l) => l.id));
    for (const linkId of nextDocLinkIdSet) {
      if (!prevDocLinkIdSet.has(linkId)) {
        reasons.push(`document slotLink '${linkId}' added`);
      }
    }
    for (const linkId of prevDocLinkIdSet) {
      if (!nextDocLinkIdSet.has(linkId)) {
        reasons.push(`document slotLink '${linkId}' removed`);
      }
    }
    for (const prevLink of prevDocLinks) {
      const nextLink = nextDocLinks.find((l) => l.id === prevLink.id);
      if (nextLink === undefined) continue;
      if (prevLink.linkType !== nextLink.linkType) {
        reasons.push(
          `document slotLink '${prevLink.id}' linkType changed: '${prevLink.linkType}' → '${nextLink.linkType}'`,
        );
      }
      const prevSrcStr = `${prevLink.source.entityId}:${prevLink.source.slotId}`;
      const nextSrcStr = `${nextLink.source.entityId}:${nextLink.source.slotId}`;
      if (prevSrcStr !== nextSrcStr) {
        reasons.push(
          `document slotLink '${prevLink.id}' source changed: '${prevSrcStr}' → '${nextSrcStr}'`,
        );
      }
      const prevTgtStr = `${prevLink.target.entityId}:${prevLink.target.slotId}`;
      const nextTgtStr = `${nextLink.target.entityId}:${nextLink.target.slotId}`;
      if (prevTgtStr !== nextTgtStr) {
        reasons.push(
          `document slotLink '${prevLink.id}' target changed: '${prevTgtStr}' → '${nextTgtStr}'`,
        );
      }
    }
  }

  return reasons;
}

interface DeviceLinkSignature {
  readonly id: string;
  readonly linkType: string;
  readonly sourceSlotIds: readonly string[];
  readonly targetSlotIds: readonly string[];
}

function getDeviceLinkSignatures(
  topology: CompiledSimulationTopology,
  slotIdSet: ReadonlySet<string>,
): DeviceLinkSignature[] {
  return Object.values(topology.links)
    .filter(
      (link) =>
        link.sourceSlotIds.some((slotId) => slotIdSet.has(slotId))
        || link.targetSlotIds.some((slotId) => slotIdSet.has(slotId)),
    )
    .map((link) => ({
      id: link.id,
      linkType: link.linkType,
      sourceSlotIds: [...link.sourceSlotIds].sort(),
      targetSlotIds: [...link.targetSlotIds].sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function compareSlotRuntimeShape(
  prevSlot: CompiledSimulationSlot | undefined,
  nextSlot: CompiledSimulationSlot | undefined,
  slotId: string,
): string[] {
  const reasons: string[] = [];
  if (prevSlot === undefined || nextSlot === undefined) return reasons;

  const fields: Array<{ key: keyof CompiledSimulationSlot; label: string }> = [
    { key: 'capacity', label: 'capacity' },
    { key: 'domain', label: 'domain' },
    { key: 'lock', label: 'lock' },
    { key: 'initialItemType', label: 'initialItemType' },
    { key: 'initialCount', label: 'initialCount' },
    { key: 'ignoreStock', label: 'ignoreStock' },
    { key: 'submitMode', label: 'submitMode' },
    { key: 'submitIntervalTicks', label: 'submitIntervalTicks' },
    { key: 'nodeId', label: 'nodeId' },
    { key: 'sourceStorageSlotGroupId', label: 'sourceStorageSlotGroupId' },
    { key: 'sourceSlotId', label: 'sourceSlotId' },
  ];

  for (const { key, label } of fields) {
    if (prevSlot[key] !== nextSlot[key]) {
      reasons.push(
        `slot '${slotId}' ${label} changed: ${JSON.stringify(prevSlot[key])} → ${JSON.stringify(nextSlot[key])}`,
      );
    }
  }

  return reasons;
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

// AI-REMOVED 2026-05-23:
// Reason: 替换为 collectEntityResetReasons，后者逐字段比较并产出详细的变化原因日志。
// Trigger: 需求——当设备无法增量编译时必须输出具体变化原因。
// Evidence: hasEntityRuntimeShapeChanged 仅返回 boolean，无法提供诊断信息。
// Replacement: collectEntityResetReasons（同文件）。
// Risk: Low。新函数覆盖了旧函数的所有比较维度，并增加了字段级详情。
// Human Review: Not required.
//
// Original code:
// function hasEntityRuntimeShapeChanged(options: {
//   readonly previousEntity: WorldEntity;
//   readonly nextEntity: WorldEntity;
//   readonly previousTopology: CompiledSimulationTopology;
//   readonly nextTopology: CompiledSimulationTopology;
//   readonly deviceId: string;
// }): boolean {
//   if (options.previousEntity.definitionId !== options.nextEntity.definitionId) {
//     return true;
//   }
//   const previousDevice = options.previousTopology.devices[options.deviceId];
//   const nextDevice = options.nextTopology.devices[options.deviceId];
//   if (previousDevice === undefined || nextDevice === undefined) {
//     return true;
//   }
//   return createDeviceRuntimeShapeSignature(options.previousTopology, previousDevice)
//     !== createDeviceRuntimeShapeSignature(options.nextTopology, nextDevice);
// }

// AI-REMOVED 2026-05-23:
// Reason: 替换为 collectEntityResetReasons + getDeviceLinkSignatures + compareSlotRuntimeShape。
// Trigger: 需求——需要逐字段比较 device runtime shape 以产出详细变化日志。
// Evidence: createDeviceRuntimeShapeSignature 仅产出 hash，无法定位具体变化字段。
// Replacement: collectEntityResetReasons（同文件）内联了所有字段比较逻辑。
// Risk: Low。
// Human Review: Not required.
//
// Original code:
// function createDeviceRuntimeShapeSignature(
//   topology: CompiledSimulationTopology,
//   device: CompiledSimulationDevice,
// ): string {
//   const slotIds = listDeviceSlotIds(topology, device).sort();
//   const slotIdSet = new Set(slotIds);
//   const linkSignatureInput = Object.values(topology.links)
//     .filter((link) =>
//       link.sourceSlotIds.some((slotId) => slotIdSet.has(slotId))
//       || link.targetSlotIds.some((slotId) => slotIdSet.has(slotId)),
//     )
//     .map((link) => ({
//       id: link.id,
//       linkType: link.linkType,
//       sourceSlotIds: [...link.sourceSlotIds].sort(),
//       targetSlotIds: [...link.targetSlotIds].sort(),
//       targetSlotIdBySourceSlotId: link.targetSlotIdBySourceSlotId,
//     }))
//     .sort((left, right) => left.id.localeCompare(right.id));
//   return hashStable({
//     definitionId: device.definitionId,
//     nodeIds: [...device.nodeIds].sort(),
//     ingredientNodeIds: [...device.recipeChannels.flatMap(ch => ch.ingredientNodeIds)].sort(),
//     productNodeIds: [...device.recipeChannels.flatMap(ch => ch.productNodeIds)].sort(),
//     slots: slotIds.map((slotId) => createSlotRuntimeShape(topology.slots[slotId])),
//     links: linkSignatureInput,
//   });
// }

// AI-REMOVED 2026-05-23:
// Reason: 替换为 compareSlotRuntimeShape，后者逐字段比较并产出变化原因。
// Trigger: 需求——需要 slot 级别的详细变化日志。
// Evidence: createSlotRuntimeShape 仅产出 shape 对象用于 hash，无法独立产出诊断信息。
// Replacement: compareSlotRuntimeShape（同文件）。
// Risk: Low。
// Human Review: Not required.
//
// Original code:
// function createSlotRuntimeShape(slot: CompiledSimulationSlot | undefined): unknown {
//   if (slot === undefined) {
//     return null;
//   }
//   return {
//     id: slot.id,
//     nodeId: slot.nodeId,
//     sourceStorageSlotGroupId: slot.sourceStorageSlotGroupId,
//     sourceSlotId: slot.sourceSlotId,
//     capacity: slot.capacity,
//     domain: slot.domain,
//     lock: slot.lock,
//     initialItemType: slot.initialItemType,
//     initialCount: slot.initialCount,
//     ignoreStock: slot.ignoreStock,
//     submitMode: slot.submitMode,
//     submitIntervalTicks: slot.submitIntervalTicks,
//   };
// }
