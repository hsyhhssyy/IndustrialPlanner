import {
  cloneEditorEntityCollectionState,
  cloneDraftsState,
  isSameEditorEntityCollectionState,
  isSameDraftsState,
} from "@/editor/contracts/entity-collection";
import { isSameMarqueeRangeState } from "@/editor/contracts/marquee-range";
import type { EditorSession } from "@/editor/contracts/editor-session";
import {
  cloneCurrentInteractionMode,
  isSameCurrentInteractionMode,
} from "@/editor/contracts/interaction-mode";
import type { EditorHistoryState } from "@/editor/core/editor-core";
import { makeAutoObservable } from "@/shared/mobx";
import { createSnapshotBridge } from "@/shared/mobx/snapshot-bridge";
import type { ReadonlySnapshotStore } from "@/workbench/state/workspace-store";
import {
  type WorkspaceEditorSessionState,
  type WorkspaceEditorState,
  projectWorkspaceEditorState,
} from "@/workspace/workspace-state";

export type EditorRuntimeState = WorkspaceEditorState;

type EditorRuntimeStateInput = {
  session: WorkspaceEditorSessionState | EditorSession;
  history: EditorHistoryState;
};

export function isSameEditorSession(
  left: WorkspaceEditorSessionState,
  right: WorkspaceEditorSessionState,
): boolean {
  return (
    left.displayTool === right.displayTool &&
    isSameCurrentInteractionMode(left.currentMode, right.currentMode) &&
    isSameDraftsState(left.drafts, right.drafts) &&
    isSameEditorEntityCollectionState(left.selectedEntities, right.selectedEntities) &&
    isSameEditorEntityCollectionState(left.draftEntities, right.draftEntities) &&
    isSameMarqueeRangeState(left.marqueeRange, right.marqueeRange) &&
    left.selectionInputMode === right.selectionInputMode
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

function cloneEditorSession(
  session: WorkspaceEditorSessionState,
): WorkspaceEditorSessionState {
  return {
    displayTool: session.displayTool,
    currentMode: cloneCurrentInteractionMode(session.currentMode),
    drafts: cloneDraftsState(session.drafts),
    selectedEntities: cloneEditorEntityCollectionState(session.selectedEntities),
    draftEntities: cloneEditorEntityCollectionState(session.draftEntities),
    marqueeRange: session.marqueeRange
      ? {
          ...session.marqueeRange,
          originGridPoint: { ...session.marqueeRange.originGridPoint },
          gridPoint: { ...session.marqueeRange.gridPoint },
          bounds: { ...session.marqueeRange.bounds },
        }
      : null,
    selectionInputMode: session.selectionInputMode,
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

function normalizeEditorRuntimeState(
  state: EditorRuntimeStateInput,
): EditorRuntimeState {
  return projectWorkspaceEditorState({
    session: state.session,
    history: state.history,
  });
}

export interface EditorRuntimeStore
  extends ReadonlySnapshotStore<EditorRuntimeState> {
  session: WorkspaceEditorSessionState;
  history: EditorHistoryState;
  setSnapshot: (state: EditorRuntimeStateInput) => boolean;
}

class EditorRuntimeStoreImpl implements EditorRuntimeStore {
  session: WorkspaceEditorSessionState;
  history: EditorHistoryState;

  readonly #snapshotBridge;

  constructor(initialState: EditorRuntimeStateInput) {
    const initialSnapshot = cloneEditorRuntimeState(
      normalizeEditorRuntimeState(initialState),
    );
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

  setSnapshot(state: EditorRuntimeStateInput): boolean {
    const nextSnapshot = cloneEditorRuntimeState(
      normalizeEditorRuntimeState(state),
    );
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

  private applySessionSnapshot(session: WorkspaceEditorSessionState): void {
    if (this.session.displayTool !== session.displayTool) {
      this.session.displayTool = session.displayTool;
    }

    if (!isSameCurrentInteractionMode(this.session.currentMode, session.currentMode)) {
      this.session.currentMode = cloneCurrentInteractionMode(session.currentMode);
    }

    if (!isSameDraftsState(this.session.drafts, session.drafts)) {
      this.session.drafts = cloneDraftsState(session.drafts);
    }

    if (
      !isSameEditorEntityCollectionState(
        this.session.selectedEntities,
        session.selectedEntities,
      )
    ) {
      this.session.selectedEntities = cloneEditorEntityCollectionState(
        session.selectedEntities,
      );
    }

    if (
      !isSameEditorEntityCollectionState(
        this.session.draftEntities,
        session.draftEntities,
      )
    ) {
      this.session.draftEntities = cloneEditorEntityCollectionState(
        session.draftEntities,
      );
    }

    if (!isSameMarqueeRangeState(this.session.marqueeRange, session.marqueeRange)) {
      this.session.marqueeRange = session.marqueeRange
        ? {
            ...session.marqueeRange,
            originGridPoint: { ...session.marqueeRange.originGridPoint },
            gridPoint: { ...session.marqueeRange.gridPoint },
            bounds: { ...session.marqueeRange.bounds },
          }
        : null;
    }

    if (this.session.selectionInputMode !== session.selectionInputMode) {
      this.session.selectionInputMode = session.selectionInputMode;
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
  initialState: EditorRuntimeStateInput,
): EditorRuntimeStore {
  return new EditorRuntimeStoreImpl(initialState);
}
