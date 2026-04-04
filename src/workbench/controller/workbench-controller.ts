import type {
  CanvasInteractionTarget,
  WorkbenchController,
} from "@/workbench/contracts/workbench-facade";
import type {
  DockId,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchMode,
} from "@/workbench/workbench-ui-state";
import {
  createWorkbenchUiState,
  getWorkbenchStatusMessageKeyForMode,
} from "@/workbench/workbench-ui-store";
import {
  createWorkspaceStorage,
  type WorkspacePersistenceState,
  type WorkspaceStorage,
} from "@/workbench/persistence/workspace-storage";
import {
  createInitialCanvasViewState,
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
import type { EditorTool } from "@/editor/contracts/editor-session";
import {
  isSamePlacementPreviewState,
  type PlacementPreviewState,
  type PlacementPreviewStrategy,
} from "@/editor/contracts/placement-preview";
import {
  createEditorHost,
  type CanvasWorldInput,
  type EditorHost,
  type PlacementPreviewUpdateResult,
} from "@/editor/host/editor-host";
import type { AppLocale } from "@/i18n/messages";
import { deriveRenderWorldBoundsPx } from "@/renderer/scene/render-world-bounds";
import {
  createSimulationHost,
  type SimulationHost,
} from "@/simulation/host/simulation-host";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import {
  createLogger,
  setLogLevel as setGlobalLogLevel,
  type LogLevel,
} from "@/shared/logging/logger";

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
        strategy: PlacementPreviewStrategy | null;
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

class WorkbenchControllerImpl implements WorkbenchController {
  readonly registry: Stage1Registry;
  readonly uiStore;
  readonly documentStore;
  readonly editorStore;
  readonly canvasViewStore;
  readonly topologyStore: SnapshotStore<CompiledTopology>;
  readonly simulationStore;

  private readonly logger = createLogger("workbench.controller");
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

  constructor() {
    this.registry = createStage1Registry();
    this.storage = createWorkspaceStorage();

    const persistedState = this.storage.loadWorkspaceState();
    const initialUiState = createWorkbenchUiState(persistedState.ui);
    const initialCanvasView = createInitialCanvasViewState(
      persistedState.canvasView,
    );
    setGlobalLogLevel(initialUiState.logLevel);

    this.editorHost = createEditorHost({
      document: createStage1SeedWorldDocument(),
      session: createInitialEditorSession(),
      getTopology: () => this.topology,
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(this.registry, definitionId),
    });
    this.topology = compileStage1World(this.editorHost.getDocument(), this.registry);
    this.simulationHost = createSimulationHost();
    this.loadSimulationWorld();

    this.workspaceStore = createWorkspaceStore({
      document: this.editorHost.getDocument(),
      editor: this.editorHost.getState(),
      ui: initialUiState,
      canvasView: initialCanvasView,
      simulation: this.simulationHost.getSnapshot(),
    });
    this.documentStore = this.workspaceStore.documentStore;
    this.editorStore = this.workspaceStore.editorStore;
    this.uiStore = this.workspaceStore.uiStore;
    this.canvasViewStore = this.workspaceStore.canvasViewStore;
    this.simulationStore = this.workspaceStore.simulationStore;
    this.topologyStore = createSnapshotStore(this.topology);

    this.unsubscribeSimulationHost = this.simulationHost.subscribe(() => {
      this.sync();
    });

    this.sync();
    void this.refreshInspectorForSelection();
  }

  setMode(mode: WorkbenchMode): void {
    const previousMode = this.uiStore.getSnapshot().mode;

    if (mode === "simulate") {
      this.editorHost.clearPlacementPreview();
    }

    if (previousMode === "simulate" && mode === "edit") {
      this.simulationHost.clearPatches();
    }

    if (mode === "edit") {
      this.simulationHost.pause();
    }

    const didChange = this.updateUiState((ui) => {
      if (ui.mode === mode) {
        return ui;
      }

      return {
        ...ui,
        mode,
        statusMessageKey: getWorkbenchStatusMessageKeyForMode(mode),
      };
    });

    if (!didChange && previousMode === mode) {
      return;
    }

    this.sync();
    void this.refreshInspectorForSelection();
  }

  setActiveTool(tool: EditorTool): void {
    this.editorHost.setActiveTool(tool);
    this.sync();
  }

  armPlacement(
    definitionId: string,
    tool: EditorTool = "place",
    strategy: PlacementPreviewStrategy = "pointer-follow",
  ): void {
    if (this.uiStore.getSnapshot().mode === "simulate") {
      this.logger.warn("Ignored placement request while simulate mode is active.", {
        definitionId,
        tool,
        strategy,
      });
      return;
    }

    this.editorHost.setPlacementDefinition(definitionId, tool, strategy);
    this.logger.info("Armed placement through workbench controller.", {
      definitionId,
      tool,
      strategy,
      viewportSize: this.viewportSize,
      mode: this.uiStore.getSnapshot().mode,
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
      strategy === "anchored-confirm" &&
      this.viewportSize.x > 0 &&
      this.viewportSize.y > 0
    ) {
      this.centerPlacementPreview();
      return;
    }

    this.sync();
  }

  centerPlacementPreview(): void {
    if (this.viewportSize.x <= 0 || this.viewportSize.y <= 0) {
      return;
    }

    this.updatePlacementPreviewFromScreenPoint(this.getViewportCenterScreenPoint());
  }

  updatePlacementPreviewFromScreenPoint(screenPoint: CanvasPoint): void {
    const sessionBefore = this.editorStore.getSnapshot().session;
    const previousPreview = clonePlacementPreview(sessionBefore.placementPreview);
    const worldInput = this.resolveWorldInput(screenPoint);
    const updateResult = this.editorHost.updatePlacementPreview(worldInput);
    const nextPreview = clonePlacementPreview(
      this.editorStore.getSnapshot().session.placementPreview,
    );
    const syncMetrics = this.sync();

    if (sessionBefore.placementDefinitionId && sessionBefore.placementStrategy) {
      this.recordPlacementPreviewDiagnostic({
        definitionId: sessionBefore.placementDefinitionId,
        strategy: sessionBefore.placementStrategy,
        screenPoint,
        worldInput,
        previousPreview,
        nextPreview,
        updateResult,
        syncMetrics,
      });
    }
  }

  async confirmPlacementPreview(): Promise<void> {
    const before = this.captureMutationState();
    const didPlace = this.editorHost.confirmPlacement();

    await this.reconcileMutation(before);

    if (
      didPlace &&
      this.editorStore.getSnapshot().session.placementStrategy === "anchored-confirm" &&
      this.uiStore.getSnapshot().mode === "edit"
    ) {
      this.centerPlacementPreview();
    }
  }

  clearPlacementPreview(): void {
    this.editorHost.clearPlacementPreview();
    this.sync();
  }

  async selectEntity(entityId: string): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.selectEntity(entityId);
      this.editorHost.setPendingLinkSource(null);
    });
  }

  async clearSelection(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.selectEntity(null);
      this.editorHost.setPendingLinkSource(null);
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

    return this.uiStore.getSnapshot().mode === "simulate"
      ? this.simulationHost.queryInteractionTarget(worldPoint)
      : this.editorHost.queryInteractionTarget(worldPoint);
  }

  async commitPlacementAtScreenPoint(screenPoint: CanvasPoint): Promise<void> {
    const worldInput = this.resolveWorldInput(screenPoint);
    const session = this.editorStore.getSnapshot().session;
    this.logger.info("Attempting placement commit from screen point.", {
      screenPoint,
      worldPoint: worldInput.worldPoint,
      gridPoint: worldInput.gridPoint,
      activeTool: session.activeTool,
      placementDefinitionId: session.placementDefinitionId,
      placementStrategy: session.placementStrategy,
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
      this.editorHost.setPendingLinkSource(null);
    });
  }

  async redo(): Promise<void> {
    await this.applyEditorMutation(() => {
      this.editorHost.redo();
      this.editorHost.setPendingLinkSource(null);
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
    this.setMode("simulate");
    this.simulationHost.start();
    this.logger.info("Started simulation playback.");
  }

  stopSimulation(): void {
    this.setMode("edit");
    this.logger.info("Stopped simulation playback and returned to edit mode.");
  }

  pauseSimulation(): void {
    this.simulationHost.pause();
    this.logger.info("Paused simulation playback.");
    this.sync();
  }

  stepSimulation(): void {
    this.setMode("simulate");
    this.simulationHost.step();
    this.logger.debug("Stepped simulation by one tick.");
  }

  dispose(): void {
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
      pendingLinkSourceEntityId:
        this.editorStore.getSnapshot().session.pendingLinkSourceEntityId,
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

    const afterSelectionId = this.getActiveSelectionId();
    const afterPendingLinkSourceEntityId =
      this.editorStore.getSnapshot().session.pendingLinkSourceEntityId;
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
    const workspaceState = this.workspaceStore.rootStore.getSnapshot();

    return workspaceState.ui.mode === "simulate"
      ? workspaceState.simulation.selection[0] ?? null
      : workspaceState.editor.session.selection[0] ?? null;
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
    const currentState = this.workspaceStore.rootStore.getSnapshot();
    const nextUi = updater(currentState.ui);

    if (nextUi === currentState.ui) {
      return false;
    }

    this.workspaceStore.rootStore.setSnapshot({
      ...currentState,
      ui: nextUi,
    });
    return true;
  }

  private updateCanvasView(
    updater: (canvasView: CanvasViewState) => CanvasViewState,
  ): boolean {
    const currentState = this.workspaceStore.rootStore.getSnapshot();
    const nextCanvasView = updater(currentState.canvasView);

    if (nextCanvasView === currentState.canvasView) {
      return false;
    }

    this.workspaceStore.rootStore.setSnapshot({
      ...currentState,
      canvasView: nextCanvasView,
    });
    return true;
  }

  private sync(): SyncMetrics {
    const startedAt = getDiagnosticTimeMs();
    const currentState = this.workspaceStore.rootStore.getSnapshot();
    const nextState = this.composeWorkspaceState(currentState, {
      document: this.editorHost.getDocument(),
      editor: this.editorHost.getState(),
      ui: currentState.ui,
      canvasView: currentState.canvasView,
      simulation: this.simulationHost.getSnapshot(),
    });
    const worldBoundsStartedAt = getDiagnosticTimeMs();
    const clampedCanvasView = clampCanvasViewState(
      nextState.canvasView,
      this.getViewportMetrics(nextState),
    );
    const worldBoundsDurationMs = getDiagnosticTimeMs() - worldBoundsStartedAt;
    const finalState = this.composeWorkspaceState(nextState, {
      ...nextState,
      canvasView: clampedCanvasView,
    });
    const canvasViewClamped = clampedCanvasView !== nextState.canvasView;

    const persistedWorkspaceChanged =
      this.lastSavedWorkspacePersistence === null ||
      this.lastSavedWorkspacePersistence.ui !== finalState.ui ||
      this.lastSavedWorkspacePersistence.canvasView !== finalState.canvasView;

    this.workspaceStore.rootStore.setSnapshot(finalState);
    this.topologyStore.setSnapshot(this.topology);
    let storageSaveDurationMs = 0;

    if (persistedWorkspaceChanged) {
      const storageSaveStartedAt = getDiagnosticTimeMs();
      this.saveWorkspaceState(finalState);
      storageSaveDurationMs = getDiagnosticTimeMs() - storageSaveStartedAt;
    }

    return {
      worldBoundsDurationMs,
      storageSaveDurationMs,
      totalDurationMs: getDiagnosticTimeMs() - startedAt,
      persistedWorkspaceChanged,
      canvasViewClamped,
    };
  }

  private saveWorkspaceState(workspaceState: WorkspaceState): void {
    const persistenceState = {
      ui: workspaceState.ui,
      canvasView: workspaceState.canvasView,
    } satisfies WorkspacePersistenceState;

    this.storage.saveWorkspaceState(persistenceState);
    this.lastSavedWorkspacePersistence = persistenceState;
  }

  private getViewportMetrics(workspaceState = this.workspaceStore.rootStore.getSnapshot()) {
    return {
      size: this.viewportSize,
      worldSize: this.getRenderWorldSize(workspaceState),
    };
  }

  private getRenderWorldSize(workspaceState: WorkspaceState): CanvasPoint {
    const worldBoundsPx = deriveRenderWorldBoundsPx({
      document: workspaceState.document,
      topology: this.topology,
      registry: this.registry,
      placementPreview:
        workspaceState.ui.mode === "edit"
          ? workspaceState.editor.session.placementPreview
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
    const editorState =
      currentState.editor.session === nextState.editor.session &&
      currentState.editor.history === nextState.editor.history
        ? currentState.editor
        : nextState.editor;

    if (
      currentState.document === nextState.document &&
      currentState.editor === editorState &&
      currentState.ui === nextState.ui &&
      currentState.canvasView === nextState.canvasView &&
      currentState.simulation === nextState.simulation
    ) {
      return currentState;
    }

    return {
      document:
        currentState.document === nextState.document
          ? currentState.document
          : nextState.document,
      editor: editorState,
      ui: currentState.ui === nextState.ui ? currentState.ui : nextState.ui,
      canvasView:
        currentState.canvasView === nextState.canvasView
          ? currentState.canvasView
          : nextState.canvasView,
      simulation:
        currentState.simulation === nextState.simulation
          ? currentState.simulation
          : nextState.simulation,
    };
  }

  private recordPlacementPreviewDiagnostic(options: {
    definitionId: string;
    strategy: PlacementPreviewStrategy;
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
      strategy: options.strategy,
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
}

export function createWorkbenchController(): WorkbenchController {
  return new WorkbenchControllerImpl();
}
