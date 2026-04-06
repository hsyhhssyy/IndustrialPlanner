import type {
  MovePreviewState,
  PlacementPreviewState,
  PlacementInteractionMode,
} from "@/editor/contracts/placement-preview";
import type { GridPoint, GridRotation } from "@/shared/geometry/grid";

export type EditorTool =
  | "select"
  | "place"
  | "belt"
  | "pipe"
  | "link"
  | "inspect";

export type EditorModeKey =
  | "select"
  | "inspect"
  | "link"
  | "placement"
  | "move";

export interface EditorModeBase<TKey extends EditorModeKey> {
  key: TKey;
  displayTool: EditorTool;
  fallbackTool: EditorTool;
}

export type SelectEditorMode = EditorModeBase<"select">;

export type InspectEditorMode = EditorModeBase<"inspect">;

export interface LinkEditorMode extends EditorModeBase<"link"> {
  pendingSourceEntityId: string | null;
}

export interface PlacementEditorMode extends EditorModeBase<"placement"> {
  definitionId: string;
  interactionMode: PlacementInteractionMode;
  rotation: GridRotation;
  preview: PlacementPreviewState | null;
}

export interface MoveEditorMode extends EditorModeBase<"move"> {
  entityId: string;
  definitionId: string;
  interactionMode: PlacementInteractionMode;
  origin: {
    gridPoint: GridPoint;
    rotation: GridRotation;
  };
  preview: MovePreviewState;
}

export type EditorMode =
  | SelectEditorMode
  | InspectEditorMode
  | LinkEditorMode
  | PlacementEditorMode
  | MoveEditorMode;

export interface EditorSession {
  mode: EditorMode;
  activeTool: EditorTool;
  selection: string[];
  selectionInteractionMode: PlacementInteractionMode | null;
  hoveredEntityId: string | null;
  dragPreviewEntityId: string | null;
  movePreview: MovePreviewState | null;
  placementDefinitionId: string | null;
  placementInteractionMode: PlacementInteractionMode | null;
  placementRotation: GridRotation | null;
  placementPreview: PlacementPreviewState | null;
  pendingLinkSourceEntityId: string | null;
}
