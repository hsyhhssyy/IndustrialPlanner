import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import type {
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import type {
  BlueprintSimulationReport,
  BlueprintSimulationTickReport,
} from "./blueprint-runner";

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

/**
 * 从 JSON 文件路径加载并校验 BlueprintDocument。
 * 内部使用 normalizeBlueprintDocument 进行运行时校验。
 */
export function loadBlueprintFromFile(filePath: string): BlueprintDocument {
  const absolutePath = resolve(filePath);
  let content: string;
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    throw new Error(`Cannot read blueprint file: ${absolutePath}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Invalid JSON in blueprint file: ${absolutePath}`);
  }

  const blueprint = normalizeBlueprintDocument(payload);
  if (blueprint === null) {
    throw new Error(`Blueprint document validation failed: ${absolutePath}`);
  }

  return blueprint;
}

/**
 * 加载蓝图文件并注入额外设备，返回合并后的 BlueprintDocument。
 *
 * 用于测试场景：蓝图本身不完整（缺少供料/消耗设施），通过 extraEntities
 * 在测试中补全所需设备，而不修改原始蓝图文件。
 *
 * extraEntities 会生成 test-extra-{index} 格式的 ID，不会与蓝图中已有的
 * legacy_ 前缀实体冲突。
 */
export function loadBlueprintWithExtras(
  filePath: string,
  extraEntities: readonly WorldEntity[],
): BlueprintDocument {
  const blueprint = loadBlueprintFromFile(filePath);

  const entities = { ...blueprint.entities };
  const entityOrder = [...blueprint.entityOrder];

  for (let i = 0; i < extraEntities.length; i++) {
    const entityId = `test-extra-${i}`;
    const entity: WorldEntity = { ...extraEntities[i]!, id: entityId };
    entities[entityId] = entity;
    entityOrder.push(entityId);
  }

  return {
    ...blueprint,
    entities,
    entityOrder,
  };
}

// ===============================
// Blueprint → WorldDocument 转换
// ===============================

/**
 * 将 BlueprintDocument 转换为 WorldDocument，用于仿真测试。
 */
export function createWorldDocumentFromBlueprint(
	blueprint: BlueprintDocument,
): WorldDocument {
	return {
		schemaVersion: 1,
		documentKey: blueprint.blueprintId,
		baseId: blueprint.baseId,
		meta: {
			id: `blueprint-${blueprint.blueprintId}`,
			name: blueprint.name,
			createdAt: blueprint.createdAt,
			updatedAt: blueprint.updatedAt,
		},
		entities: cloneBlueprintEntities(blueprint.entities),
		entityOrder: [...blueprint.entityOrder],
		slotLinks: blueprint.slotLinks.map(cloneSlotLinkDefinition),
		documentSettings: {
			viewport: {
				center: {
					x: 0,
					y: 0,
				},
				gridSize: 1,
				displayRotation: 0,
			},
			powerMode: "infinite",
		},
	};
}

function cloneBlueprintEntities(
	entities: BlueprintDocument["entities"],
): Record<string, WorldEntity> {
	const nextEntities: Record<string, WorldEntity> = {};

	for (const [entityId, entity] of Object.entries(entities)) {
		nextEntities[entityId] = {
			...entity,
			position: {
				x: entity.position.x,
				y: entity.position.y,
			},
			config: { ...entity.config },
			tags: [...entity.tags],
		};
	}

	return nextEntities;
}

function cloneSlotLinkDefinition(slotLink: SlotLinkDefinition): SlotLinkDefinition {
	return {
		...slotLink,
		source: {
			...slotLink.source,
		},
		target: {
			...slotLink.target,
		},
	};
}
