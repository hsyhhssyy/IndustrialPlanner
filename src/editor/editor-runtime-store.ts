import {
  isSameMarqueeDraftState,
} from "@/editor/contracts/marquee-draft";
import { isSamePlacementPreviewState } from "@/editor/contracts/placement-preview";
import { isSameMoveDraftState } from "@/editor/contracts/move-draft";
import type { EditorSession } from "@/editor/contracts/editor-session";
import {
  cloneCurrentInteractionMode,
  isSameCurrentInteractionMode,
} from "@/editor/contracts/interaction-mode";
import type { EditorHistoryState } from "@/editor/core/editor-core";
import { makeAutoObservable } from "@/shared/mobx";
import { createSnapshotBridge } from "@/shared/mobx/snapshot-bridge";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";

export interface EditorRuntimeState {
  session: EditorSession;
  history: EditorHistoryState;
}

function areSelectionsEqual(left: string[], right: string[]): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function isSameEditorSession(
  left: EditorSession,
  right: EditorSession,
): boolean {
  return (
    left.displayTool === right.displayTool &&
    isSameCurrentInteractionMode(left.currentMode, right.currentMode) &&
    areSelectionsEqual(left.selection, right.selection) &&
    left.selectionInputMode === right.selectionInputMode &&
    left.hoveredEntityId === right.hoveredEntityId &&
    isSamePlacementPreviewState(left.placementPreview, right.placementPreview) &&
    isSameMoveDraftState(left.moveDraft, right.moveDraft) &&
    isSameMarqueeDraftState(left.marqueeDraft, right.marqueeDraft)
  );
}

function isSameEditorHistoryState(
  left: EditorHistoryState,
  right: EditorHistoryState,
): boolean {
  return (
    left.canUndo === right.canUndo &&
    left.canRedo === right.canRedo &&
    left.undoDepth === right.undoDepth &&
    left.redoDepth === right.redoDepth
  );
}

function cloneEditorSession(session: EditorSession): EditorSession {
  return {
    displayTool: session.displayTool,
    currentMode: cloneCurrentInteractionMode(session.currentMode),
    selection: [...session.selection],
    selectionInputMode: session.selectionInputMode,
    hoveredEntityId: session.hoveredEntityId,
    placementPreview: session.placementPreview
      ? {
          ...session.placementPreview,
          gridPoint: {
            ...session.placementPreview.gridPoint,
          },
        }
      : null,
    moveDraft: session.moveDraft
      ? {
          ...session.moveDraft,
          originGridPoint: {
            ...session.moveDraft.originGridPoint,
          },
          gridPoint: {
            ...session.moveDraft.gridPoint,
          },
          rotationCenterCells: session.moveDraft.rotationCenterCells
            ? {
                ...session.moveDraft.rotationCenterCells,
              }
            : undefined,
          anchorWorldOffset: {
            ...session.moveDraft.anchorWorldOffset,
          },
          entities: session.moveDraft.entities.map((entity) => ({
            ...entity,
            originGridPoint: {
              ...entity.originGridPoint,
            },
            gridPoint: {
              ...entity.gridPoint,
            },
            centerCells: entity.centerCells
              ? {
                  ...entity.centerCells,
                }
              : undefined,
          })),
        }
      : null,
    marqueeDraft: session.marqueeDraft
      ? {
          ...session.marqueeDraft,
          originGridPoint: {
            ...session.marqueeDraft.originGridPoint,
          },
          gridPoint: {
            ...session.marqueeDraft.gridPoint,
          },
          bounds: {
            ...session.marqueeDraft.bounds,
          },
          entityIds: [...session.marqueeDraft.entityIds],
          baseSelection: [...session.marqueeDraft.baseSelection],
        }
      : null,
  };
}

function cloneEditorHistoryState(history: EditorHistoryState): EditorHistoryState {
  return {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoDepth: history.undoDepth,
    redoDepth: history.redoDepth,
  };
}

function cloneEditorRuntimeState(state: EditorRuntimeState): EditorRuntimeState {
  return {
    session: cloneEditorSession(state.session),
    history: cloneEditorHistoryState(state.history),
  };
}

export interface EditorRuntimeStore
  extends ReadonlySnapshotStore<EditorRuntimeState> {
  session: EditorSession;
  history: EditorHistoryState;
  setSnapshot: (state: EditorRuntimeState) => boolean;
}

class EditorRuntimeStoreImpl implements EditorRuntimeStore {
  session: EditorSession;
  history: EditorHistoryState;

  readonly #snapshotBridge;

