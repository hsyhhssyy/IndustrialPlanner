import {
  makeAutoObservable,
  observable,
  type IObservableArray,
} from "mobx";

import {
  EntityCollectionType,
  type EntityCollection,
  type EditorState,
  type EntityCollectionType as EntityCollectionTypeValue,
} from "@/domain/state/types";
import type { ClientPixelRect } from "@/domain/types/client-pixel";

import type { DraftEntity } from "./draft-entity";

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
}

export interface EditorInternalPersistStateReadWrite {
  lastDocumentId: string | null;
}

export interface EditorInternalTransientStateReadWrite {
  hasMeasuredViewportClientRect: boolean;
}

class EditorInternalPersistStateReadWriteImpl
  implements EditorInternalPersistStateReadWrite
{
  lastDocumentId: string | null = null;

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

class EditorInternalTransientStateReadWriteImpl
  implements EditorInternalTransientStateReadWrite
{
  hasMeasuredViewportClientRect = false;

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
  drafts: DraftEntity[];
  collections: Record<EntityCollectionTypeValue, EntityCollectionReadWrite>;

  // 私有State, 不属于Contract, 但是自己用
  internalPersistState: EditorInternalPersistStateReadWrite;
  internalTransientState: EditorInternalTransientStateReadWrite;
}

const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;
const DEFAULT_VIEWPORT_GRID_SIZE = 1;
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
  };

  drafts: DraftEntity[] = [];
  collections: Record<EntityCollectionTypeValue, EntityCollectionReadWrite> = {
    [EntityCollectionType.selection]: createEntityCollection(),
    [EntityCollectionType.preview]: createEntityCollection(),
    [EntityCollectionType.ghost]: createEntityCollection(),
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