import { isSamePlacementPreviewState } from "@/editor/contracts/placement-preview";
import type { EditorSession } from "@/editor/contracts/editor-session";
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
    left.activeTool === right.activeTool &&
    areSelectionsEqual(left.selection, right.selection) &&
    left.hoveredEntityId === right.hoveredEntityId &&
    left.dragPreviewEntityId === right.dragPreviewEntityId &&
    left.placementDefinitionId === right.placementDefinitionId &&
    left.placementStrategy === right.placementStrategy &&
    isSamePlacementPreviewState(left.placementPreview, right.placementPreview) &&
    left.pendingLinkSourceEntityId === right.pendingLinkSourceEntityId
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
    activeTool: session.activeTool,
    selection: [...session.selection],
    hoveredEntityId: session.hoveredEntityId,
    dragPreviewEntityId: session.dragPreviewEntityId,
    placementDefinitionId: session.placementDefinitionId,
    placementStrategy: session.placementStrategy,
    placementPreview: session.placementPreview
      ? {
          ...session.placementPreview,
          gridPoint: {
            ...session.placementPreview.gridPoint,
          },
        }
      : null,
    pendingLinkSourceEntityId: session.pendingLinkSourceEntityId,
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
    if (this.session.activeTool !== session.activeTool) {
      this.session.activeTool = session.activeTool;
    }

    if (!areSelectionsEqual(this.session.selection, session.selection)) {
      this.session.selection = [...session.selection];
    }

    if (this.session.hoveredEntityId !== session.hoveredEntityId) {
      this.session.hoveredEntityId = session.hoveredEntityId;
    }

    if (this.session.dragPreviewEntityId !== session.dragPreviewEntityId) {
      this.session.dragPreviewEntityId = session.dragPreviewEntityId;
    }

    if (this.session.placementDefinitionId !== session.placementDefinitionId) {
      this.session.placementDefinitionId = session.placementDefinitionId;
    }

    if (this.session.placementStrategy !== session.placementStrategy) {
      this.session.placementStrategy = session.placementStrategy;
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

    if (
      this.session.pendingLinkSourceEntityId !== session.pendingLinkSourceEntityId
    ) {
      this.session.pendingLinkSourceEntityId = session.pendingLinkSourceEntityId;
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
