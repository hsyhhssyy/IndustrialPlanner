import type {
  PlacementPreviewState,
  PlacementInteractionMode,
} from "@/editor/contracts/placement-preview";
import type { GridRotation } from "@/shared/geometry/grid";

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
  placementInteractionMode: PlacementInteractionMode | null;
  placementRotation: GridRotation | null;
  placementPreview: PlacementPreviewState | null;
  pendingLinkSourceEntityId: string | null;
}
