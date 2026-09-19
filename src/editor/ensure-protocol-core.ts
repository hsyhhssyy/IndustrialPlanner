import type { WorldDocument } from "@/domain/document/world-document";
import type { RegistryQuery } from "@/domain/registry/registry-query";
import { resolveProtocolCoreDefinitionIdForBase } from "@/shared/protocol-core";

/**
 * 确保文档中包含协议核心实体（item_port_sp_hub_1）。
 * AI-CORRECTION 2026-07-19: 当前协议核心设备定义 ID 为 sp_hub_1；上行保留迁移前名称。
 * 如果已存在则直接返回原文档，否则在 (0,0) 注入核心并置顶 entityOrder。
 * AI-CORRECTION 2026-09-18: 核心类型由基地决定；已有错误类型原位替换，多余核心同步清理。
 */
export function ensureProtocolCoreEntity(options: {
  document: WorldDocument;
  queries: RegistryQuery;
}): WorldDocument {
  const expectedDefinitionId = resolveProtocolCoreDefinitionIdForBase(
    options.document.baseId,
  );
  const protocolCoreEntityIds = Object.values(options.document.entities)
    .filter((entity) => options.queries.isProtocolCore(entity.definitionId))
    .map((entity) => entity.id);

  if (protocolCoreEntityIds.length > 0) {
    const retainedEntityId = resolveRetainedProtocolCoreEntityId({
      document: options.document,
      protocolCoreEntityIds,
      expectedDefinitionId,
    });
    const retainedEntity = options.document.entities[retainedEntityId];
    if (retainedEntity === undefined) {
      return options.document;
    }

    const removedEntityIds = new Set(
      protocolCoreEntityIds.filter((entityId) => entityId !== retainedEntityId),
    );
    if (
      retainedEntity.definitionId === expectedDefinitionId
      && removedEntityIds.size === 0
    ) {
      return options.document;
    }

    const entities = { ...options.document.entities };
    entities[retainedEntityId] = {
      ...retainedEntity,
      definitionId: expectedDefinitionId,
    };
    for (const entityId of removedEntityIds) {
      delete entities[entityId];
    }

    const entityOrder = Array.from(new Set(
      options.document.entityOrder.filter((entityId) => !removedEntityIds.has(entityId)),
    ));
    if (!entityOrder.includes(retainedEntityId)) {
      entityOrder.unshift(retainedEntityId);
    }

    return {
      ...options.document,
      entities,
      entityOrder,
      slotLinks: options.document.slotLinks.filter((link) =>
        !removedEntityIds.has(link.source.entityId)
        && !removedEntityIds.has(link.target.entityId),
      ),
    };
  }

  // AI-REMOVED 2026-09-18:
  // Reason: 任意一种协议核心都不再足以满足基地约束；必须核对该基地指定的核心类型。
  // Trigger: 武陵与四号谷地各六个非协议核心区基地改用次级协议核心。
  // AI-CORRECTION 2026-09-18: 上行“各六个”应为各三个、合计六个基地。
  // Evidence: resolveProtocolCoreDefinitionIdForBase 为八个基地给出唯一目标类型。
  // Replacement: 上方 protocolCoreEntityIds 归一化分支。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const hasProtocolCore = Object.values(options.document.entities)
  //   .some((entity) => options.queries.isProtocolCore(entity.definitionId));
  //
  // if (hasProtocolCore) {
  //   return options.document;
  // }

  const entityId = `protocol-core:${options.document.baseId}`;

  return {
    ...options.document,
    entities: {
      ...options.document.entities,
      [entityId]: {
        id: entityId,
        definitionId: expectedDefinitionId,
        position: { x: 0, y: 0 },
        rotation: 0,
        config: {},
        tags: [],
      },
    },
    entityOrder: options.document.entityOrder.includes(entityId)
      ? options.document.entityOrder
      : [entityId, ...options.document.entityOrder],
  };
}

function resolveRetainedProtocolCoreEntityId(options: {
  readonly document: WorldDocument;
  readonly protocolCoreEntityIds: readonly string[];
  readonly expectedDefinitionId: string;
}): string {
  const protocolCoreEntityIdSet = new Set(options.protocolCoreEntityIds);
  const orderedEntityIds = [
    ...options.document.entityOrder.filter((entityId) => protocolCoreEntityIdSet.has(entityId)),
    ...options.protocolCoreEntityIds,
  ];
  const expectedEntityId = orderedEntityIds.find((entityId) =>
    options.document.entities[entityId]?.definitionId === options.expectedDefinitionId,
  );

  return expectedEntityId ?? orderedEntityIds[0]!;
}
