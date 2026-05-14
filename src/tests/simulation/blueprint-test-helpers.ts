import {
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import type {
  SlotLinkDefinition,
  WorldEntity,
} from "@/domain/document/world-document";
import type {
  BlueprintSimulationReport,
  BlueprintSimulationTickReport,
} from "@/simulation/blueprint-runner";

export type DeviceStatus = BlueprintSimulationTickReport["devices"][string];
export type DeviceSlotItem = DeviceStatus["slotItems"][number];

export const BASE_ID = "wuling_protocol_core";
export const TIMESTAMP = new Date(0).toISOString();

export function createBlueprint(
  name: string,
  entities: readonly WorldEntity[],
  slotLinks: readonly SlotLinkDefinition[] = [],
): BlueprintDocument {
  return createBlueprintDocument({
    blueprintId: `req-076-${name}`,
    name,
    description: "",
    baseId: BASE_ID,
    initialGridPoint: { x: 0, y: 0 },
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])) as Record<string, WorldEntity>,
    entityOrder: entities.map((entity) => entity.id),
    slotLinks: [...slotLinks],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  });
}

export function createEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
  rotation: WorldEntity["rotation"] = 0,
  config: WorldEntity["config"] = {},
): WorldEntity {
  return { id, definitionId, position: { x, y }, rotation, config, tags: [] };
}

export function getTick(
  report: BlueprintSimulationReport,
  tickNumber: number,
): BlueprintSimulationTickReport {
  const tick = report.ticks.find((candidate) => candidate.tickNumber === tickNumber);
  if (tick === undefined) {
    throw new Error(`Expected tick ${tickNumber} to be captured.`);
  }
  return tick;
}

export function getDevice(
  report: BlueprintSimulationReport,
  tickNumber: number,
  deviceId: string,
): DeviceStatus {
  const device = getTick(report, tickNumber).devices[deviceId];
  if (device === undefined) {
    throw new Error(`Expected ${deviceId} to be projected at tick ${tickNumber}.`);
  }
  return device;
}

export function findSlot(
  report: BlueprintSimulationReport,
  tickNumber: number,
  deviceId: string,
  storageGroupId: string,
  slotId: string,
  viewRole?: DeviceSlotItem["viewRole"],
): DeviceSlotItem {
  const slot = getDevice(report, tickNumber, deviceId).slotItems.find((candidate) =>
    candidate.storageGroupId === storageGroupId
    && candidate.slotId === slotId
    && (viewRole === undefined || candidate.viewRole === viewRole),
  );
  if (slot === undefined) {
    throw new Error(`Expected ${deviceId}:${storageGroupId}:${slotId} at tick ${tickNumber}.`);
  }
  return slot;
}

export function findSlotWithItem(
  report: BlueprintSimulationReport,
  tickNumber: number,
  deviceId: string,
  itemType: string,
): DeviceSlotItem {
  const slot = getDevice(report, tickNumber, deviceId).slotItems.find((candidate) =>
    candidate.itemType === itemType && candidate.count > 0,
  );
  if (slot === undefined) {
    throw new Error(`Expected ${deviceId} to contain ${itemType} at tick ${tickNumber}.`);
  }
  return slot;
}
