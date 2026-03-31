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
  compileStage1World,
} from "@/domain/compiler/stage1-compiler";
import {
  createStage1Registry,
  type Stage1Registry,
} from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import {
  createStage1SeedWorldDocument,
  type WorldDocument,
} from "@/domain/document/world-document";
import {
  createInitialEditorSession,
  type EditorTool,
} from "@/editor/core/editor-session";
import {
  createEditorHost,
  type EditorHost,
} from "@/editor/host/editor-host";
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
import type { AppLocale } from "@/i18n/messages";

export interface WorkbenchSnapshot {
  ui: WorkbenchUiState;
  document: WorldDocument;
  session: ReturnType<EditorHost["getSnapshot"]>["session"];
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
  selectEntity: (entityId: string) => Promise<void>;
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

    this.simulationHost.load({
      document: this.editorHost.getSnapshot().document,
      topology: this.topology,
      registry: this.registry,
    });
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

  async selectEntity(entityId: string): Promise<void> {
    this.editorHost.selectEntity(entityId);
    this.sync();

    await this.simulationHost.queryInspector(entityId);
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

  private sync(): void {
    this.storage.saveUiState(this.ui);
    this.store.setSnapshot(this.buildSnapshot());
  }
}

export function createWorkbenchController(): WorkbenchController {
  return new WorkbenchControllerImpl();
}
