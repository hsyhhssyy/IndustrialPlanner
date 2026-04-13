import type {
  CanvasInteractionTarget,
  WorkbenchController,
} from "@/workbench/contracts/workbench-facade";
import type {
  DockId,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchPhase,
} from "@/workbench/workbench-ui-state";
import {
  getWorkbenchStatusMessageKeyForMode,
  createWorkbenchUiStore,
} from "@/workbench/workbench-ui-store";
import { createCanvasViewStore } from "@/workbench/canvas-view-store";
import {
  createWorkspaceStorage,
  type WorkspacePersistenceState,
  type WorkspaceStorage,
} from "@/workbench/persistence/workspace-storage";
import {
  type CanvasPoint,
  type CanvasViewState,
  type WorkspaceState,
} from "@/workbench/workspace-state";
import {
  createWorkspaceStore,
  type WorkspaceStore,
} from "@/workbench/workspace-store";
import {
  clampCanvasViewState,
  clampCanvasViewportSize,
  panCanvasView,
  scaleCanvasViewAt,
  screenToWorldPoint,
  worldToGridPoint,
} from "@/workbench/viewport-math";
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
  getPendingLinkSourceEntityId,
  isInteractionModeAvailableInPhase,
  isMoveInteractionMode,
  isPlacementInteractionMode,
  resolveDefaultNextInteractionMode,
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
} from "@/editor/editor-runtime-store";
import type { AppLocale } from "@/i18n/messages";
import { deriveRenderWorldBoundsPx } from "@/renderer/scene/render-world-bounds";
import {
  createSimulationHost,
  type SimulationHost,
} from "@/simulation/host/simulation-host";
import {
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import {
  createLogger,
  setLogLevel as setGlobalLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";

interface MutationState {
  document: WorldDocument;
  selectionId: string | null;
  pendingLinkSourceEntityId: string | null;
}

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
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

class WorkbenchControllerImpl implements WorkbenchController {
  readonly registry: Stage1Registry;
  readonly uiStore;
  readonly documentStore;
  readonly editorStore;
  readonly canvasViewStore;
  readonly topologyStore: Pick<SnapshotStore<CompiledTopology>, "getSnapshot" | "subscribe">;
  readonly runtimeSnapshotStore;
  readonly simulationSelectionStore;
  readonly simulationInspectorDetailsStore;
  readonly simulationPatchSetStore;

  private readonly logger = createLogger("workbench.controller");
  private readonly placementPreviewProfiler?: PlacementPreviewProfiler;
  private readonly canvasKeyboardFocusListeners = new Set<() => void>();
  private readonly storage: WorkspaceStorage;
  private readonly workspaceStore: WorkspaceStore;
  private readonly editorHost: EditorHost;
  private readonly simulationHost: SimulationHost;
  private readonly unsubscribeSimulationHost: () => void;
  private readonly placementPreviewDiagnostics: PlacementPreviewDiagnosticWindow = {
    startedAt: 0,
    lastFlushedAt: 0,
    updateCalls: 0,
    previewChangedCalls: 0,
    previewUnchangedCalls: 0,
    slowSyncCount: 0,
    totalSyncDurationMs: 0,
    slowestSyncDurationMs: 0,
    latest: null,
  };
  private lastSavedWorkspacePersistence: WorkspacePersistenceState | null = null;

  private topology: CompiledTopology;
  private viewportSize: CanvasPoint = { x: 0, y: 0 };

  private static readonly BUTTON_ZOOM_FACTOR = 1.2;

  constructor(options: CreateWorkbenchControllerOptions = {}) {
    this.placementPreviewProfiler = options.placementPreviewProfiler;
    this.registry = createStage1Registry();
    this.storage = createWorkspaceStorage();

    const persistedState = this.storage.loadWorkspaceState();
    this.uiStore = createWorkbenchUiStore(persistedState.ui);
    this.canvasViewStore = createCanvasViewStore(persistedState.canvasView);
    setGlobalLogLevel(this.uiStore.logLevel);

    this.editorHost = createEditorHost({
      document: createStage1SeedWorldDocument(),
      session: createInitialEditorSession(),
      getTopology: () => this.topology,
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(this.registry, definitionId),
      placementPreviewProfiler: this.placementPreviewProfiler,
    });
    this.topology = compileStage1World(this.editorHost.getDocument(), this.registry);
    this.editorStore = createEditorRuntimeStore(this.editorHost.getState());
    this.simulationHost = createSimulationHost();
    this.loadSimulationWorld();
    const simulationState = this.simulationHost.getSnapshot();

    this.workspaceStore = createWorkspaceStore({
      document: this.editorHost.getDocument(),
      topology: this.topology,
      editorSession: this.editorStore.getSnapshot().session,
      editorHistory: this.editorStore.getSnapshot().history,
      ui: this.uiStore.getSnapshot(),
      canvasView: this.canvasViewStore.getSnapshot(),
      runtimeSnapshot: simulationState.runtimeSnapshot,
      simulationSelection: simulationState.selection,
      simulationInspectorDetails: simulationState.inspectorDetails,
      simulationPatchSet: simulationState.patchSet,
    });
    this.documentStore = this.workspaceStore.documentStore;
    this.runtimeSnapshotStore = this.workspaceStore.runtimeSnapshotStore;
    this.simulationSelectionStore = this.workspaceStore.simulationSelectionStore;
    this.simulationInspectorDetailsStore =
      this.workspaceStore.simulationInspectorDetailsStore;
    this.simulationPatchSetStore = this.workspaceStore.simulationPatchSetStore;
    this.topologyStore = this.workspaceStore.topologyStore;

    this.unsubscribeSimulationHost = this.simulationHost.subscribe(() => {
      this.sync();
    });

    this.sync();
    void this.refreshInspectorForSelection();
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

  setPhase(phase: WorkbenchPhase): void {
    const previousPhase = this.uiStore.getSnapshot().phase;

    if (phase === "simulate") {
      this.editorHost.clearPlacementPreview();

      const currentMode = this.editorHost.getState().session.currentMode;

      if (!isInteractionModeAvailableInPhase(currentMode, phase)) {
        this.editorHost.setInteractionMode(
          resolveDefaultNextInteractionMode(currentMode).key as Exclude<
            InteractionModeKey,
            "placement" | "move" | "marquee"
          >,
        );
      }
    }

    if (previousPhase === "simulate" && phase === "edit") {
      this.simulationHost.clearPatches();
    }

    if (phase === "edit") {
      this.simulationHost.pause();
    }

    const didChange = this.updateUiState((ui) => {
      if (ui.phase === phase) {
        return ui;
      }

      return {
        ...ui,
        phase,
        statusMessageKey: getWorkbenchStatusMessageKeyForMode(phase),
      };
    });

    if (!didChange && previousPhase === phase) {
      return;
    }

    this.sync();
    void this.refreshInspectorForSelection();
  }

  setInteractionMode(
    modeKey: Exclude<InteractionModeKey, "placement" | "move" | "marquee">,
  ): void {
    this.editorHost.setInteractionMode(modeKey);
    this.sync();
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
    if (this.uiStore.getSnapshot().phase === "simulate") {
      this.logger.warn("Ignored placement request while simulate mode is active.", {
        definitionId,
        displayTool,
        inputMode,
      });
      return;
    }

    this.editorHost.armPlacement(definitionId, displayTool, inputMode);
    this.logger.info("Armed placement through workbench controller.", {
      definitionId,
      displayTool,
      inputMode,
      viewportSize: this.viewportSize,
      phase: this.uiStore.getSnapshot().phase,
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

    this.sync();
  }

  beginMoveFromScreenPoint(
    entityId: string,
    screenPoint: CanvasPoint,
    inputMode: PlacementInteractionMode,
  ): void {
    if (this.uiStore.getSnapshot().phase === "simulate") {
      return;
    }

    const didBeginMove = this.editorHost.beginMove(
      entityId,
      inputMode,
      this.resolveWorldInput(screenPoint),
    );

    if (!didBeginMove) {
      return;
    }

    this.sync();
  }

  beginMarqueeFromScreenPoint(
    screenPoint: CanvasPoint,
    inputMode: PlacementInteractionMode,
    selectionMode: EditorSelectionUpdateMode,
  ): void {
    if (this.uiStore.getSnapshot().phase === "simulate") {
      return;
    }

    const didBeginMarquee = this.editorHost.beginMarquee(
      inputMode,
      selectionMode,
      this.resolveWorldInput(screenPoint),
    );

    if (!didBeginMarquee) {
      return;
    }

    this.sync();
  }

  updateMoveDraftFromScreenPoint(screenPoint: CanvasPoint): void {
    const moveMode = this.getMoveMode();

    if (!moveMode) {
      return;
    }

    this.editorHost.updateMoveDraft(this.resolveWorldInput(screenPoint));
    this.sync();
  }

  updateMarqueeDraftFromScreenPoint(screenPoint: CanvasPoint): void {
    this.editorHost.updateMarqueeDraft(this.resolveWorldInput(screenPoint));
    this.sync();
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

    this.sync();
  }

  cancelMarquee(): void {
    const didCancel = this.editorHost.cancelMarquee();

    if (!didCancel) {
      return;
    }

    this.sync();
  }

  rotateMoveClockwise(): void {
    const didRotate = this.editorHost.rotateMoveClockwise();

    if (!didRotate) {
      return;
    }

    this.sync();
  }

  rotatePlacementClockwise(): void {
    const didRotate = this.editorHost.rotatePlacementClockwise();

    if (!didRotate) {
      return;
    }

    this.sync();
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
    this.sync();
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

      this.placementPreviewProfiler?.recordUpdateResult({
        changed: updateResult.changed,
        previousPreview,
        nextPreview,
      });

      const syncMetrics = this.sync();
      const placementMode = this.getPlacementMode(sessionBefore);

      if (placementMode) {
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
      }
    });
  }

  async confirmPlacementPreview(): Promise<void> {
    const before = this.captureMutationState();
    const didPlace = this.editorHost.confirmPlacement();

    await this.reconcileMutation(before);

    if (
      didPlace &&
      this.getPlacementMode(this.editorStore.getSnapshot().session)?.inputMode ===
        "touch" &&
      this.uiStore.getSnapshot().phase === "edit"
    ) {
      this.centerPlacementPreview();
    }
  }

  clearPlacementPreview(): void {
    this.editorHost.clearPlacementPreview();
    this.sync();
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

  async patchSimulationEntityConfig(
    entityId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.simulationHost.applyEntityConfigPatch(entityId, patch);
  }

  getCanvasInteractionTarget(screenPoint: CanvasPoint): CanvasInteractionTarget {
    const worldPoint = screenToWorldPoint(
      screenPoint,
      this.canvasViewStore.getSnapshot(),
    );

    return this.uiStore.getSnapshot().phase === "simulate"
      ? this.simulationHost.queryInteractionTarget(worldPoint)
      : this.editorHost.queryInteractionTarget(worldPoint);
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

  async selectSimulationEntity(entityId: string | null): Promise<void> {
    await this.simulationHost.selectEntity(entityId);
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
      WorkbenchControllerImpl.BUTTON_ZOOM_FACTOR,
    );
  }

  zoomOut(): void {
    this.zoomCanvasAt(
      this.getViewportCenterScreenPoint(),
      1 / WorkbenchControllerImpl.BUTTON_ZOOM_FACTOR,
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
      this.sync();
    }
  }

  panCanvasBy(screenDelta: CanvasPoint): void {
    const didChange = this.updateCanvasView((canvasView) =>
      panCanvasView(canvasView, screenDelta, this.getViewportMetrics()),
    );

    if (didChange) {
      this.sync();
    }
  }

  setCanvasViewportSize(size: CanvasPoint): void {
    this.viewportSize = clampCanvasViewportSize(size);
    const didChange = this.updateCanvasView((canvasView) =>
      clampCanvasViewState(canvasView, this.getViewportMetrics()),
    );

    if (didChange) {
      this.sync();
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
      this.sync();
    }
  }

  setSimulationSpeedPreset(preset: SimulationSpeedPreset): void {
    const didChange = this.updateUiState((ui) => {
      if (ui.simulationSpeed === preset) {
        return ui;
      }

      return {
        ...ui,
        simulationSpeed: preset,
      };
    });

    if (didChange) {
      this.sync();
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
      this.sync();
    }
  }

  getLogLevel(): LogLevel {
    return this.uiStore.getSnapshot().logLevel;
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
    this.sync();
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
      this.sync();
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
      this.sync();
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
      this.sync();
    }
  }

  startSimulation(): void {
    this.setPhase("simulate");
    this.simulationHost.start();
    this.logger.info("Started simulation playback.");
  }

  stopSimulation(): void {
    this.setPhase("edit");
    this.logger.info("Stopped simulation playback and returned to edit mode.");
  }

  pauseSimulation(): void {
    this.simulationHost.pause();
    this.logger.info("Paused simulation playback.");
    this.sync();
  }

  stepSimulation(): void {
    this.setPhase("simulate");
    this.simulationHost.step();
    this.logger.debug("Stepped simulation by one tick.");
  }

  dispose(): void {
    this.canvasKeyboardFocusListeners.clear();
    this.unsubscribeSimulationHost();
    this.simulationHost.dispose();
    this.workspaceStore.dispose();
  }

  private loadSimulationWorld(): void {
    this.simulationHost.load({
      document: this.editorHost.getDocument(),
      topology: this.topology,
      registry: this.registry,
    });
  }

  private captureMutationState(): MutationState {
    return {
      document: this.documentStore.getSnapshot(),
      selectionId: this.getActiveSelectionId(),
      pendingLinkSourceEntityId: getPendingLinkSourceEntityId(
        this.editorHost.getState().session.currentMode,
      ),
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
      this.topology = compileStage1World(this.editorHost.getDocument(), this.registry);
      this.loadSimulationWorld();
      this.logger.debug("Recompiled topology after document mutation.", {
        compileVersion: this.topology.compileVersion,
      });
    }

    const afterEditorState = this.editorHost.getState();
    const afterSelectionId =
      this.uiStore.getSnapshot().phase === "simulate"
        ? this.simulationHost.getSnapshot().selection[0] ?? null
        : getSelectedEntityIds(afterEditorState.session)[0] ?? null;
    const afterPendingLinkSourceEntityId = getPendingLinkSourceEntityId(
      afterEditorState.session.currentMode,
    );
    const selectionChanged = before.selectionId !== afterSelectionId;
    const pendingLinkChanged =
      before.pendingLinkSourceEntityId !== afterPendingLinkSourceEntityId;

    this.sync();

    if (documentChanged || selectionChanged) {
      await this.refreshInspectorForSelection();
      return;
    }

    if (pendingLinkChanged) {
      this.sync();
    }
  }

  private getActiveSelectionId(): string | null {
    return this.uiStore.getSnapshot().phase === "simulate"
      ? this.simulationHost.getSnapshot().selection[0] ?? null
      : getSelectedEntityIds(this.editorHost.getState().session)[0] ?? null;
  }

  private async refreshInspectorForSelection(): Promise<void> {
    const selectedEntityId = this.getActiveSelectionId();

    if (!selectedEntityId) {
      return;
    }

    await this.simulationHost.queryInspector(selectedEntityId);
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
    return this.uiStore.update(updater);
  }

  private updateCanvasView(
    updater: (canvasView: CanvasViewState) => CanvasViewState,
  ): boolean {
    return this.canvasViewStore.update(updater);
  }

  private sync(): SyncMetrics {
    return this.measureProfilerStage("controller.sync.total", () => {
      const startedAt = getDiagnosticTimeMs();
      this.editorStore.setSnapshot(this.editorHost.getState());
      const currentState = this.workspaceStore.rootStore.getSnapshot();
      const simulationState = this.simulationHost.getSnapshot();
      const nextState = this.composeWorkspaceState(currentState, {
        document: this.editorHost.getDocument(),
        topology: this.topology,
        editorSession: this.editorStore.getSnapshot().session,
        editorHistory: this.editorStore.getSnapshot().history,
        ui: this.uiStore.getSnapshot(),
        canvasView: this.canvasViewStore.getSnapshot(),
        runtimeSnapshot: simulationState.runtimeSnapshot,
        simulationSelection: simulationState.selection,
        simulationInspectorDetails: simulationState.inspectorDetails,
        simulationPatchSet: simulationState.patchSet,
      });
      const { finalState, worldBoundsDurationMs, canvasViewClamped } =
        this.clampWorkspaceStateCanvasView(nextState);

      const rootStoreSetStartedAt = getDiagnosticTimeMs();
      this.workspaceStore.rootStore.setSnapshot(finalState);
      this.recordProfilerStageDuration(
        "controller.sync.rootStoreSet",
        getDiagnosticTimeMs() - rootStoreSetStartedAt,
      );
      const { persistedWorkspaceChanged, storageSaveDurationMs } =
        this.persistWorkspaceStateIfNeeded(finalState);

      return {
        worldBoundsDurationMs,
        storageSaveDurationMs,
        totalDurationMs: getDiagnosticTimeMs() - startedAt,
        persistedWorkspaceChanged,
        canvasViewClamped,
      };
    });
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
    finalState: WorkspaceState;
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
      finalState: this.composeWorkspaceState(workspaceState, {
        ...workspaceState,
        canvasView: clampedCanvasView,
      }),
      worldBoundsDurationMs,
      canvasViewClamped: clampedCanvasView !== workspaceState.canvasView,
    };
  }

  private getViewportMetrics(workspaceState = this.workspaceStore.rootStore.getSnapshot()) {
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
      placementPreview:
        workspaceState.ui.phase === "edit"
          ? getManagedPlacementPreview(workspaceState.editorSession)
          : null,
      moveDraft:
        workspaceState.ui.phase === "edit"
          ? getManagedMoveDraft(
              workspaceState.editorSession,
              workspaceState.document,
            )
          : null,
    });

    return {
      x: worldBoundsPx.width,
      y: worldBoundsPx.height,
    };
  }

  private composeWorkspaceState(
    currentState: WorkspaceState,
    nextState: WorkspaceState,
  ): WorkspaceState {
    if (
      currentState.document === nextState.document &&
      currentState.topology === nextState.topology &&
      currentState.editorSession === nextState.editorSession &&
      currentState.editorHistory === nextState.editorHistory &&
      currentState.ui === nextState.ui &&
      currentState.canvasView === nextState.canvasView &&
      currentState.runtimeSnapshot === nextState.runtimeSnapshot &&
      currentState.simulationSelection === nextState.simulationSelection &&
      currentState.simulationInspectorDetails === nextState.simulationInspectorDetails &&
      currentState.simulationPatchSet === nextState.simulationPatchSet
    ) {
      return currentState;
    }

    return {
      document:
        currentState.document === nextState.document
          ? currentState.document
          : nextState.document,
      topology:
        currentState.topology === nextState.topology
          ? currentState.topology
          : nextState.topology,
      editorSession:
        currentState.editorSession === nextState.editorSession
          ? currentState.editorSession
          : nextState.editorSession,
      editorHistory:
        currentState.editorHistory === nextState.editorHistory
          ? currentState.editorHistory
          : nextState.editorHistory,
      ui: currentState.ui === nextState.ui ? currentState.ui : nextState.ui,
      canvasView:
        currentState.canvasView === nextState.canvasView
          ? currentState.canvasView
          : nextState.canvasView,
      runtimeSnapshot:
        currentState.runtimeSnapshot === nextState.runtimeSnapshot
          ? currentState.runtimeSnapshot
          : nextState.runtimeSnapshot,
      simulationSelection:
        currentState.simulationSelection === nextState.simulationSelection
          ? currentState.simulationSelection
          : nextState.simulationSelection,
      simulationInspectorDetails:
        currentState.simulationInspectorDetails === nextState.simulationInspectorDetails
          ? currentState.simulationInspectorDetails
          : nextState.simulationInspectorDetails,
      simulationPatchSet:
        currentState.simulationPatchSet === nextState.simulationPatchSet
          ? currentState.simulationPatchSet
          : nextState.simulationPatchSet,
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
    if (this.placementPreviewProfiler) {
      return this.placementPreviewProfiler.measureStage(stageId, callback);
    }

    return callback();
  }

  private recordProfilerStageDuration(
    stageId:
      | "controller.sync.rootStoreSet",
    durationMs: number,
  ): void {
    this.placementPreviewProfiler?.recordStageDuration(stageId, durationMs);
  }
}

export function createWorkbenchController(
  options: CreateWorkbenchControllerOptions = {},
): WorkbenchController {
  return new WorkbenchControllerImpl(options);
}
