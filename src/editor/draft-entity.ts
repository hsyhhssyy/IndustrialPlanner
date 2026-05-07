import type { WorldEntity } from "@/domain/document/world-document";

export interface DraftEntity extends WorldEntity {
  originalEntityId: string;
}

export function isDraftEntity(entity: WorldEntity | DraftEntity): entity is DraftEntity {
  return "originalEntityId" in entity && typeof entity.originalEntityId === "string";
}