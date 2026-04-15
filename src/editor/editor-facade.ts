import type {
  InteractionModeKey,
  PlacementDisplayTool,
} from "@/editor/contracts/interaction-mode";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { CanvasWorldInput } from "@/editor/host/editor-host";
import type { CanvasPoint } from "@/workbench/state/workspace-state";

export type CanvasInteractionTarget =
  | {
      kind: "blank";
    }
  | {
      kind: "entity";
      entityId: string;
      selected: boolean;
    };

export interface EditorFacadeQuery {
  getCanvasInteractionTarget: (screenPoint: CanvasPoint) => CanvasInteractionTarget;
  queryWorldInputFromScreenPoint: (screenPoint: CanvasPoint) => CanvasWorldInput;
}

export interface EditorFacadeAction {
  setInteractionMode: (
    modeKey: Exclude<InteractionModeKey, "placement" | "move" | "marquee">,
  ) => void;
  armPlacement: (
    definitionId: string,
    displayTool?: PlacementDisplayTool,
    inputMode?: PlacementInteractionMode,
  ) => void;
  beginMoveFromScreenPoint: (
    entityId: string,
    screenPoint: CanvasPoint,
    inputMode: PlacementInteractionMode,
  ) => void;
  beginMarqueeFromScreenPoint: (
    screenPoint: CanvasPoint,
    inputMode: PlacementInteractionMode,
    selectionMode: EditorSelectionUpdateMode,
  ) => void;
  updateMoveDraftFromScreenPoint: (screenPoint: CanvasPoint) => void;
  updateMarqueeDraftFromScreenPoint: (screenPoint: CanvasPoint) => void;
  confirmMovePreview: () => Promise<void>;
  cancelMove: () => void;
  confirmMarqueeSelection: () => Promise<void>;
  cancelMarquee: () => void;
  rotateMoveClockwise: () => void;
  rotatePlacementClockwise: () => void;
  cancelPlacement: () => void;
  centerPlacementPreview: () => void;
  updatePlacementPreviewFromScreenPoint: (screenPoint: CanvasPoint) => void;
  confirmPlacementPreview: () => Promise<void>;
  clearPlacementPreview: () => void;
  selectEntity: (
    entityId: string,
    inputMode?: PlacementInteractionMode | null,
    selectionMode?: EditorSelectionUpdateMode,
  ) => Promise<void>;
  rotateSelectionClockwise: () => Promise<void>;
  clearSelection: () => Promise<void>;
  patchEntityConfig: (
    entityId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  commitPlacementAtScreenPoint: (screenPoint: CanvasPoint) => Promise<void>;
  activateLinkTarget: (entityId: string | null) => Promise<void>;
  removeSelection: () => Promise<void>;
  removeSelectionLinks: () => Promise<void>;
  removeLink: (linkId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export interface EditorFacade {
  readonly query: EditorFacadeQuery;
  readonly action: EditorFacadeAction;
}