import {
  makeAutoObservable,
  observable,
  type IObservableArray,
} from "mobx";

import {
  EntityCollectionType,
  type EntityCollection,
  type EntityPlacementValidationResult,
  type EntityCollectionType as EntityCollectionTypeValue,
  type HoverTarget,
} from "@/domain/editor/types/editor-types";
import type { EditorState } from "@/domain/editor/editor-state";
import type { ClientPixelRect } from "@/domain/shared/client-pixel";
import type { GridRect, GridRotation } from "@/domain/shared/grid";
import type { LogisticsDraftReadonlyState } from "@/domain/shared/logistics";
import type { SlotLinkDefinition } from "@/domain/document/world-document";
import type {
  EditorHistoryActionDescriptor,
  EditorHistoryRecord,
  EditorHistoryState,
} from "@/domain/editor/editor-history";

import type { DraftEntity } from "./draft-entity";
import {
  DEFAULT_VIEWPORT_GRID_SIZE,
  resolveViewportGridCellPixelSize,
} from "./viewport-settings";

export interface GridFloatPointReadWrite {
  x: number;
  y: number;
}

export interface ClientPixelRectReadWrite {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EditorViewportStateReadWrite {
  center: GridFloatPointReadWrite;
  clientRect: ClientPixelRectReadWrite;
  gridSize: number;
  gridCellPixelSize: number;
  displayRotation: GridRotation;
}

export interface EditorInternalPersistStateReadWrite {
  lastDocumentId: string | null;
  latestDocumentIdByBaseId: Record<string, string>;
}

export interface EditorInternalTransientStateReadWrite {
  hasMeasuredViewportClientRect: boolean;
  logisticsDraft: LogisticsDraftReadonlyState | null;
  logisticsDeviceRouteCycleSignature: string | null;
  logisticsDeviceRouteCycleIndex: number;
  convergerEntityGridKey: string | null;
  placementDraftSlotLinks: SlotLinkDefinition[] | null;
  placementDraftEntityIdMap: ReadonlyMap<string, string> | null;
  placementHistoryAction: EditorHistoryActionDescriptor | null;
  placementValidationByEntityId: Record<string, EntityPlacementValidationResult>;
  placementOriginEntityIds: string[] | null;
}

class EditorInternalPersistStateReadWriteImpl
  implements EditorInternalPersistStateReadWrite
{
  lastDocumentId: string | null = null;
  latestDocumentIdByBaseId: Record<string, string> = {};

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class EditorInternalTransientStateReadWriteImpl
  implements EditorInternalTransientStateReadWrite
{
  hasMeasuredViewportClientRect = false;
  logisticsDraft: LogisticsDraftReadonlyState | null = null;
  logisticsDeviceRouteCycleSignature: string | null = null;
  logisticsDeviceRouteCycleIndex = 0;
  convergerEntityGridKey: string | null = null;
  placementDraftSlotLinks: SlotLinkDefinition[] | null = null;
  placementDraftEntityIdMap: ReadonlyMap<string, string> | null = null;
  placementHistoryAction: EditorHistoryActionDescriptor | null = null;
  placementValidationByEntityId: Record<string, EntityPlacementValidationResult> = {};
  placementOriginEntityIds: string[] | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

type EntityCollectionReadWrite = IObservableArray<string> & EntityCollection;

function createEntityCollection(
  entityIds: readonly string[] = [],
): EntityCollectionReadWrite {
  const collection = observable.array<string>([...entityIds], {
    deep: false,
  }) as EntityCollectionReadWrite;

  Object.defineProperty(collection, "contains", {
    value: (entityId: string) => collection.includes(entityId),
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return collection;
}


export interface EditorStateReadWrite extends EditorState {
  viewport: EditorViewportStateReadWrite;
  marqueeGridRect: GridRect | null;
  history: EditorHistoryStateReadWrite;
  hoverTarget: HoverTarget | null;
  drafts: DraftEntity[];
  collections: Record<EntityCollectionTypeValue, EntityCollectionReadWrite>;
  suppressBelts: boolean;
  suppressPipes: boolean;

  // 私有State, 不属于Contract, 但是自己用
  internalPersistState: EditorInternalPersistStateReadWrite;
  internalTransientState: EditorInternalTransientStateReadWrite;
}

export interface EditorHistoryStateReadWrite extends EditorHistoryState {
  documentKey: string | null;
  records: IObservableArray<EditorHistoryRecord>;
  cursorSequence: number;
  headSequence: number;
  lastRecordId: string | null;
  isReady: boolean;
}

class EditorHistoryStateReadWriteImpl implements EditorHistoryStateReadWrite {
  documentKey: string | null = null;
  records = observable.array<EditorHistoryRecord>([], {
    deep: false,
  });
  cursorSequence = 0;
  headSequence = 0;
  lastRecordId: string | null = null;
  isReady = false;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  public get undoDepth(): number {
    return this.records.filter((record) =>
      record.sequence <= this.cursorSequence,
    ).length;
  }

  public get redoDepth(): number {
    return this.records.filter((record) =>
      record.sequence > this.cursorSequence,
    ).length;
  }
}

const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;
const DEFAULT_VIEWPORT_CLIENT_RECT: ClientPixelRect = {
  left: 0,
  top: 0,
  width: DEFAULT_VIEWPORT_WIDTH,
  height: DEFAULT_VIEWPORT_HEIGHT,
};

export class EditorStateReadWriteImpl implements EditorStateReadWrite {
  viewport: EditorViewportStateReadWrite = {
    center: {
      x: 0,
      y: 0,
    },
    clientRect: {
      ...DEFAULT_VIEWPORT_CLIENT_RECT,
    },
    gridSize: DEFAULT_VIEWPORT_GRID_SIZE,
    gridCellPixelSize: resolveViewportGridCellPixelSize(
      DEFAULT_VIEWPORT_GRID_SIZE,
    ),
    displayRotation: 0,
  };
  marqueeGridRect: GridRect | null = null;
  history: EditorHistoryStateReadWrite = new EditorHistoryStateReadWriteImpl();
  suppressBelts = false;
  suppressPipes = false;
  hoverTarget: HoverTarget | null = null;

  drafts: DraftEntity[] = [];
  collections: Record<EntityCollectionTypeValue, EntityCollectionReadWrite> = {
    [EntityCollectionType.selection]: createEntityCollection(),
    [EntityCollectionType.marquee]: createEntityCollection(),
    [EntityCollectionType.reverseMarquee]: createEntityCollection(),
    [EntityCollectionType.preview]: createEntityCollection(),
    [EntityCollectionType.ghost]: createEntityCollection(),
    [EntityCollectionType.logisticsHead]: createEntityCollection(),
    [EntityCollectionType.powered]: createEntityCollection(),
    [EntityCollectionType.invalidPlacement]: createEntityCollection(),
  };
  internalPersistState: EditorInternalPersistStateReadWrite =
    new EditorInternalPersistStateReadWriteImpl();
  internalTransientState: EditorInternalTransientStateReadWrite =
    new EditorInternalTransientStateReadWriteImpl();

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createEditorStateReadWrite(): EditorStateReadWrite {
  return new EditorStateReadWriteImpl();
}
