import type {
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import { isBaseBuiltinEntityId } from "@/domain/registry/types/base-definition";

export interface UnknownWorldEntityDefinitionIssue {
  readonly entityId: string;
  readonly definitionId: string;
  readonly position: WorldEntity["position"];
  readonly relatedSlotLinkCount: number;
  readonly origin: "document" | "base-builtin";
}

export interface WorldDocumentUnknownEntityAdmission {
  readonly document: WorldDocument;
  readonly issues: readonly UnknownWorldEntityDefinitionIssue[];
  readonly excludedIssues: readonly UnknownWorldEntityDefinitionIssue[];
}

export function collectUnknownWorldEntityDefinitionIssues(options: {
  readonly document: WorldDocument;
  readonly entityDefinitions: readonly { readonly id: string }[];
}): UnknownWorldEntityDefinitionIssue[] {
  const knownDefinitionIds = new Set(
    options.entityDefinitions.map((definition) => definition.id),
  );

  return Object.values(options.document.entities)
    .filter((entity) => !knownDefinitionIds.has(entity.definitionId))
    .map((entity) => ({
      entityId: entity.id,
      definitionId: entity.definitionId,
      position: { ...entity.position },
      relatedSlotLinkCount: countRelatedSlotLinks(options.document.slotLinks, entity.id),
      origin: isBaseBuiltinEntityId(entity.id)
        ? "base-builtin" as const
        : "document" as const,
    }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
}

/**
 * 只在返回的编译副本中隔离定义缺失的普通文档实体；系统内建设备继续保留，
 * 让拓扑编译器把 Registry 不一致作为不可恢复错误报告。
 */
export function admitWorldDocumentForSimulation(options: {
  readonly document: WorldDocument;
  readonly entityDefinitions: readonly { readonly id: string }[];
}): WorldDocumentUnknownEntityAdmission {
  const issues = collectUnknownWorldEntityDefinitionIssues(options);
  const excludedIssues = issues.filter((issue) => issue.origin === "document");
  if (excludedIssues.length === 0) {
    return {
      document: options.document,
      issues,
      excludedIssues,
    };
  }

  const excludedEntityIds = new Set(excludedIssues.map((issue) => issue.entityId));
  const entities = Object.fromEntries(
    Object.entries(options.document.entities).filter(
      ([entityId]) => !excludedEntityIds.has(entityId),
    ),
  );

  return {
    document: {
      ...options.document,
      entities,
      entityOrder: options.document.entityOrder.filter(
        (entityId) => !excludedEntityIds.has(entityId),
      ),
      slotLinks: options.document.slotLinks.filter((slotLink) =>
        !excludedEntityIds.has(slotLink.source.entityId)
        && !excludedEntityIds.has(slotLink.target.entityId)
      ),
    },
    issues,
    excludedIssues,
  };
}

function countRelatedSlotLinks(
  slotLinks: readonly SlotLinkDefinition[],
  entityId: string,
): number {
  return slotLinks.filter((slotLink) =>
    slotLink.source.entityId === entityId
    || slotLink.target.entityId === entityId
  ).length;
}
