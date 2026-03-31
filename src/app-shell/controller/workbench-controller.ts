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
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import {
  createStage1Registry,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import {
  createStage1SeedWorldDocument,
  getExplicitLinkBetween,
  type WorldDocument,
} from "@/domain/document/world-document";
import {
  createInitialEditorSession,
  isPlacementTool,
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
import type {
  RenderSceneInteraction,
  RenderSceneModel,
} from "@/renderer/scene/types";
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

export interface WorkbenchSnapshot {
  ui: WorkbenchUiState;
  document: WorldDocument;
  session: ReturnType<EditorHost["getSnapshot"]>["session"];
  history: ReturnType<EditorHost["getSnapshot"]>["history"];
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
  handleSceneClick: (interaction: RenderSceneInteraction) => Promise<void>;
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
      statusMessageKey:
        mode === "edit" ? "status.edit" : "status.simulate",
    };

    if (mode === "edit") {
      this.simulationHost.pause();
    }

    this.sync();
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

  async handleSceneClick(interaction: RenderSceneInteraction): Promise<void> {
    const editorSnapshot = this.editorHost.getSnapshot();
    const { activeTool, placementDefinitionId, pendingLinkSourceEntityId } =
      editorSnapshot.session;

    if (activeTool === "link") {
      if (!interaction.entityId) {
        await this.clearSelection();
        return;
      }

      if (!pendingLinkSourceEntityId) {
        await this.applyEditorMutation(() => {
          this.editorHost.selectEntity(interaction.entityId);
          this.editorHost.setPendingLinkSource(interaction.entityId);
        });
        return;
      }

      if (pendingLinkSourceEntityId === interaction.entityId) {
        await this.applyEditorMutation(() => {
          this.editorHost.selectEntity(interaction.entityId);
          this.editorHost.setPendingLinkSource(null);
        });
        return;
      }

      const resolvedPair = this.resolveDarkPipePair(
        pendingLinkSourceEntityId,
        interaction.entityId,
      );

      if (!resolvedPair) {
        await this.applyEditorMutation(() => {
          this.editorHost.selectEntity(interaction.entityId);
          this.editorHost.setPendingLinkSource(interaction.entityId);
        });
        return;
      }

      const existingLink = getExplicitLinkBetween(
        this.editorHost.getSnapshot().document,
        resolvedPair.sourceEntityId,
        resolvedPair.targetEntityId,
      );

      await this.applyEditorMutation(() => {
        if (existingLink) {
          this.editorHost.removeLink(existingLink.id);
          this.editorHost.selectEntity(interaction.entityId);
        } else {
          this.editorHost.createLink(
            resolvedPair.sourceEntityId,
            resolvedPair.targetEntityId,
          );
        }

        this.editorHost.setPendingLinkSource(null);
      });
      return;
    }

    if (interaction.entityId) {
      await this.selectEntity(interaction.entityId);
      return;
    }

    if (isPlacementTool(activeTool) && placementDefinitionId) {
      await this.applyEditorMutation(() => {
        this.editorHost.placeEntity(
          placementDefinitionId,
          interaction.gridPoint,
        );
      });
      return;
    }

    await this.clearSelection();
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
    this.editorHost.zoomIn();
    this.sync();
  }

  zoomOut(): void {
    this.editorHost.zoomOut();
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

    return {
      ui: this.ui,
      document: editorSnapshot.document,
      session: editorSnapshot.session,
      history: editorSnapshot.history,
      topology: this.topology,
      runtimeSnapshot: this.runtimeSnapshot,
      telemetry: this.telemetry,
      inspectorDetails: this.inspectorDetails,
      registry: this.registry,
      renderScene: buildRenderScene({
        document: editorSnapshot.document,
        topology: this.topology,
        session: editorSnapshot.session,
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

  private async applyEditorMutation(mutator: () => void): Promise<void> {
    const before = this.editorHost.getSnapshot();
    const beforeSelectionId = before.session.selection[0] ?? null;

    mutator();

    const after = this.editorHost.getSnapshot();
    const afterSelectionId = after.session.selection[0] ?? null;
    const documentChanged = after.document !== before.document;
    const selectionChanged = beforeSelectionId !== afterSelectionId;
    const pendingLinkChanged =
      before.session.pendingLinkSourceEntityId !==
      after.session.pendingLinkSourceEntityId;

    if (documentChanged) {
      this.topology = compileStage1World(after.document, this.registry);
      this.inspectorDetails = null;
      this.loadSimulationWorld();
    } else if (!afterSelectionId) {
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

  private async refreshInspectorForSelection(): Promise<void> {
    const selectedEntityId =
      this.editorHost.getSnapshot().session.selection[0] ?? null;

    if (!selectedEntityId) {
      this.inspectorDetails = null;
      this.sync();
      return;
    }

    await this.simulationHost.queryInspector(selectedEntityId);
  }

  private resolveDarkPipePair(
    entityIdA: string,
    entityIdB: string,
  ): { sourceEntityId: string; targetEntityId: string } | null {
    const definitionA = this.topology.entityViews[entityIdA]?.definition;
    const definitionB = this.topology.entityViews[entityIdB]?.definition;

    if (!definitionA || !definitionB) {
      return null;
    }

    const aCanSource = definitionA.capabilityIds.includes("device-link-source");
    const aCanTarget = definitionA.capabilityIds.includes("device-link-target");
    const bCanSource = definitionB.capabilityIds.includes("device-link-source");
    const bCanTarget = definitionB.capabilityIds.includes("device-link-target");

    if (aCanSource && bCanTarget) {
      return {
        sourceEntityId: entityIdA,
        targetEntityId: entityIdB,
      };
    }

    if (bCanSource && aCanTarget) {
      return {
        sourceEntityId: entityIdB,
        targetEntityId: entityIdA,
      };
    }

    return null;
  }

  private sync(): void {
    this.storage.saveUiState(this.ui);
    this.store.setSnapshot(this.buildSnapshot());
  }
}

export function createWorkbenchController(): WorkbenchController {
  return new WorkbenchControllerImpl();
}
