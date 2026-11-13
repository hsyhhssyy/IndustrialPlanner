import type { WorldEntity } from "@/domain/document/world-document";

export interface DraftEntity extends WorldEntity {
  originalEntityId: string;
  /** 调用方显式指定的单体身份，确认时禁止重新分配或覆盖现有实体。 */
  readonly retainPlacementId?: boolean;
}

export function isDraftEntity(entity: WorldEntity | DraftEntity): entity is DraftEntity {
  return "originalEntityId" in entity && typeof entity.originalEntityId === "string";
}