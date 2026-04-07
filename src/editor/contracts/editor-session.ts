import type {
  PlacementPreviewState,
  PlacementInteractionMode,
} from "@/editor/contracts/placement-preview";
import type {
  CurrentInteractionMode,
  DisplayTool,
} from "@/editor/contracts/interaction-mode";

/**
 * Editor runtime session truth.
 *
 * Input-origin metadata such as `selectionInputMode`, and draft-level state
 * such as `placementPreview`, live here rather than in WorldDocument.
 */
export interface EditorSession {
  displayTool: DisplayTool;
  currentMode: CurrentInteractionMode;
  selection: string[];
  selectionInputMode: PlacementInteractionMode | null;
  hoveredEntityId: string | null;
  dragPreviewEntityId: string | null;
  placementPreview: PlacementPreviewState | null;
}
