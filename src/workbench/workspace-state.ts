import type { WorldDocument } from "@/domain/document/world-document";
import type { EditorSession } from "@/editor/contracts/editor-session";
import type { EditorHistoryState as EditorHistorySliceState } from "@/editor/core/editor-core";
import type { SimulationState } from "@/simulation/host/simulation-host";
import type { WorkbenchUiState } from "@/workbench/workbench-ui-state";

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

export interface WorkspaceState {
  document: WorldDocument;
  editor: {
    session: EditorSessionState;
    history: EditorHistoryState;
  };
  ui: WorkbenchUiState;
  canvasView: CanvasViewState;
  simulation: SimulationState;
}

export function createInitialCanvasViewState(
  initialState: Partial<CanvasViewState> = {},
): CanvasViewState {
  return {
    offset: initialState.offset ?? { x: 0, y: 0 },
    zoom: initialState.zoom ?? 1,
  };
}
