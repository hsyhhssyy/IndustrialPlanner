import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import {
  type SlotLinkDefinition,
  WORLD_DOCUMENT_SCHEMA_VERSION,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { rotateGridRotation } from "@/shared/geometry/grid";
import type {
  BlueprintSimulationReport,
  BlueprintSimulationTickReport,
} from "./blueprint-runner";

export type DeviceStatus = BlueprintSimulationTickReport["devices"][string];
export type DeviceSlotItem = DeviceStatus["slotItems"][number];

/**
 * 创建仓库物品 slot link（设备槽位 → 仓库物品槽位）。
 * 用于替代旧 config["links[N].*"] 方式。
 */
export function createWarehouseSlotLink(entityId: string, itemId: string, storageSlotGroupId = "unloader_buffer", slotId = "slot_1"): SlotLinkDefinition {
  return {
    id: `warehouse-link:${entityId}:${storageSlotGroupId}:${slotId}`,
    linkType: "share-all",
    source: { entityId, storageSlotGroupId, slotId },
    target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: itemId },
  };
}

export const BASE_ID = "wuling_protocol_core";
export const TIMESTAMP = new Date(0).toISOString();

// AI-CORRECTION 2026-09-11: 这些历史 simulation 夹具按 AKEData 校准前的默认端口布局书写。
// 端口 registry 已统一到 raw 坐标；将夹具实体显式转 180°，保持测试场景的世界连接语义。
const LEGACY_DEFAULT_ORIENTATION_FIXTURE_IDS = new Set([
  "storager_1",
  "mix_pool_1",
  "grinder_1",
  "liquid_filling_pd_mc_1",
  "filling_pd_mc_1",
  "udpipe_loader_1",
  "udpipe_unloader_1",
  "furnance_1",
  "liquid_furnance_1",
  "cmpt_mc_1",
  "shaper_1",
  "shaper_1_gas",
  "seedcol_1",
  "planter_1",
  "hydro_planter_1",
  "winder_1",
  "tools_asm_mc_1",
  "thickener_1",
  "power_sta_1",
  "mix_pool_2",
  "liquid_purifier_1",
  "liquid_purifier_1_gas",
  "xiranite_oven_1",
  "dismantler_1",
  "transmuter_2_gastrans",
  "transmuter_2_solidtrans",
  "gas_reactor_1",
  "transmuter_1_gastrans",
  "transmuter_1_liquidtrans",
  "water_pump_1",
  "udpipe_loader_2",
  "udpipe_unloader_2",
  "liquid_cleaner_1",
  "liquid_storager_1",
  "gas_storager_1",
  "vaporizer_1",
  "gas_pump_1",
]);

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
  return {
    id,
    definitionId,
    position: { x, y },
    rotation: LEGACY_DEFAULT_ORIENTATION_FIXTURE_IDS.has(definitionId)
      ? rotateGridRotation(rotation, 180)
      : rotation,
    config,
    tags: [],
  };
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

