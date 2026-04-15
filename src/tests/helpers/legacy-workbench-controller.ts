import type { AppLocale } from "@/i18n/messages";
import type { LogLevel } from "@/shared/logging/logger";
import type { SnapshotStore } from "@/shared/snapshot-store/snapshot-store";
import type { DockId, LeftPanelMode } from "@/workbench/state/workbench-ui-state";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { WorldDocument } from "@/domain/document/world-document";
import type {
  InteractionModeKey,
  PlacementDisplayTool,
} from "@/editor/contracts/interaction-mode";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import type { PlacementInteractionMode } from "@/editor/contracts/placement-preview";
import type { CanvasWorldInput } from "@/editor/host/editor-host";
import type { EditorRuntimeStore } from "@/editor/editor-runtime-store";
import type { CanvasViewStore } from "@/workbench/state/canvas-view-store";
import type { CanvasInteractionTarget } from "@/workbench/contracts/workbench-facade";
import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import type { CanvasPoint } from "@/workbench/state/workspace-state";
import type { ReadonlySnapshotStore } from "@/workbench/state/workspace-store";
import type { WorkbenchUiStore } from "@/workbench/state/workbench-ui-store";

export type LegacyWorkbenchController = WorkbenchController & {
  uiStore: WorkbenchUiStore;
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  editorStore: EditorRuntimeStore;
  canvasViewStore: CanvasViewStore;
  topologyStore: Pick<SnapshotStore<CompiledTopology>, "getSnapshot" | "subscribe">;
  registry: Stage1Registry;
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
  queryWorldInputFromScreenPoint: (screenPoint: CanvasPoint) => CanvasWorldInput;
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
  getCanvasInteractionTarget: (screenPoint: CanvasPoint) => CanvasInteractionTarget;
  commitPlacementAtScreenPoint: (screenPoint: CanvasPoint) => Promise<void>;
  activateLinkTarget: (entityId: string | null) => Promise<void>;
  removeSelection: () => Promise<void>;
  removeSelectionLinks: () => Promise<void>;
  removeLink: (linkId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomCanvasAt: (screenPoint: CanvasPoint, scaleFactor: number) => void;
  panCanvasBy: (screenDelta: CanvasPoint) => void;
  setCanvasViewportSize: (size: CanvasPoint) => void;
  setLeftPanelMode: (mode: LeftPanelMode) => void;
  setLocale: (locale: AppLocale) => void;
  getLogLevel: () => LogLevel;
  setLogLevel: (level: LogLevel) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
};

export function asLegacyWorkbenchController(
  controller: WorkbenchController,
): LegacyWorkbenchController {
  return controller as LegacyWorkbenchController;
}