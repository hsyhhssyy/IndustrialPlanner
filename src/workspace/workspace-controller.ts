import type { AppFacade } from "@/app/app-facade";
import type {
  CanvasInteractionTarget,
  WorkspaceController,
  WorkspaceControllerAction,
  WorkspaceControllerQuery,
} from "@/workspace/workspace-facade";
import type { EditorFacade } from "@/editor/editor-facade";
import type {
  DockId,
  LeftPanelMode,
} from "@/workbench/state/workbench-ui-state";
import { createWorkbenchUiStore } from "@/workbench/state/workbench-ui-store";
import {
  createCanvasViewStore,
  type CanvasViewStore,
} from "@/workbench/state/canvas-view-store";
import {
  createWorkspaceStorage,
  type WorkspacePersistenceState,
  type WorkspaceStorage,
} from "@/workbench/persistence/workspace-storage";
import {
  type CanvasPoint,
  type CanvasViewState,
} from "@/workspace/types";
import {
  createWorkspaceStore,
  type WorkspaceStore,
} from "@/workbench/state/workspace-store";
import {
  clampCanvasViewState,
  clampCanvasViewportSize,
  panCanvasView,
  scaleCanvasViewAt,
  screenToWorldPoint,
  worldToGridPoint,
} from "@/workbench/viewport/viewport-math";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import type { WorldDocument } from "@/domain/document/world-document";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import {
  createStage1Registry,
  getStage1EntityDefinition,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import {
  getManagedMoveDraft,
  getManagedPlacementPreview,
  getSelectedEntityIds,
} from "@/editor/contracts/editor-session-helpers";
import {
  isMoveInteractionMode,
  isPlacementInteractionMode,
  type InteractionModeKey,
  type PlacementDisplayTool,
} from "@/editor/contracts/interaction-mode";
import {
  isSamePlacementPreviewState,
  type PlacementPreviewState,
  type PlacementInteractionMode,
} from "@/editor/contracts/placement-preview";
import type { EditorSelectionUpdateMode } from "@/editor/contracts/selection";
import {
  createEditorHost,
  type CanvasWorldInput,
  type EditorHost,
  type PlacementPreviewUpdateResult,
} from "@/editor/host/editor-host";
import {
  createEditorRuntimeStore,
  type EditorRuntimeStore,
} from "@/editor/editor-runtime-store";
import type { AppLocale } from "@/i18n/messages";
import type { RenderFacade } from "@/renderer/render-facade";
import { deriveRenderWorldBoundsPx } from "@/renderer/scene/render-world-bounds";
import {
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import {
  createLogger,
  setLogLevel as setGlobalLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";
import { action as mobxAction } from "@/shared/mobx";

type WorkspaceState = ReturnType<WorkspaceStore["getSnapshot"]>;

interface MutationState {
  document: WorldDocument;
  selectionId: string | null;
}

type SyncSource = "editor" | "surface";

interface SyncMetrics {
  worldBoundsDurationMs: number;
  storageSaveDurationMs: number;
  totalDurationMs: number;
  persistedWorkspaceChanged: boolean;
  canvasViewClamped: boolean;
}

interface PlacementPreviewDiagnosticWindow {
  startedAt: number;
  lastFlushedAt: number;
  updateCalls: number;
  previewChangedCalls: number;
  previewUnchangedCalls: number;
  slowSyncCount: number;
  totalSyncDurationMs: number;
  slowestSyncDurationMs: number;
  latest:
    | {
        definitionId: string | null;
        interactionMode: PlacementInteractionMode | null;
        screenPoint: CanvasPoint;
        inputGridPoint: CanvasWorldInput["gridPoint"];
        preview: PlacementPreviewState | null;
        invalidReason: PlacementPreviewUpdateResult["invalidReason"];
        hitEntityId: string | null;
        persistedWorkspaceChanged: boolean;
        storageSaveDurationMs: number;
        worldBoundsDurationMs: number;
      }
    | null;
}

const PLACEMENT_PREVIEW_DIAGNOSTIC_WINDOW_MS = 180;
const SLOW_PLACEMENT_PREVIEW_SYNC_MS = 16;

function getDiagnosticTimeMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clonePlacementPreview(
  preview: PlacementPreviewState | null,
): PlacementPreviewState | null {
  if (!preview) {
    return null;
  }

  return {
    ...preview,
    gridPoint: {
      ...preview.gridPoint,
    },
  };
}

function resolveManagedPlacementPreview(
  session: WorkspaceState["editorSession"],
): PlacementPreviewState | null {
  return getManagedPlacementPreview(session);
}

interface CreateWorkbenchControllerOptions {
  workspaceState: WorkspaceState;
  app: AppHost;
  editor: EditorHost;
  render: RenderHost;
  registry?: Stage1Registry;
}

class WorkspaceControllerImpl implements WorkspaceController {
  readonly registry: Stage1Registry;
  readonly workspaceState: WorkspaceState;
  readonly app: AppFacade;
  readonly editor: EditorFacade;
  readonly render: RenderFacade;

  readonly query: WorkspaceControllerQuery;
  readonly action: WorkspaceControllerAction;
  
  private readonly logger = createLogger("workbench.controller");
  private readonly editorHost: EditorHost;
  private readonly renderHost: RenderHost;
  private readonly appHost: AppHost;
  
  private static readonly BUTTON_ZOOM_FACTOR = 1.2;
  private readonly commitWorkspaceMutation = mobxAction(
    "workspace-controller.commitWorkspaceMutation",
    (mutator: () => void) => {
      mutator();
    },
  );

  constructor(options: CreateWorkbenchControllerOptions) {
    this.registry = options.registry ?? createStage1Registry();
    this.workspaceState = options.workspaceState;
    this.appHost = options.app;
    this.editorHost = options.editor;
    this.renderHost = options.render;
    
    this.app = this.appHost.facade;
    this.editor = this.editorHost;
    this.render = this.renderHost.facade;

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
      dispose: () => {},
    };

    this.sync("editor");
  }

  private getPlacementMode(session = this.editorHost.getState().session) {
    return isPlacementInteractionMode(session.currentMode)
      ? session.currentMode
      : null;
  }

  private getMoveMode(session = this.editorHost.getState().session) {
    return isMoveInteractionMode(session.currentMode)
      ? session.currentMode
      : null;
  }

  setInteractionMode(
    modeKey: Exclude<InteractionModeKey, "placement" | "move" | "marquee">,
  ): void {
    this.editorHost.setInteractionMode(modeKey);
    this.sync("editor");
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

  armPlacement(
    definitionId: string,
    displayTool: PlacementDisplayTool = "place",
    inputMode: PlacementInteractionMode = "pointer",
  ): void {
    this.editorHost.armPlacement(definitionId, displayTool, inputMode);
    this.logger.info("Armed placement through workbench controller.", {
      definitionId,
      displayTool,
      inputMode,
      viewportSize: this.viewportSize,
    });
    this.updateUiState((ui) => ({
      ...ui,
      leftPanelMode: "placement",
      leftDock: {
        ...ui.leftDock,
        open: true,
      },
    }));

    if (
      inputMode === "touch" &&
      this.viewportSize.x > 0 &&
      this.viewportSize.y > 0
    ) {
      this.centerPlacementPreview();
      return;
    }

    this.sync("editor");
  }

  beginMoveFromScreenPoint(
    entityId: string,
    screenPoint: CanvasPoint,
    inputMode: PlacementInteractionMode,
  ): void {
    const didBeginMove = this.editorHost.beginMove(
      entityId,
      inputMode,
      this.resolveWorldInput(screenPoint),
    );

    if (!didBeginMove) {
      return;
    }

    this.sync("editor");
  }

  beginMarqueeFromScreenPoint(
    screenPoint: CanvasPoint,
    inputMode: PlacementInteractionMode,
    selectionMode: EditorSelectionUpdateMode,
  ): void {
    const didBeginMarquee = this.editorHost.beginMarquee(
      inputMode,
      selectionMode,
      this.resolveWorldInput(screenPoint),
    );

    if (!didBeginMarquee) {
      return;
    }

    this.sync("editor");
  }

  updateMoveDraftFromScreenPoint(screenPoint: CanvasPoint): void {
    const moveMode = this.getMoveMode();

    if (!moveMode) {
      return;
    }

    this.editorHost.updateMoveDraft(this.resolveWorldInput(screenPoint));
    this.sync("editor");
  }

  updateMarqueeDraftFromScreenPoint(screenPoint: CanvasPoint): void {
    this.editorHost.updateMarqueeDraft(this.resolveWorldInput(screenPoint));
    this.sync("editor");
  }

  queryWorldInputFromScreenPoint(screenPoint: CanvasPoint): CanvasWorldInput {
    return this.resolveWorldInput(screenPoint);
  }

  async confirmMovePreview(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.confirmMove();
    });
  }

  async confirmMarqueeSelection(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.confirmMarqueeSelection();
    });
  }

  cancelMove(): void {
    const didCancel = this.editorHost.cancelMove();

    if (!didCancel) {
      return;
    }

    this.sync("editor");
  }

  cancelMarquee(): void {
    const didCancel = this.editorHost.cancelMarquee();

    if (!didCancel) {
      return;
    }

    this.sync("editor");
  }

  rotateMoveClockwise(): void {
    const didRotate = this.editorHost.rotateMoveClockwise();

    if (!didRotate) {
      return;
    }

    this.sync("editor");
  }

  rotatePlacementClockwise(): void {
    const didRotate = this.editorHost.rotatePlacementClockwise();

    if (!didRotate) {
      return;
    }

    this.sync("editor");
  }

  cancelPlacement(): void {
    const session = this.editorHost.getState().session;
    const placementMode = this.getPlacementMode(session);

    if (!placementMode) {
      return;
    }

    this.editorHost.setInteractionMode("select");
    this.logger.info("Canceled armed placement and returned to select tool.", {
      previousMode: session.currentMode,
      placementDefinitionId: placementMode.definitionId,
      placementInputMode: placementMode.inputMode,
      placementRotation: placementMode.rotation,
    });
    this.sync("editor");
  }

  centerPlacementPreview(): void {
    if (this.viewportSize.x <= 0 || this.viewportSize.y <= 0) {
      return;
    }

    this.updatePlacementPreviewFromScreenPoint(this.getViewportCenterScreenPoint());
  }

  updatePlacementPreviewFromScreenPoint(screenPoint: CanvasPoint): void {
    this.measureProfilerStage("controller.total", () => {
      const sessionBefore = this.editorHost.getState().session;
      const previousPreview = clonePlacementPreview(
        resolveManagedPlacementPreview(sessionBefore),
      );
      const worldInput = this.measureProfilerStage(
        "controller.resolveWorldInput",
        () => this.resolveWorldInput(screenPoint),
      );
      const updateResult = this.editorHost.updatePlacementPreview(worldInput);
      const sessionAfter = this.editorHost.getState().session;
      const nextPreview = clonePlacementPreview(
        resolveManagedPlacementPreview(sessionAfter),
      );
      this.logger.debug("Placement preview updated from screen input.", {
        changed: updateResult.changed,
        previousPreview,
        nextPreview,
      });

      const syncMetrics = this.sync("editor");
      const placementMode = this.getPlacementMode(sessionBefore);

      if (!placementMode) {
        return;
      }

      const definitionId = placementMode.definitionId;
      const interactionMode = placementMode.inputMode;

      this.measureProfilerStage("controller.diagnostics", () => {
        this.recordPlacementPreviewDiagnostic({
          definitionId,
          interactionMode,
          screenPoint,
          worldInput,
          previousPreview,
          nextPreview,
          updateResult,
          syncMetrics,
        });
      });
    });
  }

  async confirmPlacementPreview(): Promise<void> {
    const before = this.captureMutationState();
    const didPlace = this.editorHost.confirmPlacement();

    await this.reconcileMutation(before);

    if (
      didPlace &&
      this.getPlacementMode(this.editorStore.getSnapshot().session)?.inputMode ===
        "touch"
    ) {
      this.centerPlacementPreview();
    }
  }

  clearPlacementPreview(): void {
    this.editorHost.clearPlacementPreview();
    this.sync("editor");
  }

  async selectEntity(
    entityId: string,
    inputMode: PlacementInteractionMode | null = null,
    selectionMode: EditorSelectionUpdateMode = "replace",
  ): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.selectEntity(entityId, inputMode, selectionMode);
      this.editorHost.setLinkSourceEntityId(null);
    });
  }

  async rotateSelectionClockwise(): Promise<void> {
    const before = this.captureMutationState();
    const didRotate = this.editorHost.rotateSelectedEntityClockwise();

    if (!didRotate) {
      return;
    }

    await this.reconcileMutation(before);
  }

  async clearSelection(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.selectEntity(null);
      this.editorHost.setLinkSourceEntityId(null);
    });
  }

  async patchEntityConfig(
    entityId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.patchEntityConfig(entityId, patch);
    });
  }

  getCanvasInteractionTarget(screenPoint: CanvasPoint): CanvasInteractionTarget {
    const worldPoint = screenToWorldPoint(
      screenPoint,
      this.canvasViewStore.getSnapshot(),
    );

    return this.editorHost.queryInteractionTarget(worldPoint);
  }

  async commitPlacementAtScreenPoint(screenPoint: CanvasPoint): Promise<void> {
    const worldInput = this.resolveWorldInput(screenPoint);
    const session = this.editorStore.getSnapshot().session;
    const placementMode = this.getPlacementMode(session);
    this.logger.info("Attempting placement commit from screen point.", {
      screenPoint,
      worldPoint: worldInput.worldPoint,
      gridPoint: worldInput.gridPoint,
      currentMode: session.currentMode,
      displayTool: session.displayTool,
      placementDefinitionId: placementMode?.definitionId ?? null,
      placementInputMode: placementMode?.inputMode ?? null,
      placementRotation: placementMode?.rotation ?? null,
    });
    const before = this.captureMutationState();
    const didPlace = this.editorHost.commitPlacement(worldInput);

    if (!didPlace) {
      this.logger.info("Placement commit did not mutate the document.", {
        screenPoint,
        worldPoint: worldInput.worldPoint,
        gridPoint: worldInput.gridPoint,
      });
    }

    await this.reconcileMutation(before);
  }

  async activateLinkTarget(entityId: string | null): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.activateLinkTarget(entityId);
    });
  }

  async removeSelection(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.removeSelectedEntities();
    });
  }

  async removeSelectionLinks(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.removeSelectedLinks();
    });
  }

  async removeLink(linkId: string): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.removeLink(linkId);
    });
  }

  async undo(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.undo();
      this.editorHost.setLinkSourceEntityId(null);
    });
  }

  async redo(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.redo();
      this.editorHost.setLinkSourceEntityId(null);
    });
  }

  zoomIn(): void {
    this.zoomCanvasAt(
      this.getViewportCenterScreenPoint(),
      WorkspaceControllerImpl.BUTTON_ZOOM_FACTOR,
    );
  }

  zoomOut(): void {
    this.zoomCanvasAt(
      this.getViewportCenterScreenPoint(),
      1 / WorkspaceControllerImpl.BUTTON_ZOOM_FACTOR,
    );
  }

  zoomCanvasAt(screenPoint: CanvasPoint, scaleFactor: number): void {
    const didChange = this.updateCanvasView((canvasView) =>
      scaleCanvasViewAt(
        canvasView,
        screenPoint,
        scaleFactor,
        this.getViewportMetrics(),
      ),
    );

    if (didChange) {
      this.sync("surface");
    }
  }

  panCanvasBy(screenDelta: CanvasPoint): void {
    const didChange = this.updateCanvasView((canvasView) =>
      panCanvasView(canvasView, screenDelta, this.getViewportMetrics()),
    );

    if (didChange) {
      this.sync("surface");
    }
  }

  setCanvasViewportSize(size: CanvasPoint): void {
    this.viewportSize = clampCanvasViewportSize(size);
    const didChange = this.updateCanvasView((canvasView) =>
      clampCanvasViewState(canvasView, this.getViewportMetrics()),
    );

    if (didChange) {
      this.sync("surface");
    }
  }

  setLeftPanelMode(mode: LeftPanelMode): void {
    const didChange = this.updateUiState((ui) => {
      if (ui.leftPanelMode === mode && ui.leftDock.open) {
        return ui;
      }

      return {
        ...ui,
        leftPanelMode: mode,
        leftDock: {
          ...ui.leftDock,
          open: true,
        },
      };
    });

    if (didChange) {
      this.sync("surface");
    }
  }

  setLocale(locale: AppLocale): void {
    const didChange = this.updateUiState((ui) => {
      if (ui.locale === locale) {
        return ui;
      }

      return {
        ...ui,
        locale,
      };
    });

    if (didChange) {
      this.sync("surface");
    }
  }

  getLogLevel(): LogLevel {
    return this.workspaceState.ui.logLevel;
  }

  setLogLevel(level: LogLevel): void {
    const didChange = this.updateUiState((ui) => {
      if (ui.logLevel === level) {
        return ui;
      }

      return {
        ...ui,
        logLevel: level,
      };
    });

    if (!didChange) {
      return;
    }

    setGlobalLogLevel(level, { announce: true });
    this.sync("surface");
  }

  setDiagnosticsVisible(visible: boolean): void {
    const didChange = this.updateUiState((ui) => {
      if (ui.diagnosticsVisible === visible) {
        return ui;
      }

      return {
        ...ui,
        diagnosticsVisible: visible,
      };
    });

    if (didChange) {
      this.sync("surface");
    }
  }

  setDockOpen(dockId: DockId, open: boolean): void {
    const didChange = this.updateUiState((ui) => {
      const dockStateKey = dockId === "left" ? "leftDock" : "rightDock";
      const currentDock = ui[dockStateKey];
      const nextDock = {
        ...currentDock,
        open,
        collapsed: open ? currentDock.collapsed : false,
      };

      if (
        currentDock.open === nextDock.open &&
        currentDock.collapsed === nextDock.collapsed
      ) {
        return ui;
      }

      return {
        ...ui,
        [dockStateKey]: nextDock,
      };
    });

    if (didChange) {
      this.sync("surface");
    }
  }

  toggleDockCollapsed(dockId: DockId): void {
    const didChange = this.updateUiState((ui) => {
      const dockStateKey = dockId === "left" ? "leftDock" : "rightDock";
      const currentDock = ui[dockStateKey];
      const nextDock = {
        open: true,
        collapsed: !currentDock.collapsed,
      };

      if (
        currentDock.open === nextDock.open &&
        currentDock.collapsed === nextDock.collapsed
      ) {
        return ui;
      }

      return {
        ...ui,
        [dockStateKey]: nextDock,
      };
    });

    if (didChange) {
      this.sync("surface");
    }
  }

  dispose(): void {
    this.canvasKeyboardFocusListeners.clear();
    this.workspaceStore.dispose();
  }

  private reloadCompiledWorld(): void {
    this.topology = compileStage1World(this.editorHost.getDocument(), this.registry);
  }

  private captureMutationState(): MutationState {
    return {
      document: this.documentStore.getSnapshot(),
      selectionId: this.getActiveSelectionId(),
    };
  }

  private async applyEditorMutation(mutator: () => void): Promise<void> {
    const before = this.captureMutationState();
    mutator();
    await this.reconcileMutation(before);
  }

  private async reconcileMutation(before: MutationState): Promise<void> {
    const documentChanged = this.editorHost.getDocument() !== before.document;

    if (documentChanged) {
      this.reloadCompiledWorld();
      this.logger.debug("Recompiled topology after document mutation.", {
        compileVersion: this.topology.compileVersion,
      });
    }

    const afterEditorState = this.editorHost.getState();
    const afterSelectionId = getSelectedEntityIds(afterEditorState.session)[0] ?? null;
    const selectionChanged = before.selectionId !== afterSelectionId;

    if (documentChanged || selectionChanged) {
      this.logger.debug("Applied editor mutation with observable selection/document delta.", {
        documentChanged,
        selectionChanged,
      });
    }

    this.sync("editor");
  }

  private getActiveSelectionId(): string | null {
    return getSelectedEntityIds(this.editorHost.getState().session)[0] ?? null;
  }

  private getViewportCenterScreenPoint(): CanvasPoint {
    return {
      x: this.viewportSize.x / 2,
      y: this.viewportSize.y / 2,
    };
  }

  private resolveWorldInput(screenPoint: CanvasPoint): CanvasWorldInput {
    const document = this.documentStore.getSnapshot();
    const worldPoint = screenToWorldPoint(
      screenPoint,
      this.canvasViewStore.getSnapshot(),
    );

    return {
      worldPoint,
      gridPoint: worldToGridPoint(worldPoint, document.documentSettings.gridSize),
    };
  }

  private updateUiState(
    updater: (ui: WorkspaceState["ui"]) => WorkspaceState["ui"],
  ): boolean {
    const currentUi = this.workspaceState.ui;
    const nextUi = updater(currentUi);

    if (nextUi === currentUi) {
      return false;
    }

    this.commitWorkspaceMutation(() => {
      this.workspaceState.ui = nextUi;
    });
    this.uiStore.setSnapshot(nextUi);
    return true;
  }

  private updateCanvasView(
    updater: (canvasView: CanvasViewState) => CanvasViewState,
  ): boolean {
    const currentCanvasView = this.workspaceState.canvasView;
    const nextCanvasView = updater(currentCanvasView);

    if (nextCanvasView === currentCanvasView) {
      return false;
    }

    this.commitWorkspaceMutation(() => {
      this.workspaceState.canvasView = nextCanvasView;
    });
    this.canvasViewStore.setSnapshot(nextCanvasView);
    return true;
  }

  private sync(source: SyncSource): SyncMetrics {
    return this.measureProfilerStage("controller.sync.total", () => {
      const startedAt = getDiagnosticTimeMs();

      if (source === "editor") {
        this.editorStore.setSnapshot(this.editorHost.getState());
      }

      const syncState = this.getSyncWorkspaceState(source);
      const {
        clampedCanvasView,
        worldBoundsDurationMs,
        canvasViewClamped,
      } = this.clampWorkspaceStateCanvasView(syncState);
      const publishedState = this.publishWorkspaceSlices(
        source,
        syncState,
        clampedCanvasView,
      );
      const { persistedWorkspaceChanged, storageSaveDurationMs } =
        this.persistWorkspaceStateIfNeeded(publishedState);

      return {
        worldBoundsDurationMs,
        storageSaveDurationMs,
        totalDurationMs: getDiagnosticTimeMs() - startedAt,
        persistedWorkspaceChanged,
        canvasViewClamped,
      };
    });
  }

  private getSyncWorkspaceState(source: SyncSource): WorkspaceState {
    const editorState =
      source === "editor"
        ? this.editorStore.getSnapshot()
        : {
            session: this.workspaceStore.editorSession,
            history: this.workspaceStore.editorHistory,
          };

    return {
      document:
        source === "editor" ? this.editorHost.getDocument() : this.workspaceStore.document,
      topology: source === "editor" ? this.topology : this.workspaceStore.topology,
      editorSession: editorState.session,
      editorHistory: editorState.history,
      ui: this.workspaceState.ui,
      canvasView: this.workspaceState.canvasView,
    };
  }

  private publishWorkspaceSlices(
    source: SyncSource,
    workspaceState: WorkspaceState,
    clampedCanvasView: CanvasViewState,
  ): WorkspaceState {
    const rootStoreSetStartedAt = getDiagnosticTimeMs();
    const nextCanvasView =
      clampedCanvasView === workspaceState.canvasView
        ? workspaceState.canvasView
        : clampedCanvasView;

    if (nextCanvasView !== workspaceState.canvasView) {
      this.commitWorkspaceMutation(() => {
        this.workspaceState.canvasView = nextCanvasView;
      });
      this.canvasViewStore.setSnapshot(nextCanvasView);
    }

    const publishedState =
      source === "editor"
        ? this.workspaceStore.publishSlices({
            document: workspaceState.document,
            topology: workspaceState.topology,
            editorSession: workspaceState.editorSession,
            editorHistory: workspaceState.editorHistory,
            ui: workspaceState.ui,
            canvasView: nextCanvasView,
          })
        : this.workspaceStore.publishSlices({
            ui: workspaceState.ui,
            canvasView: nextCanvasView,
          });

    this.recordProfilerStageDuration(
      "controller.sync.rootStoreSet",
      getDiagnosticTimeMs() - rootStoreSetStartedAt,
    );

    return publishedState;
  }

  private createWorkspacePersistenceState(
    workspaceState: WorkspaceState,
  ): WorkspacePersistenceState {
    return {
      ui: workspaceState.ui,
      canvasView: workspaceState.canvasView,
    } satisfies WorkspacePersistenceState;
  }

  private persistWorkspaceStateIfNeeded(workspaceState: WorkspaceState): {
    persistedWorkspaceChanged: boolean;
    storageSaveDurationMs: number;
  } {
    const persistenceState = this.createWorkspacePersistenceState(workspaceState);
    const persistedWorkspaceChanged =
      this.lastSavedWorkspacePersistence === null ||
      this.lastSavedWorkspacePersistence.ui !== persistenceState.ui ||
      this.lastSavedWorkspacePersistence.canvasView !== persistenceState.canvasView;

    if (!persistedWorkspaceChanged) {
      return {
        persistedWorkspaceChanged,
        storageSaveDurationMs: 0,
      };
    }

    const storageSaveStartedAt = getDiagnosticTimeMs();
    this.storage.saveWorkspaceState(persistenceState);
    this.lastSavedWorkspacePersistence = persistenceState;

    return {
      persistedWorkspaceChanged,
      storageSaveDurationMs: getDiagnosticTimeMs() - storageSaveStartedAt,
    };
  }

  private clampWorkspaceStateCanvasView(workspaceState: WorkspaceState): {
    clampedCanvasView: CanvasViewState;
    worldBoundsDurationMs: number;
    canvasViewClamped: boolean;
  } {
    const worldBoundsStartedAt = getDiagnosticTimeMs();
    const clampedCanvasView = this.measureProfilerStage(
      "controller.sync.worldBounds",
      () =>
        clampCanvasViewState(
          workspaceState.canvasView,
          this.getViewportMetrics(workspaceState),
        ),
    );
    const worldBoundsDurationMs = getDiagnosticTimeMs() - worldBoundsStartedAt;

    return {
      clampedCanvasView,
      worldBoundsDurationMs,
      canvasViewClamped: clampedCanvasView !== workspaceState.canvasView,
    };
  }

  private getWorkspaceProjectionState(): WorkspaceState {
    return this.workspaceState;
  }

  private getViewportMetrics(workspaceState = this.getWorkspaceProjectionState()) {
    return {
      gridSize: workspaceState.document.documentSettings.gridSize,
      size: this.viewportSize,
      worldSize: this.getRenderWorldSize(workspaceState),
    };
  }

  private getRenderWorldSize(workspaceState: WorkspaceState): CanvasPoint {
    const worldBoundsPx = deriveRenderWorldBoundsPx({
      document: workspaceState.document,
      topology: workspaceState.topology,
      registry: this.registry,
      placementPreview: getManagedPlacementPreview(workspaceState.editorSession),
      moveDraft: getManagedMoveDraft(
        workspaceState.editorSession,
        workspaceState.document,
      ),
    });

    return {
      x: worldBoundsPx.width,
      y: worldBoundsPx.height,
    };
  }

  private recordPlacementPreviewDiagnostic(options: {
    definitionId: string;
    interactionMode: PlacementInteractionMode;
    screenPoint: CanvasPoint;
    worldInput: CanvasWorldInput;
    previousPreview: PlacementPreviewState | null;
    nextPreview: PlacementPreviewState | null;
    updateResult: PlacementPreviewUpdateResult;
    syncMetrics: SyncMetrics;
  }): void {
    const now = getDiagnosticTimeMs();
    const diagnostics = this.placementPreviewDiagnostics;

    if (diagnostics.startedAt === 0) {
      diagnostics.startedAt = now;
      diagnostics.lastFlushedAt = now;
    }

    diagnostics.updateCalls += 1;
    diagnostics.totalSyncDurationMs += options.syncMetrics.totalDurationMs;

    if (options.updateResult.changed) {
      diagnostics.previewChangedCalls += 1;
    } else {
      diagnostics.previewUnchangedCalls += 1;
    }

    if (options.syncMetrics.totalDurationMs >= SLOW_PLACEMENT_PREVIEW_SYNC_MS) {
      diagnostics.slowSyncCount += 1;
      diagnostics.slowestSyncDurationMs = Math.max(
        diagnostics.slowestSyncDurationMs,
        options.syncMetrics.totalDurationMs,
      );
    }

    diagnostics.latest = {
      definitionId: options.definitionId,
      interactionMode: options.interactionMode,
      screenPoint: options.screenPoint,
      inputGridPoint: options.worldInput.gridPoint,
      preview: clonePlacementPreview(options.nextPreview),
      invalidReason: options.updateResult.invalidReason,
      hitEntityId: options.updateResult.hitEntityId,
      persistedWorkspaceChanged: options.syncMetrics.persistedWorkspaceChanged,
      storageSaveDurationMs: Number(options.syncMetrics.storageSaveDurationMs.toFixed(2)),
      worldBoundsDurationMs: Number(
        options.syncMetrics.worldBoundsDurationMs.toFixed(2),
      ),
    };

    if (
      options.syncMetrics.totalDurationMs >= SLOW_PLACEMENT_PREVIEW_SYNC_MS ||
      now - diagnostics.lastFlushedAt >= PLACEMENT_PREVIEW_DIAGNOSTIC_WINDOW_MS
    ) {
      const sampleWindowMs = now - diagnostics.startedAt;
      const averageSyncDurationMs =
        diagnostics.updateCalls > 0
          ? diagnostics.totalSyncDurationMs / diagnostics.updateCalls
          : 0;
      const context = {
        sampleWindowMs: Number(sampleWindowMs.toFixed(2)),
        updateCalls: diagnostics.updateCalls,
        previewChangedCalls: diagnostics.previewChangedCalls,
        previewUnchangedCalls: diagnostics.previewUnchangedCalls,
        averageSyncDurationMs: Number(averageSyncDurationMs.toFixed(2)),
        slowestSyncDurationMs: Number(diagnostics.slowestSyncDurationMs.toFixed(2)),
        slowSyncCount: diagnostics.slowSyncCount,
        previousPreview: clonePlacementPreview(options.previousPreview),
        latest: diagnostics.latest,
        latestSync: {
          totalDurationMs: Number(options.syncMetrics.totalDurationMs.toFixed(2)),
          worldBoundsDurationMs: Number(
            options.syncMetrics.worldBoundsDurationMs.toFixed(2),
          ),
          storageSaveDurationMs: Number(
            options.syncMetrics.storageSaveDurationMs.toFixed(2),
          ),
          persistedWorkspaceChanged: options.syncMetrics.persistedWorkspaceChanged,
          canvasViewClamped: options.syncMetrics.canvasViewClamped,
          previewChanged: !isSamePlacementPreviewState(
            options.previousPreview,
            options.nextPreview,
          ),
        },
      };

      if (options.syncMetrics.totalDurationMs >= SLOW_PLACEMENT_PREVIEW_SYNC_MS) {
        this.logger.info("Placement preview pipeline exceeded the frame budget.", context);
      } else {
        this.logger.debug("Placement preview pipeline sample.", context);
      }

      diagnostics.startedAt = now;
      diagnostics.lastFlushedAt = now;
      diagnostics.updateCalls = 0;
      diagnostics.previewChangedCalls = 0;
      diagnostics.previewUnchangedCalls = 0;
      diagnostics.slowSyncCount = 0;
      diagnostics.totalSyncDurationMs = 0;
      diagnostics.slowestSyncDurationMs = 0;
      diagnostics.latest = null;
    }
  }

  private measureProfilerStage<T>(
    stageId:
      | "controller.total"
      | "controller.resolveWorldInput"
      | "controller.sync.total"
      | "controller.sync.worldBounds"
      | "controller.diagnostics",
    callback: () => T,
  ): T {
    

    return callback();
  }

  private recordProfilerStageDuration(
    stageId:
      | "controller.sync.rootStoreSet",
    durationMs: number,
  ): void {
  }
}

export function createWorkspaceController(
  options: CreateWorkbenchControllerOptions,
): WorkspaceController {
  return new WorkspaceControllerImpl(options);
}
