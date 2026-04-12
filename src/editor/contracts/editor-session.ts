import type {
  DraftEntitiesState,
  DraftsState,
  SelectedEntitiesState,
} from "@/editor/contracts/entity-collection";
import type { MarqueeRangeState } from "@/editor/contracts/marquee-range";
import type {
  PlacementPreviewState,
  PlacementInteractionMode,
} from "@/editor/contracts/placement-preview";
import type { MarqueeDraftState } from "@/editor/contracts/marquee-draft";
import type { MoveDraftState } from "@/editor/contracts/move-draft";
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
  drafts: DraftsState;
  selectedEntities: SelectedEntitiesState | null;
  draftEntities: DraftEntitiesState | null;
  marqueeRange: MarqueeRangeState | null;
  selection: string[];
  selectionInputMode: PlacementInteractionMode | null;
  hoveredEntityId: string | null;
  placementPreview: PlacementPreviewState | null;
  moveDraft: MoveDraftState | null;
  marqueeDraft: MarqueeDraftState | null;
}
