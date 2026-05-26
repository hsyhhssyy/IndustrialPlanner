import type {
  SlotLinkDefinition,
  WorldEntity,
} from "../document/world-document";

export type EditorHistoryActionType =
  | "entity.place"
  | "blueprint.place"
  | "entity.delete"
  | "entity.move"
  | "entity.rotate"
  | "entity.definition.replace"
  | "entity.config.patch"
  | "entity.config.delete-keys"
  | "logistics.place"
  | "document.settings.patch"
  | "document.restore"
  | "document.unknown";

export interface EditorHistoryActionDescriptor {
  readonly type: EditorHistoryActionType;
  readonly label: string;
  readonly detail?: string;
  readonly entityIds?: readonly string[];
  readonly definitionIds?: readonly string[];
  readonly blueprintId?: string;
  readonly blueprintName?: string;
  readonly count?: number;
}

export interface EditorHistoryValueChange<TValue> {
  readonly before: TValue;
  readonly after: TValue;
}

export interface EditorHistoryEntityDelta {
  readonly added: Readonly<Record<string, WorldEntity>>;
  readonly removed: Readonly<Record<string, WorldEntity>>;
  readonly updated: Readonly<Record<string, EditorHistoryValueChange<WorldEntity>>>;
}

export interface EditorHistoryDocumentDelta {
  readonly entities: EditorHistoryEntityDelta;
  readonly entityOrder: EditorHistoryValueChange<readonly string[]> | null;
  readonly slotLinks: EditorHistoryValueChange<readonly SlotLinkDefinition[]> | null;
  readonly documentSettings: Readonly<Record<string, EditorHistoryValueChange<unknown>>>;
}

export interface EditorHistoryRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly documentKey: string;
  readonly sequence: number;
  readonly createdAt: string;
  readonly action: EditorHistoryActionDescriptor;
  readonly delta: EditorHistoryDocumentDelta;
}

export interface EditorHistoryState {
  readonly documentKey: string | null;
  readonly records: readonly EditorHistoryRecord[];
  readonly cursorSequence: number;
  readonly headSequence: number;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly lastRecordId: string | null;
  readonly isReady: boolean;
}
