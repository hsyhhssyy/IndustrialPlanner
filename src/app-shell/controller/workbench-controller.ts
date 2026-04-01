import {
  setDiagnosticsVisible,
  type DockId,
  type LeftPanelMode,
  type SimulationSpeedPreset,
  setLocale as setWorkbenchLocale,
  setDockOpen,
  setLeftPanelMode as setWorkbenchLeftPanelMode,
  setSimulationSpeed as setWorkbenchSimulationSpeed,
  toggleDockCollapsed,
  type WorkbenchMode,
  type WorkbenchUiState,
} from "@/app-shell/state/workbench-ui-state";
import {
  createCanvasHost,
  type CanvasHost,
  type CanvasPoint,
} from "@/canvas/canvas-host";
import { createEditCanvasBackend } from "@/canvas/edit-canvas-backend";
import { createSimulationCanvasBackend } from "@/canvas/simulation-canvas-backend";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import {
  createStage1SeedWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import {
  createStage1Registry,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import {
  createInitialEditorSession,
  type EditorTool,
} from "@/editor/core/editor-session";
import {
  createEditorHost,
  type EditorHost,
} from "@/editor/host/editor-host";
import type { AppLocale } from "@/i18n/messages";
import {
  createWorkspaceStorageGateway,
  type WorkspaceStorageGateway,
} from "@/persistence/local-workspace-storage";
import { buildRenderScene } from "@/renderer/scene/build-render-scene";
import type { RenderSceneModel } from "@/renderer/scene/types";
import {
  createSimulationHost,
  type SimulationHost,
} from "@/simulation/host/simulation-host";
import type {
  RuntimeInspectorDetails,
  RuntimeRenderSnapshot,
  RuntimeTelemetrySummary,
} from "@/simulation/protocol/runtime-protocol";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";

interface MutationState {
  document: WorldDocument;
  selectionId: string | null;
  pendingLinkSourceEntityId: string | null;
}

export interface WorkbenchSnapshot {
  ui: WorkbenchUiState;
  document: WorldDocument;
  session: ReturnType<EditorHost["getSnapshot"]>["session"];
  history: ReturnType<EditorHost["getSnapshot"]>["history"];
  canvas: ReturnType<CanvasHost["getSnapshot"]>;
  activeCanvas: ReturnType<CanvasHost["getActiveBackendSnapshot"]>;
  topology: CompiledTopology;
  runtimeSnapshot: RuntimeRenderSnapshot;
  telemetry: RuntimeTelemetrySummary;
  inspectorDetails: RuntimeInspectorDetails | null;
  registry: Stage1Registry;
  renderScene: RenderSceneModel;
}

export interface WorkbenchController {
  subscribe: SnapshotStore<WorkbenchSnapshot>["subscribe"];
  getSnapshot: SnapshotStore<WorkbenchSnapshot>["getSnapshot"];
  setMode: (mode: WorkbenchMode) => void;
  setActiveTool: (tool: EditorTool) => void;
  armPlacement: (definitionId: string, tool?: EditorTool) => void;
  selectEntity: (entityId: string) => Promise<void>;
  clearSelection: () => Promise<void>;
  handleCanvasClick: (screenPoint: CanvasPoint) => Promise<void>;
  removeSelection: () => Promise<void>;
  removeSelectionLinks: () => Promise<void>;
  removeLink: (linkId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  setLeftPanelMode: (mode: LeftPanelMode) => void;
  setSimulationSpeedPreset: (preset: SimulationSpeedPreset) => void;
  setLocale: (locale: AppLocale) => void;
  setDiagnosticsVisible: (visible: boolean) => void;
  setDockOpen: (dockId: DockId, open: boolean) => void;
  toggleDockCollapsed: (dockId: DockId) => void;
  startSimulation: () => void;
  pauseSimulation: () => void;
  stepSimulation: () => void;
  dispose: () => void;
}

class WorkbenchControllerImpl implements WorkbenchController {
  private readonly registry: Stage1Registry;
  private readonly storage: WorkspaceStorageGateway;
  private readonly store: SnapshotStore<WorkbenchSnapshot>;
  private readonly editorHost: EditorHost;
  private readonly canvasHost: CanvasHost;
  private readonly simulationHost: SimulationHost;

  private ui: WorkbenchUiState;
  private topology: CompiledTopology;
  private runtimeSnapshot: RuntimeRenderSnapshot = {
    tick: 0,
    status: "idle",
    entityViews: {},
  };
  private telemetry: RuntimeTelemetrySummary = {
    tick: 0,
    simulatedHertz: 0,
    entityCount: 0,
  };
  private inspectorDetails: RuntimeInspectorDetails | null = null;

  constructor() {
    this.registry = createStage1Registry();
    this.storage = createWorkspaceStorageGateway();
    this.ui = this.storage.loadUiState();
    this.editorHost = createEditorHost({
      document: createStage1SeedWorldDocument(),
      session: createInitialEditorSession(),
    });
    this.topology = compileStage1World(
      this.editorHost.getSnapshot().document,
      this.registry,
    );
    this.canvasHost = createCanvasHost({
      editBackend: createEditCanvasBackend({
        editorHost: this.editorHost,
        getTopology: () => this.topology,
      }),
      simulationBackend: createSimulationCanvasBackend({
        getDocument: () => this.editorHost.getSnapshot().document,
        getTopology: () => this.topology,
      }),
      initialBackend: this.ui.mode === "simulate" ? "simulation" : "edit",
    });
    this.store = createSnapshotStore(this.buildSnapshot());
    this.simulationHost = createSimulationHost({
      onRenderSnapshot: (runtimeSnapshot) => {
        this.runtimeSnapshot = runtimeSnapshot;
        this.sync();
      },
      onTelemetry: (telemetry) => {
        this.telemetry = telemetry;
        this.sync();
      },
      onStatusChange: (status) => {
        this.runtimeSnapshot = {
          ...this.runtimeSnapshot,
          status,
        };
        this.sync();
      },
      onInspectorDetails: (details) => {
        this.inspectorDetails = details;
        this.sync();
      },
    });

    this.loadSimulationWorld();
    void this.refreshInspectorForSelection();
  }

  subscribe = (listener: () => void) => this.store.subscribe(listener);

  getSnapshot = () => this.store.getSnapshot();

  setMode(mode: WorkbenchMode): void {
    this.ui = {
      ...this.ui,
      mode,
      statusMessageKey: mode === "edit" ? "status.edit" : "status.simulate",
    };
    this.canvasHost.setActiveBackend(mode === "edit" ? "edit" : "simulation");

    if (mode === "edit") {
      this.simulationHost.pause();
    }

    this.sync();
    void this.refreshInspectorForSelection();
  }

  setActiveTool(tool: EditorTool): void {
    this.editorHost.setActiveTool(tool);
    this.sync();
  }

  armPlacement(definitionId: string, tool: EditorTool = "place"): void {
    this.editorHost.setPlacementDefinition(definitionId, tool);
    this.ui = setWorkbenchLeftPanelMode(this.ui, "placement");
    this.ui = setDockOpen(this.ui, "left", true);
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

  async handleCanvasClick(screenPoint: CanvasPoint): Promise<void> {
    const before = this.captureMutationState();

    await this.canvasHost.handlePrimaryClick({
      screenPoint,
      gridSize: this.editorHost.getSnapshot().document.documentSettings.gridSize,
    });

    await this.reconcileMutation(before);
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
    this.canvasHost.zoomBy(0.1);
    this.sync();
  }

  zoomOut(): void {
    this.canvasHost.zoomBy(-0.1);
    this.sync();
  }

  setLeftPanelMode(mode: LeftPanelMode): void {
    this.ui = setWorkbenchLeftPanelMode(this.ui, mode);
    this.ui = setDockOpen(this.ui, "left", true);
    this.sync();
  }

  setSimulationSpeedPreset(preset: SimulationSpeedPreset): void {
    this.ui = setWorkbenchSimulationSpeed(this.ui, preset);
    this.sync();
  }

  setLocale(locale: AppLocale): void {
    this.ui = setWorkbenchLocale(this.ui, locale);
    this.sync();
  }

  setDiagnosticsVisible(visible: boolean): void {
    this.ui = setDiagnosticsVisible(this.ui, visible);
    this.sync();
  }

  setDockOpen(dockId: DockId, open: boolean): void {
    this.ui = setDockOpen(this.ui, dockId, open);
    this.sync();
  }

  toggleDockCollapsed(dockId: DockId): void {
    this.ui = toggleDockCollapsed(this.ui, dockId);
    this.sync();
  }

  startSimulation(): void {
    this.setMode("simulate");
    this.simulationHost.start();
  }

  pauseSimulation(): void {
    this.simulationHost.pause();
    this.sync();
  }

  stepSimulation(): void {
    this.setMode("simulate");
    this.simulationHost.step();
  }

  dispose(): void {
    this.simulationHost.dispose();
  }

  private buildSnapshot(): WorkbenchSnapshot {
    const editorSnapshot = this.editorHost.getSnapshot();
    const canvasSnapshot = this.canvasHost.getSnapshot();
    const activeCanvas = this.canvasHost.getActiveBackendSnapshot();

    return {
      ui: this.ui,
      document: editorSnapshot.document,
      session: editorSnapshot.session,
      history: editorSnapshot.history,
      canvas: canvasSnapshot,
      activeCanvas,
      topology: this.topology,
      runtimeSnapshot: this.runtimeSnapshot,
      telemetry: this.telemetry,
      inspectorDetails: this.inspectorDetails,
      registry: this.registry,
      renderScene: buildRenderScene({
        document: editorSnapshot.document,
        topology: this.topology,
        canvas: canvasSnapshot,
        activeCanvas,
        runtimeSnapshot: this.runtimeSnapshot,
      }),
    };
  }

  private loadSimulationWorld(): void {
    this.simulationHost.load({
      document: this.editorHost.getSnapshot().document,
      topology: this.topology,
      registry: this.registry,
    });
  }

  private captureMutationState(): MutationState {
    return {
      document: this.editorHost.getSnapshot().document,
      selectionId: this.getActiveSelectionId(),
      pendingLinkSourceEntityId:
        this.canvasHost.getActiveBackendSnapshot().pendingLinkSourceEntityId,
    };
  }

  private async applyEditorMutation(mutator: () => void): Promise<void> {
    const before = this.captureMutationState();
    mutator();
    await this.reconcileMutation(before);
  }

  private async reconcileMutation(before: MutationState): Promise<void> {
    const afterEditorSnapshot = this.editorHost.getSnapshot();
    const documentChanged = afterEditorSnapshot.document !== before.document;

    if (documentChanged) {
      this.topology = compileStage1World(afterEditorSnapshot.document, this.registry);
      this.canvasHost.handleWorldChanged();
      this.inspectorDetails = null;
      this.loadSimulationWorld();
    }

    const afterSelectionId = this.getActiveSelectionId();
    const afterPendingLinkSourceEntityId =
      this.canvasHost.getActiveBackendSnapshot().pendingLinkSourceEntityId;
    const selectionChanged = before.selectionId !== afterSelectionId;
    const pendingLinkChanged =
      before.pendingLinkSourceEntityId !== afterPendingLinkSourceEntityId;

    if (!afterSelectionId) {
      this.inspectorDetails = null;
    }

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
    return this.canvasHost.getActiveBackendSnapshot().selectedEntityIds[0] ?? null;
  }

  private async refreshInspectorForSelection(): Promise<void> {
    const selectedEntityId = this.getActiveSelectionId();

    if (!selectedEntityId) {
      this.inspectorDetails = null;
      this.sync();
      return;
    }

    await this.simulationHost.queryInspector(selectedEntityId);
  }

  private sync(): void {
    this.storage.saveUiState(this.ui);
    this.store.setSnapshot(this.buildSnapshot());
  }
}

export function createWorkbenchController(): WorkbenchController {
  return new WorkbenchControllerImpl();
}