export function resolveFirstTickNumberAtSimulationMilliseconds(
  standardTickRate: number,
  elapsedMilliseconds: number,
): number {
  if (!Number.isSafeInteger(standardTickRate) || standardTickRate <= 0) {
    throw new Error(
      `Expected standardTickRate to be a positive safe integer, received: ${standardTickRate}.`,
    );
  }
  if (!Number.isSafeInteger(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw new Error(
      `Expected elapsedMilliseconds to be a non-negative safe integer, received: ${elapsedMilliseconds}.`,
    );
  }

  const scaledTickOffset = elapsedMilliseconds * standardTickRate;
  if (
    !Number.isSafeInteger(scaledTickOffset)
    || scaledTickOffset % 1_000 !== 0
  ) {
    throw new Error(
      `Simulation time ${elapsedMilliseconds}ms is not exactly representable at ${standardTickRate} TPS.`,
    );
  }

  return (scaledTickOffset / 1_000) + 1;
}

export function resolveSimulationMillisecondsAtFirstTick(
  standardTickRate: number,
  tickNumber: number,
): number {
  if (!Number.isSafeInteger(standardTickRate) || standardTickRate <= 0) {
    throw new Error(
      `Expected standardTickRate to be a positive safe integer, received: ${standardTickRate}.`,
    );
  }
  if (!Number.isSafeInteger(tickNumber) || tickNumber < 1) {
    throw new Error(`Expected tickNumber to be a positive safe integer, received: ${tickNumber}.`);
  }

  const scaledMilliseconds = (tickNumber - 1) * 1_000;
  if (
    !Number.isSafeInteger(scaledMilliseconds)
    || scaledMilliseconds % standardTickRate !== 0
  ) {
    throw new Error(
      `Simulation tick ${tickNumber} is not an exact first-tick millisecond phase at ${standardTickRate} TPS.`,
    );
  }

  return scaledMilliseconds / standardTickRate;
}

/**
 * 返回指定仿真毫秒相位下的第一个执行 tick。
 * tick 1 是 0ms 相位，因此 Legacy 20 TPS 下 500ms/1000ms 分别对应 tick 11/21。
 */
export function getFirstTickAtSimulationMilliseconds(
  report: BlueprintSimulationReport,
  elapsedMilliseconds: number,
): BlueprintSimulationTickReport {
  return getTick(
    report,
    resolveFirstTickNumberAtSimulationMilliseconds(
      report.topology.standardTickRate,
      elapsedMilliseconds,
    ),
  );
  // AI-REMOVED 2026-09-08:
  // Reason: 整数毫秒到第一 tick 的换算需要同时供 Blueprint report 与直接 Host 测试复用。
  // Trigger: 用户要求把 Legacy Worker 门禁测试改为公共 Host 行为矩阵。
  // Evidence: Host 测试只有 topology.standardTickRate，没有 BlueprintSimulationReport。
  // Replacement: resolveFirstTickNumberAtSimulationMilliseconds。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // if (!Number.isSafeInteger(elapsedMilliseconds) || elapsedMilliseconds < 0) {
  //   throw new Error(
  //     `Expected elapsedMilliseconds to be a non-negative safe integer, received: ${elapsedMilliseconds}.`,
  //   );
  // }
  // const scaledTickOffset = elapsedMilliseconds * report.topology.standardTickRate;
  // if (!Number.isSafeInteger(scaledTickOffset) || scaledTickOffset % 1_000 !== 0) {
  //   throw new Error(
  //     `Simulation time ${elapsedMilliseconds}ms is not exactly representable at ${report.topology.standardTickRate} TPS.`,
  //   );
  // }
  // return getTick(report, (scaledTickOffset / 1_000) + 1);
}

export function getLastTick(
  report: BlueprintSimulationReport,
): BlueprintSimulationTickReport {
  const tick = report.ticks.at(-1);
  if (tick === undefined) {
    throw new Error("Expected at least one captured simulation tick.");
  }
  return tick;
}

export function findFirstTick(
  report: BlueprintSimulationReport,
  predicate: (tick: BlueprintSimulationTickReport) => boolean,
): BlueprintSimulationTickReport {
  const tick = report.ticks.find(predicate);
  if (tick === undefined) {
    throw new Error("Expected a simulation tick matching the requested business state.");
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
  extraSlotLinks: readonly SlotLinkDefinition[] = [],
): BlueprintDocument {
  const blueprint = loadBlueprintFromFile(filePath);

  const entities = { ...blueprint.entities };
  const entityOrder = [...blueprint.entityOrder];
  const slotLinks = [...blueprint.slotLinks];

  // 构建 extra entity 的原始 ID → 重命名后 ID 映射
  const extraIdMap = new Map<string, string>();
  for (let i = 0; i < extraEntities.length; i++) {
    const entityId = `test-extra-${i}`;
    const entity: WorldEntity = { ...extraEntities[i]!, id: entityId };
    entities[entityId] = entity;
    entityOrder.push(entityId);
    extraIdMap.set(extraEntities[i]!.id, entityId);
  }

  // 重写 extraSlotLinks 中的 entity ID
  for (const link of extraSlotLinks) {
    const newSourceId = extraIdMap.get(link.source.entityId) ?? link.source.entityId;
    const newTargetId = extraIdMap.get(link.target.entityId) ?? link.target.entityId;
    slotLinks.push({
      ...link,
      source: { ...link.source, entityId: newSourceId },
      target: { ...link.target, entityId: newTargetId },
    });
  }

  return {
    ...blueprint,
    entities,
    entityOrder,
    slotLinks,
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
		schemaVersion: WORLD_DOCUMENT_SCHEMA_VERSION,
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
		regions: blueprint.regions.map((region) => ({
			...region,
			rects: region.rects.map((rect) => ({ ...rect })),
		})),
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
