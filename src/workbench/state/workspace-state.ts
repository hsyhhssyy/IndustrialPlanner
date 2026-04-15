import type { WorldDocument } from "@/domain/document/world-document";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { EditorSession } from "@/editor/contracts/editor-session";
import type { EditorHistoryState as EditorHistorySliceState } from "@/editor/core/editor-core";
import type { WorkbenchUiState } from "@/workbench/state/workbench-ui-state";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewState {
  offset: CanvasPoint;
  zoom: number;
}

export type WorkspaceEditorSessionState = Omit<EditorSession, "hoveredEntityId">;
export interface EditorInternalSessionState {
  hoveredEntityId: string | null;
}

export type WorkspaceEditorHistoryState = EditorHistorySliceState;
export type EditorSessionState = WorkspaceEditorSessionState;
export type EditorHistoryState = WorkspaceEditorHistoryState;

export interface WorkspaceEditorState {
  session: WorkspaceEditorSessionState;
  history: WorkspaceEditorHistoryState;
}

export interface WorkspaceState {
  document: WorldDocument;
  topology: CompiledTopology;
  editorSession: WorkspaceEditorSessionState;
  editorHistory: WorkspaceEditorHistoryState;
  ui: WorkbenchUiState;
  canvasView: CanvasViewState;
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
