import { makeAutoObservable } from "mobx";

import type { WorldEntity } from "@/domain/entity/world-document";
import type { EditorState } from "@/domain/state/types";

export interface EditorViewportCenterReadWrite {
  x: number;
  y: number;
}

export interface EditorViewportPixelSizeReadWrite {
  width: number;
  height: number;
}

export interface EditorViewportStateReadWrite {
  center: EditorViewportCenterReadWrite;
  pixelSize: EditorViewportPixelSizeReadWrite;
  gridSize: number;
}

export interface EditorStateReadWrite extends EditorState {
  viewport: EditorViewportStateReadWrite;
  drafts: Record<string, WorldEntity>;
  selectedEntities: Record<string, WorldEntity>;
  previewEntities: Record<string, WorldEntity>;
}

const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;
const DEFAULT_VIEWPORT_GRID_SIZE = 1;

export class EditorStateReadWriteImpl implements EditorStateReadWrite {
  viewport: EditorViewportStateReadWrite = {
    center: {
      x: 0,
      y: 0,
    },
    pixelSize: {
      width: DEFAULT_VIEWPORT_WIDTH,
      height: DEFAULT_VIEWPORT_HEIGHT,
    },
    gridSize: DEFAULT_VIEWPORT_GRID_SIZE,
  };

  drafts: Record<string, WorldEntity> = {};
  selectedEntities: Record<string, WorldEntity> = {};
  previewEntities: Record<string, WorldEntity> = {};

  public constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }
}

export function createEditorStateReadWrite(): EditorStateReadWrite {
  return new EditorStateReadWriteImpl();
}