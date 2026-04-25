import { makeAutoObservable } from "mobx";

import type { WorldEntity } from "@/domain/entity/world-document";
import type {
  EditorState,
} from "@/domain/state/types";
import type { ClientPixelRect } from "@/domain/types/client-pixel";

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


export interface EditorStateReadWrite extends EditorState {
  viewport: EditorViewportStateReadWrite;
  drafts: Record<string, WorldEntity>;
  selectedEntities: Record<string, WorldEntity>;
  previewEntities: Record<string, WorldEntity>;

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

  drafts: Record<string, WorldEntity> = {};
  selectedEntities: Record<string, WorldEntity> = {};
  previewEntities: Record<string, WorldEntity> = {};
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