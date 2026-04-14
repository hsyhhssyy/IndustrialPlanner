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

export type EditorSessionState = EditorSession;
export type EditorHistoryState = EditorHistorySliceState;

export interface WorkspaceEditorState {
  session: EditorSessionState;
  history: EditorHistoryState;
}

export interface WorkspaceState {
  document: WorldDocument;
  topology: CompiledTopology;
  editorSession: EditorSessionState;
  editorHistory: EditorHistoryState;
  ui: WorkbenchUiState;
  canvasView: CanvasViewState;
}

export function createInitialCanvasViewState(
  initialState: Partial<CanvasViewState> = {},
): CanvasViewState {
  return {
    offset: initialState.offset ?? { x: 0, y: 0 },
    zoom: initialState.zoom ?? 1,
  };
}
