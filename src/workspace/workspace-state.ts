import type { WorldDocument } from "@/domain/document/world-document";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { EditorSession } from "@/editor/contracts/editor-session";
import { makeAutoObservable } from "@/shared/mobx";
import type {
  CanvasViewState,
  EditorInternalSessionState,
  WorkspaceEditorHistoryState,
  WorkspaceEditorSessionState,
  WorkspaceEditorState,
} from "@/workspace/types";

export interface WorkspaceState {
  document: WorldDocument;
  topology: CompiledTopology;
  editorSession: WorkspaceEditorSessionState;
  editorHistory: WorkspaceEditorHistoryState;
}

export type WorkspaceStateInput = WorkspaceState;

export class WorkspaceStateModel implements WorkspaceState {
  document: WorldDocument;
  topology: CompiledTopology;
  editorSession: WorkspaceEditorSessionState;
  editorHistory: WorkspaceEditorHistoryState;

  constructor(initialState: WorkspaceStateInput) {
    this.document = initialState.document;
    this.topology = initialState.topology;
    this.editorSession = initialState.editorSession;
    this.editorHistory = initialState.editorHistory;

    makeAutoObservable(this, {}, { autoBind: true });
  }

  apply(nextState: Partial<WorkspaceState>): void {
    if (nextState.document !== undefined) {
      this.document = nextState.document;
    }
    if (nextState.topology !== undefined) {
      this.topology = nextState.topology;
    }
    if (nextState.editorSession !== undefined) {
      this.editorSession = nextState.editorSession;
    }
    if (nextState.editorHistory !== undefined) {
      this.editorHistory = nextState.editorHistory;
    }
  }
}

export function createWorkspaceState(
  initialState: WorkspaceStateInput,
): WorkspaceStateModel {
  return new WorkspaceStateModel(initialState);
}

export function projectWorkspaceEditorSessionState(
  session: WorkspaceEditorSessionState | EditorSession,
): WorkspaceEditorSessionState {
  return {
    displayTool: session.displayTool,
    currentMode: session.currentMode,
    drafts: session.drafts,
    selectedEntities: session.selectedEntities,
    draftEntities: session.draftEntities,
    marqueeRange: session.marqueeRange,
    selectionInputMode: session.selectionInputMode,
  };
}

export function projectWorkspaceEditorState(state: {
  session: WorkspaceEditorSessionState | EditorSession;
  history: WorkspaceEditorHistoryState;
}): WorkspaceEditorState {
  return {
    session: projectWorkspaceEditorSessionState(state.session),
    history: state.history,
  };
}

export function projectEditorInternalSessionState(
  session: EditorSession,
): EditorInternalSessionState {
  return {
    hoveredEntityId: session.hoveredEntityId ?? null,
  };
}

export function createInitialCanvasViewState(
  initialState: Partial<CanvasViewState> = {},
): CanvasViewState {
  return {
    offset: initialState.offset ?? { x: 0, y: 0 },
    zoom: initialState.zoom ?? 1,
  };
}

export type {
  CanvasPoint,
  CanvasViewState,
  EditorHistoryState,
  EditorSessionState,
  WorkspaceEditorHistoryState,
  WorkspaceEditorSessionState,
  WorkspaceEditorState,
} from "@/workspace/types";