  constructor(initialState: EditorRuntimeState) {
    const initialSnapshot = cloneEditorRuntimeState(initialState);
    this.session = cloneEditorSession(initialSnapshot.session);
    this.history = cloneEditorHistoryState(initialSnapshot.history);
    this.#snapshotBridge = createSnapshotBridge(initialSnapshot);

    makeAutoObservable(
      this,
      {
        getSnapshot: false,
        subscribe: false,
      },
      {
        autoBind: true,
      },
    );
  }

  getSnapshot() {
    return this.#snapshotBridge.getSnapshot();
  }

  subscribe(listener: () => void) {
    return this.#snapshotBridge.subscribe(listener);
  }

  setSnapshot(state: EditorRuntimeState): boolean {
    const nextSnapshot = cloneEditorRuntimeState(state);
    const currentSnapshot = this.#snapshotBridge.getSnapshot();

    if (
      isSameEditorSession(currentSnapshot.session, nextSnapshot.session) &&
      isSameEditorHistoryState(currentSnapshot.history, nextSnapshot.history)
    ) {
      return false;
    }

    this.applySessionSnapshot(nextSnapshot.session);
    this.applyHistorySnapshot(nextSnapshot.history);
    this.#snapshotBridge.publish(nextSnapshot);
    return true;
  }

  private applySessionSnapshot(session: EditorSession): void {
    if (this.session.displayTool !== session.displayTool) {
      this.session.displayTool = session.displayTool;
    }

    if (!isSameCurrentInteractionMode(this.session.currentMode, session.currentMode)) {
      this.session.currentMode = cloneCurrentInteractionMode(session.currentMode);
    }

    if (!areSelectionsEqual(this.session.selection, session.selection)) {
      this.session.selection = [...session.selection];
    }

    if (this.session.selectionInputMode !== session.selectionInputMode) {
      this.session.selectionInputMode = session.selectionInputMode;
    }

    if (this.session.hoveredEntityId !== session.hoveredEntityId) {
      this.session.hoveredEntityId = session.hoveredEntityId;
    }

    if (
      !isSamePlacementPreviewState(this.session.placementPreview, session.placementPreview)
    ) {
      this.session.placementPreview = session.placementPreview
        ? {
            ...session.placementPreview,
            gridPoint: {
              ...session.placementPreview.gridPoint,
            },
          }
        : null;
    }

    if (!isSameMoveDraftState(this.session.moveDraft, session.moveDraft)) {
      this.session.moveDraft = session.moveDraft
        ? {
            ...session.moveDraft,
            originGridPoint: {
              ...session.moveDraft.originGridPoint,
            },
            gridPoint: {
              ...session.moveDraft.gridPoint,
            },
            rotationCenterCells: session.moveDraft.rotationCenterCells
              ? {
                  ...session.moveDraft.rotationCenterCells,
                }
              : undefined,
            anchorWorldOffset: {
              ...session.moveDraft.anchorWorldOffset,
            },
            entities: session.moveDraft.entities.map((entity) => ({
              ...entity,
              originGridPoint: {
                ...entity.originGridPoint,
              },
              gridPoint: {
                ...entity.gridPoint,
              },
              centerCells: entity.centerCells
                ? {
                    ...entity.centerCells,
                  }
                : undefined,
            })),
          }
        : null;
    }

    if (!isSameMarqueeDraftState(this.session.marqueeDraft, session.marqueeDraft)) {
      this.session.marqueeDraft = session.marqueeDraft
        ? {
            ...session.marqueeDraft,
            originGridPoint: {
              ...session.marqueeDraft.originGridPoint,
            },
            gridPoint: {
              ...session.marqueeDraft.gridPoint,
            },
            bounds: {
              ...session.marqueeDraft.bounds,
            },
            entityIds: [...session.marqueeDraft.entityIds],
            baseSelection: [...session.marqueeDraft.baseSelection],
          }
        : null;
    }
  }

  private applyHistorySnapshot(history: EditorHistoryState): void {
    if (this.history.canUndo !== history.canUndo) {
      this.history.canUndo = history.canUndo;
    }

    if (this.history.canRedo !== history.canRedo) {
      this.history.canRedo = history.canRedo;
    }

    if (this.history.undoDepth !== history.undoDepth) {
      this.history.undoDepth = history.undoDepth;
    }

    if (this.history.redoDepth !== history.redoDepth) {
      this.history.redoDepth = history.redoDepth;
    }
  }
}

export function createEditorRuntimeStore(
  initialState: EditorRuntimeState,
): EditorRuntimeStore {
  return new EditorRuntimeStoreImpl(initialState);
}
