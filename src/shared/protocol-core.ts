import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import { DRAFT_BOX_BASE_TAG } from "./base-tags";

export const PRIMARY_PROTOCOL_CORE_DEFINITION_ID = "sp_hub_1";
export const SECONDARY_PROTOCOL_CORE_DEFINITION_ID = "sp_sub_hub_1";

const PROTOCOL_CORE_DEFINITION_IDS: ReadonlySet<string> = new Set([
  PRIMARY_PROTOCOL_CORE_DEFINITION_ID,
  SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
]);

const PROTOCOL_CORE_DEFINITION_ID_BY_BASE_ID: Readonly<Record<string, string | null>> = {
  wuling_protocol_core: PRIMARY_PROTOCOL_CORE_DEFINITION_ID,
  wuling_tianwangping_aid: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  wuling_heart_repair_station: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  stm_hongs_3: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  wuling_agricultural_land: null,
  valley4_protocol_core: PRIMARY_PROTOCOL_CORE_DEFINITION_ID,
  valley4_refugee_shelter: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  valley4_infra_outpost: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
  valley4_rebuilt_command: SECONDARY_PROTOCOL_CORE_DEFINITION_ID,
};

export function isProtocolCoreDefinitionId(definitionId: string): boolean {
  return PROTOCOL_CORE_DEFINITION_IDS.has(definitionId);
}

/** 草稿箱核心作为普通设备管理；地区分类与跨地区建筑权限不决定核心规则。 */
export function allowsFreeProtocolCorePlacement(
  baseId: string,
  baseDefinitions: readonly BaseDefinition[],
): boolean {
  return baseDefinitions.find((base) => base.id === baseId)?.tags.includes(DRAFT_BOX_BASE_TAG) === true;
}

/** null 表示该基地禁止两种协议核心；未知基地沿用主核心默认值。 */
export function resolveProtocolCoreDefinitionIdForBase(baseId: string): string | null {
  const definitionId = PROTOCOL_CORE_DEFINITION_ID_BY_BASE_ID[baseId];
  return definitionId === undefined ? PRIMARY_PROTOCOL_CORE_DEFINITION_ID : definitionId;
}

/** 无核心基地的文档约束；清理实体时同时清理顺序和关联连线，保留其余文档内容。 */
export function removeForbiddenProtocolCoreEntities<TDocument extends {
  readonly baseId?: string;
  readonly entities: Readonly<Record<string, WorldEntity>>;
  readonly entityOrder: readonly string[];
  readonly slotLinks: readonly SlotLinkDefinition[];
}>(document: TDocument): TDocument {
  if (document.baseId === undefined || resolveProtocolCoreDefinitionIdForBase(document.baseId) !== null) {
    return document;
  }

  const removedEntityIds = new Set(Object.entries(document.entities)
    .filter(([, entity]) => isProtocolCoreDefinitionId(entity.definitionId))
    .map(([entityId]) => entityId));
  if (removedEntityIds.size === 0) {
    return document;
  }

  return {
    ...document,
    entities: Object.fromEntries(Object.entries(document.entities)
      .filter(([entityId]) => !removedEntityIds.has(entityId))),
    entityOrder: document.entityOrder.filter((entityId) => !removedEntityIds.has(entityId)),
    slotLinks: document.slotLinks.filter((link) =>
      !removedEntityIds.has(link.source.entityId) && !removedEntityIds.has(link.target.entityId)),
  };
}
