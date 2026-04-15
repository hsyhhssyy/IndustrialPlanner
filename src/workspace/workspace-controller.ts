import type { AppFacade } from "@/app/app-facade";
import type {
  CanvasInteractionTarget,
  EditorFacade,
} from "@/editor/editor-facade";
import type { CanvasWorldInput } from "@/editor/host/editor-host";
import {
  createStage1Registry,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import type { RenderFacade } from "@/renderer/render-facade";
import type { LogLevel } from "@/shared/logging/logger";
import type { WorkspaceState } from "@/workspace/types";
import type {
  WorkspaceController,
  WorkspaceControllerAction,
  WorkspaceControllerQuery,
} from "@/workspace/workspace-facade";

export interface CreateWorkbenchControllerOptions {
  workspaceState?: WorkspaceState;
  app?: AppFacade;
  editor?: EditorFacade;
  render?: RenderFacade;
  registry?: Stage1Registry;
}

function createNullAppFacade(): AppFacade {
  return {
    query: {
      getLogLevel: () => null as unknown as LogLevel,
    },
    action: {
      setLeftPanelMode: (_mode) => {},
      setLocale: (_locale) => {},
      setLogLevel: (_level) => {},
      setDiagnosticsVisible: (_visible) => {},
      setDockOpen: (_dockId, _open) => {},
      toggleDockCollapsed: (_dockId) => {},
    },
  };
}

function createNullEditorFacade(): EditorFacade {
  return {
    query: {
      getCanvasInteractionTarget: (_screenPoint) =>
        null as unknown as CanvasInteractionTarget,
      queryWorldInputFromScreenPoint: (_screenPoint) =>
        null as unknown as CanvasWorldInput,
    },
    action: {
      setInteractionMode: (_modeKey) => {},
      armPlacement: (_definitionId, _displayTool, _inputMode) => {},
      beginMoveFromScreenPoint: (_entityId, _screenPoint, _inputMode) => {},
      beginMarqueeFromScreenPoint: (_screenPoint, _inputMode, _selectionMode) => {},
      updateMoveDraftFromScreenPoint: (_screenPoint) => {},
      updateMarqueeDraftFromScreenPoint: (_screenPoint) => {},
      confirmMovePreview: async () => {},
      cancelMove: () => {},
      confirmMarqueeSelection: async () => {},
      cancelMarquee: () => {},
      rotateMoveClockwise: () => {},
      rotatePlacementClockwise: () => {},
      cancelPlacement: () => {},
      centerPlacementPreview: () => {},
      updatePlacementPreviewFromScreenPoint: (_screenPoint) => {},
      confirmPlacementPreview: async () => {},
      clearPlacementPreview: () => {},
      selectEntity: async (_entityId, _inputMode, _selectionMode) => {},
      rotateSelectionClockwise: async () => {},
      clearSelection: async () => {},
      patchEntityConfig: async (_entityId, _patch) => {},
      commitPlacementAtScreenPoint: async (_screenPoint) => {},
      activateLinkTarget: async (_entityId) => {},
      removeSelection: async () => {},
      removeSelectionLinks: async () => {},
      removeLink: async (_linkId) => {},
      undo: async () => {},
      redo: async () => {},
    },
  };
}

function createNullRenderFacade(): RenderFacade {
  return {
    query: {},
    action: {
      zoomIn: () => {},
      zoomOut: () => {},
      zoomCanvasAt: (_screenPoint, _scaleFactor) => {},
      panCanvasBy: (_screenDelta) => {},
      setCanvasViewportSize: (_size) => {},
    },
  };
}

class WorkspaceControllerImpl implements WorkspaceController {
  readonly registry: Stage1Registry;
  readonly workspaceState: WorkspaceState;
  readonly app: AppFacade;
  readonly editor: EditorFacade;
  readonly render: RenderFacade;

  readonly query: WorkspaceControllerQuery;
  readonly action: WorkspaceControllerAction;

  private readonly canvasKeyboardFocusListeners = new Set<() => void>();

  constructor(options: CreateWorkbenchControllerOptions = {}) {
    this.registry = options.registry ?? createStage1Registry();
    this.workspaceState = options.workspaceState ?? ({} as WorkspaceState);
    this.app = options.app ?? createNullAppFacade();
    this.editor = options.editor ?? createNullEditorFacade();
    this.render = options.render ?? createNullRenderFacade();

    this.query = {
      getCanvasInteractionTarget: (_screenPoint) =>
        null as unknown as CanvasInteractionTarget,
      queryWorldInputFromScreenPoint: (_screenPoint) =>
        null as unknown as CanvasWorldInput,
      getLogLevel: () => null as unknown as LogLevel,
    };

    this.action = {
      requestCanvasKeyboardFocus: () => {},
      setInteractionMode: (_modeKey) => {},
      armPlacement: (_definitionId, _displayTool, _inputMode) => {},
      beginMoveFromScreenPoint: (_entityId, _screenPoint, _inputMode) => {},
      beginMarqueeFromScreenPoint: (_screenPoint, _inputMode, _selectionMode) => {},
      updateMoveDraftFromScreenPoint: (_screenPoint) => {},
      updateMarqueeDraftFromScreenPoint: (_screenPoint) => {},
      confirmMovePreview: async () => {},
      cancelMove: () => {},
      confirmMarqueeSelection: async () => {},
      cancelMarquee: () => {},
      rotateMoveClockwise: () => {},
      rotatePlacementClockwise: () => {},
      cancelPlacement: () => {},
      centerPlacementPreview: () => {},
      updatePlacementPreviewFromScreenPoint: (_screenPoint) => {},
      confirmPlacementPreview: async () => {},
      clearPlacementPreview: () => {},
      selectEntity: async (_entityId, _inputMode, _selectionMode) => {},
      rotateSelectionClockwise: async () => {},
      clearSelection: async () => {},
      patchEntityConfig: async (_entityId, _patch) => {},
      commitPlacementAtScreenPoint: async (_screenPoint) => {},
      activateLinkTarget: async (_entityId) => {},
      removeSelection: async () => {},
      removeSelectionLinks: async () => {},
      removeLink: async (_linkId) => {},
      undo: async () => {},
      redo: async () => {},
      zoomIn: () => {},
      zoomOut: () => {},
      zoomCanvasAt: (_screenPoint, _scaleFactor) => {},
      panCanvasBy: (_screenDelta) => {},
      setCanvasViewportSize: (_size) => {},
      setLeftPanelMode: (_mode) => {},
      setLocale: (_locale) => {},
      setLogLevel: (_level) => {},
      setDiagnosticsVisible: (_visible) => {},
      setDockOpen: (_dockId, _open) => {},
      toggleDockCollapsed: (_dockId) => {},
      dispose: () => this.dispose(),
    };
  }

  requestCanvasKeyboardFocus(): void {
    for (const listener of this.canvasKeyboardFocusListeners) {
      listener();
    }
  }

  subscribeCanvasKeyboardFocusRequests(listener: () => void): () => void {
    this.canvasKeyboardFocusListeners.add(listener);

    return () => {
      this.canvasKeyboardFocusListeners.delete(listener);
    };
  }

  dispose(): void {
    this.canvasKeyboardFocusListeners.clear();
  }
}

export function createWorkbenchController(
  options: CreateWorkbenchControllerOptions = {},
): WorkspaceController {
  return new WorkspaceControllerImpl(options);
}

export const createWorkspaceController = createWorkbenchController;
