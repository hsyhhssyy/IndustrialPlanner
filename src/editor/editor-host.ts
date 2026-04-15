import type {
  CanvasInteractionTarget,
  EditorFacade,
} from "@/editor/editor-facade";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type {
  InteractionModeKey,
  PlacementDisplayTool,
} from "@/editor/contracts/interaction-mode";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import type { CanvasWorldInput } from "@/editor/host/editor-host";
import type { CanvasPoint } from "@/workspace/workspace-state";

export class EditorHost implements EditorFacade {
  readonly query = {
    getCanvasInteractionTarget: (_screenPoint: CanvasPoint): CanvasInteractionTarget =>
      null as unknown as CanvasInteractionTarget,
    queryWorldInputFromScreenPoint: (_screenPoint: CanvasPoint): CanvasWorldInput =>
      null as unknown as CanvasWorldInput,
  };

  readonly action = {
    setInteractionMode: (
      _mode: Exclude<InteractionModeKey, "placement" | "move" | "marquee">,
    ): void => {},
    armPlacement: (
      _definitionId: string,
      _displayTool?: PlacementDisplayTool,
      _inputMode?: PlacementInteractionMode,
    ): void => {},
    beginMoveFromScreenPoint: (
      _entityId: string,
      _screenPoint: CanvasPoint,
      _inputMode: PlacementInteractionMode,
    ): void => {},
    beginMarqueeFromScreenPoint: (
      _screenPoint: CanvasPoint,
      _inputMode: PlacementInteractionMode,
      _selectionMode: EditorSelectionUpdateMode,
    ): void => {},
    updateMoveDraftFromScreenPoint: (_screenPoint: CanvasPoint): void => {},
    updateMarqueeDraftFromScreenPoint: (_screenPoint: CanvasPoint): void => {},
    confirmMovePreview: async (): Promise<void> => {},
    cancelMove: (): void => {},
    confirmMarqueeSelection: async (): Promise<void> => {},
    cancelMarquee: (): void => {},
    rotateMoveClockwise: (): void => {},
    rotatePlacementClockwise: (): void => {},
    cancelPlacement: (): void => {},
    centerPlacementPreview: (): void => {},
    updatePlacementPreviewFromScreenPoint: (_screenPoint: CanvasPoint): void => {},
    confirmPlacementPreview: async (): Promise<void> => {},
    clearPlacementPreview: (): void => {},
    selectEntity: async (
      _entityId: string,
      _inputMode?: PlacementInteractionMode | null,
      _selectionMode?: EditorSelectionUpdateMode,
    ): Promise<void> => {},
    rotateSelectionClockwise: async (): Promise<void> => {},
    clearSelection: async (): Promise<void> => {},
    patchEntityConfig: async (
      _entityId: string,
      _patch: Record<string, unknown>,
    ): Promise<void> => {},
    commitPlacementAtScreenPoint: async (_screenPoint: CanvasPoint): Promise<void> => {},
    activateLinkTarget: async (_entityId: string | null): Promise<void> => {},
    removeSelection: async (): Promise<void> => {},
    removeSelectionLinks: async (): Promise<void> => {},
    removeLink: async (_linkId: string): Promise<void> => {},
    undo: async (): Promise<void> => {},
    redo: async (): Promise<void> => {},
  };
}

export function createEditorHost(): EditorFacade {
  return new EditorHost();
}