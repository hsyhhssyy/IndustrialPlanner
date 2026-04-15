import type { EditorSession } from "@/editor/contracts/editor-session";
import type { EditorHistoryState as EditorHistorySliceState } from "@/editor/core/editor-core";

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