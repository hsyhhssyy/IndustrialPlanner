import type { WorldDocument } from "@/domain/document/world-document";
import type { RegistryQuery } from "@/domain/registry/registry-query";

/**
 * 确保文档中包含协议核心实体（item_port_sp_hub_1）。
 * 如果已存在则直接返回原文档，否则在 (0,0) 注入核心并置顶 entityOrder。
 */
export function ensureProtocolCoreEntity(options: {
  document: WorldDocument;
  queries: RegistryQuery;
}): WorldDocument {
  const hasProtocolCore = Object.values(options.document.entities)
    .some((entity) => options.queries.isProtocolCore(entity.definitionId));

  if (hasProtocolCore) {
    return options.document;
  }

  const entityId = `protocol-core:${options.document.baseId}`;

  return {
    ...options.document,
    entities: {
      ...options.document.entities,
      [entityId]: {
        id: entityId,
        definitionId: "item_port_sp_hub_1",
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
