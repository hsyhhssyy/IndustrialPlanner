import type {
  PlacementPreviewState,
  PlacementPreviewStrategy,
} from "@/editor/contracts/placement-preview";

export type EditorTool =
  | "select"
  | "place"
  | "belt"
  | "pipe"
  | "link"
  | "inspect";

export interface EditorSession {
  activeTool: EditorTool;
  selection: string[];
  hoveredEntityId: string | null;
  dragPreviewEntityId: string | null;
  placementDefinitionId: string | null;
  placementStrategy: PlacementPreviewStrategy | null;
  placementPreview: PlacementPreviewState | null;
  pendingLinkSourceEntityId: string | null;
}
