import type {
  WorkbenchCanvasSnapshot,
  WorkbenchController,
} from "@/app-shell/contracts/workbench-facade";
import type {
  DockId,
  LeftPanelMode,
  SimulationSpeedPreset,
  WorkbenchMode,
} from "@/app-shell/contracts/workbench-ui";
import {
  createWorkbenchUiStore,
  type WorkbenchUiStore,
} from "@/app-shell/state/workbench-ui-store";
import {
  createCanvasHost,
  type CanvasHost,
  type CanvasPoint,
} from "@/canvas/canvas-host";
import { createEditCanvasBackend } from "@/canvas/edit-canvas-backend";
import { createSimulationCanvasBackend } from "@/canvas/simulation-canvas-backend";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import type { WorldDocument } from "@/domain/document/world-document";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import {
  createStage1Registry,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { EditorCoreSnapshot } from "@/editor/core/editor-core";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import type { EditorTool } from "@/editor/contracts/editor-session";
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
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";

interface MutationState {
  document: WorldDocument;
  selectionId: string | null;
  pendingLinkSourceEntityId: string | null;
}

class WorkbenchControllerImpl implements WorkbenchController {
  readonly registry: Stage1Registry;
  readonly uiStore: WorkbenchUiStore;
  readonly editorStore: SnapshotStore<EditorCoreSnapshot>;
  readonly canvasStore: SnapshotStore<WorkbenchCanvasSnapshot>;
  readonly topologyStore: SnapshotStore<CompiledTopology>;
  readonly simulationStore: SimulationHost;
  readonly renderSceneStore: SnapshotStore<RenderSceneModel>;

  private readonly storage: WorkspaceStorageGateway;
  private readonly editorHost: EditorHost;
  private readonly canvasHost: CanvasHost;
  private readonly simulationHost: SimulationHost;
  private readonly unsubscribeUiStore: () => void;
  private readonly unsubscribeSimulationHost: () => void;

  private topology: CompiledTopology;

  constructor() {
    this.registry = createStage1Registry();
    this.storage = createWorkspaceStorageGateway();
    this.uiStore = createWorkbenchUiStore(this.storage.loadUiSnapshot());
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
      initialBackend:
        this.uiStore.getSnapshot().mode === "simulate"
          ? "simulation"
          : "edit",
    });
    this.simulationHost = createSimulationHost();
    this.editorStore = createSnapshotStore(this.editorHost.getSnapshot());
    this.canvasStore = createSnapshotStore(this.buildCanvasSnapshot());
    this.topologyStore = createSnapshotStore(this.topology);
    this.simulationStore = this.simulationHost;
    this.renderSceneStore = createSnapshotStore(this.buildRenderSceneSnapshot());

    this.unsubscribeUiStore = this.uiStore.subscribe(() => {
      this.syncFromUiStore();
    });
    this.unsubscribeSimulationHost = this.simulationHost.subscribe(() => {
      this.sync();
    });

    this.loadSimulationWorld();
    void this.refreshInspectorForSelection();
  }

  setMode(mode: WorkbenchMode): void {
    const previousMode = this.uiStore.getSnapshot().mode;
    this.canvasHost.setActiveBackend(mode === "edit" ? "edit" : "simulation");

    if (previousMode === "simulate" && mode === "edit") {
      this.simulationHost.clearPatches();
    }

    if (mode === "edit") {
      this.simulationHost.pause();
    }

    this.uiStore.setMode(mode);
    this.sync();
    void this.refreshInspectorForSelection();
  }

  setActiveTool(tool: EditorTool): void {
    this.editorHost.setActiveTool(tool);
    this.sync();
  }

  armPlacement(definitionId: string, tool: EditorTool = "place"): void {
    this.editorHost.setPlacementDefinition(definitionId, tool);
    this.uiStore.setLeftPanelMode("placement");
    this.uiStore.setDockOpen("left", true);
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
    this.uiStore.setLeftPanelMode(mode);
    this.uiStore.setDockOpen("left", true);
  }

  setSimulationSpeedPreset(preset: SimulationSpeedPreset): void {
    this.uiStore.setSimulationSpeedPreset(preset);
  }

  setLocale(locale: AppLocale): void {
    this.uiStore.setLocale(locale);
  }

  setDiagnosticsVisible(visible: boolean): void {
    this.uiStore.setDiagnosticsVisible(visible);
  }

  setDockOpen(dockId: DockId, open: boolean): void {
    this.uiStore.setDockOpen(dockId, open);
  }

  toggleDockCollapsed(dockId: DockId): void {
    this.uiStore.toggleDockCollapsed(dockId);
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
    this.unsubscribeUiStore();
    this.unsubscribeSimulationHost();
    this.simulationHost.dispose();
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
      this.loadSimulationWorld();
    }

    const afterSelectionId = this.getActiveSelectionId();
    const afterPendingLinkSourceEntityId =
      this.canvasHost.getActiveBackendSnapshot().pendingLinkSourceEntityId;
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
    return this.canvasHost.getActiveBackendSnapshot().selectedEntityIds[0] ?? null;
  }

  private async refreshInspectorForSelection(): Promise<void> {
    const selectedEntityId = this.getActiveSelectionId();

    if (!selectedEntityId) {
      return;
    }

    await this.simulationHost.queryInspector(selectedEntityId);
  }

  private syncFromUiStore(): void {
    this.storage.saveUiSnapshot(this.uiStore.getSnapshot());
  }

  private sync(): void {
    this.editorStore.setSnapshot(this.editorHost.getSnapshot());
    this.canvasStore.setSnapshot(this.buildCanvasSnapshot());
    this.topologyStore.setSnapshot(this.topology);
    this.renderSceneStore.setSnapshot(this.buildRenderSceneSnapshot());
  }

  private buildCanvasSnapshot(): WorkbenchCanvasSnapshot {
    return {
      canvas: this.canvasHost.getSnapshot(),
      activeCanvas: this.canvasHost.getActiveBackendSnapshot(),
    };
  }

  private buildRenderSceneSnapshot(): RenderSceneModel {
    const editorSnapshot = this.editorHost.getSnapshot();
    const canvasSnapshot = this.canvasHost.getSnapshot();

    return buildRenderScene({
      document: editorSnapshot.document,
      topology: this.topology,
      canvas: canvasSnapshot,
      activeCanvas: this.canvasHost.getActiveBackendSnapshot(),
      runtimeSnapshot: this.simulationHost.getSnapshot().runtimeSnapshot,
    });
  }
}

export function createWorkbenchController(): WorkbenchController {
  return new WorkbenchControllerImpl();
}
