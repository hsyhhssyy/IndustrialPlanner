import type { WorldEntity } from "@/domain/document/world-document";
import type { DraftEntityState } from "@/editor/contracts/entity-collection";

export type MergedEntityKind = "world" | "draft";

export interface MergedEntityLookupResult {
  kind: MergedEntityKind;
  entity: WorldEntity | DraftEntityState;
}

export interface EditorMergedEntityLookup {
  getEntityById(id: string): MergedEntityLookupResult | null;
}