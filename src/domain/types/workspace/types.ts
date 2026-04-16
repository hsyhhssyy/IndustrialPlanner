import type { WorldDocument } from "@/domain/document/world-document";

export type EntityId = string;

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewState {
  offset: CanvasPoint;
  zoom: number;
}

export type WorkspaceTopologyNodeKind =
  | "storage"
  | "bus"
  | "logistics"
  | "processor"
  | "track"
  | "dark-pipe";

export interface WorkspaceTopologyNodeState {
  id: EntityId;
  kind: WorkspaceTopologyNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface WorkspaceTopologyLinkState {
  id: EntityId;
  sourceId: EntityId;
  targetId: EntityId;
}

export interface WorkspaceTopologyState {
  version: number;
  nodes: WorkspaceTopologyNodeState[];
  links: WorkspaceTopologyLinkState[];
  diagnostics: string[];
}

export type WorkspaceDisplayTool =
  | "select"
  | "place"
  | "belt"
  | "pipe"
  | "link"
  | "inspect";

export type WorkspaceModeKind =
  | "select"
  | "placement"
  | "link"
  | "inspect"
  | "move"
  | "marquee";

export interface WorkspaceEditorModeState {
  kind: WorkspaceModeKind;
  anchorEntityId: EntityId | null;
}

export interface WorkspaceDraftEntityState {
  entityId: EntityId;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface WorkspaceDraftState {
  active: boolean;
  pointerX: number;
  pointerY: number;
  size: number;
  rotation: number;
}

export interface WorkspaceMarqueeRangeState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface WorkspaceEditorSessionState {
  displayTool: WorkspaceDisplayTool;
  currentMode: WorkspaceEditorModeState;
  drafts: Record<string, WorkspaceDraftState>;
  selectedEntities: EntityId[];
  draftEntities: WorkspaceDraftEntityState[];
  marqueeRange: WorkspaceMarqueeRangeState | null;
  selectionInputMode: "pointer" | "touch" | null;
}

export interface WorkspaceEditorHistoryState {
  undoDepth: number;
  redoDepth: number;
  lastCommandId: string | null;
}

export interface WorkspaceUiState {
  leftDockOpen: boolean;
  rightDockOpen: boolean;
  bottomBarOpen: boolean;
  activePanel: "placement" | "delete" | "blueprint" | "history" | null;
}

export interface WorkspaceState {
  document: SnapshotStore<WorldDocument>;
  topology: WorkspaceTopologyState;
  editorSession: WorkspaceEditorSessionState;
  editorHistory: WorkspaceEditorHistoryState;
  ui: WorkspaceUiState;
  canvasView: CanvasViewState;
}

export interface WorkspaceStatePatch {
  document?: SnapshotStore<WorldDocument>;
  topology?: WorkspaceTopologyState;
  editorSession?: WorkspaceEditorSessionState;
  editorHistory?: WorkspaceEditorHistoryState;
  ui?: WorkspaceUiState;
  canvasView?: CanvasViewState;
}
