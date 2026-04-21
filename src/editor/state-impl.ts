import { makeAutoObservable } from "mobx";

import type { WorldEntity } from "@/domain/entity/world-document";
import type {
  EditorState,
  EditorViewportClientRect,
} from "@/domain/state/types";

export interface EditorViewportCenterReadWrite {
  x: number;
  y: number;
}

export interface EditorViewportClientRectReadWrite {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface EditorViewportStateReadWrite {
  center: EditorViewportCenterReadWrite;
  clientRect: EditorViewportClientRectReadWrite;
  gridSize: number;
}

export interface EditorInternalPersistStateReadWrite {
  lastDocumentId: string | null;
}

export interface EditorInternalTransientStateReadWrite {
  // 定义瞬态的内部状态属性
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
const DEFAULT_VIEWPORT_CLIENT_RECT: EditorViewportClientRect = {
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