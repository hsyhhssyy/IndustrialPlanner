import {
  type WorkbenchMode,
  type WorkbenchUiState,
} from "@/app-shell/state/workbench-ui-state";
import {
  compileStage1World,
} from "@/domain-compiler/compiler";
import type { CompiledTopology } from "@/domain-compiler/compiled-topology";
import {
  createStage1SeedWorldDocument,
  type WorldDocument,
} from "@/editor-core/document/world-document";
import {
  createInitialEditorSession,
  type EditorSession,
  type EditorTool,
} from "@/editor-core/session/editor-session";
import {
  createStage1Registry,
  getStage1EntityDefinition,
  type Stage1Registry,
} from "@/industrial-domain/registry/stage1-registry";
import {
  createWorkspaceStorageGateway,
  type WorkspaceStorageGateway,
} from "@/persistence/local-workspace-storage";
import {
  createMockSimulationHost,
  type RuntimeInspectorDetails,
  type RuntimeRenderSnapshot,
  type RuntimeTelemetrySummary,
  type SimulationHost,
} from "@/simulation/host/simulation-host";
import {
  createExternalStore,
  type ExternalStore,
} from "@/shared/store/external-store";

export interface WorkbenchSnapshot {
  ui: WorkbenchUiState;
  document: WorldDocument;
  session: EditorSession;
  topology: CompiledTopology;
  runtimeSnapshot: RuntimeRenderSnapshot;
  telemetry: RuntimeTelemetrySummary;
  inspectorDetails: RuntimeInspectorDetails | null;
  registry: Stage1Registry;
}

export interface WorkbenchController {
  subscribe: ExternalStore<WorkbenchSnapshot>["subscribe"];
  getSnapshot: ExternalStore<WorkbenchSnapshot>["getSnapshot"];
  setMode: (mode: WorkbenchMode) => void;
  setActiveTool: (tool: EditorTool) => void;
  selectEntity: (entityId: string) => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  startSimulation: () => void;
  pauseSimulation: () => void;
  stepSimulation: () => void;
  dispose: () => void;
}

function createInitialRuntimeSnapshot(): RuntimeRenderSnapshot {
  return {
    tick: 0,
    status: "idle",
    entityViews: {},
  };
}

function createInitialTelemetrySummary(): RuntimeTelemetrySummary {
  return {
    tick: 0,
    simulatedHertz: 0,
    entityCount: 0,
  };
}

class WorkbenchControllerImpl implements WorkbenchController {
  private readonly registry: Stage1Registry;
  private readonly storage: WorkspaceStorageGateway;
  private readonly store: ExternalStore<WorkbenchSnapshot>;
  private readonly simulationHost: SimulationHost;

  private ui: WorkbenchUiState;
  private document: WorldDocument;
  private session: EditorSession;
  private topology: CompiledTopology;
  private runtimeSnapshot = createInitialRuntimeSnapshot();
  private telemetry = createInitialTelemetrySummary();
  private inspectorDetails: RuntimeInspectorDetails | null = null;

  constructor() {
    this.registry = createStage1Registry();
    this.storage = createWorkspaceStorageGateway();
    this.ui = this.storage.loadUiState();
    this.document = createStage1SeedWorldDocument();
    this.session = {
      ...createInitialEditorSession(),
      mode: this.ui.mode,
    };
    this.topology = compileStage1World(this.document, this.registry);
    this.store = createExternalStore(this.buildSnapshot());
    this.simulationHost = createMockSimulationHost({
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
      document: this.document,
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
      statusMessage:
        mode === "edit"
          ? "Edit mode focuses on document and compiled topology."
          : "Simulation mode consumes runtime snapshots.",
    };
    this.session = {
      ...this.session,
      mode,
    };

    if (mode === "edit") {
      this.simulationHost.pause();
    }

    this.sync();
  }

  setActiveTool(tool: EditorTool): void {
    this.session = {
      ...this.session,
      activeTool: tool,
    };
    this.sync();
  }

  async selectEntity(entityId: string): Promise<void> {
    this.session = {
      ...this.session,
      selection: [entityId],
    };
    this.sync();

    await this.simulationHost.queryInspector(entityId);
  }

  zoomIn(): void {
    this.session = {
      ...this.session,
      viewport: {
        ...this.session.viewport,
        zoom: Math.min(2.5, this.session.viewport.zoom + 0.1),
      },
    };
    this.sync();
  }

  zoomOut(): void {
    this.session = {
      ...this.session,
      viewport: {
        ...this.session.viewport,
        zoom: Math.max(0.5, this.session.viewport.zoom - 0.1),
      },
    };
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
    return {
      ui: this.ui,
      document: this.document,
      session: this.session,
      topology: this.topology,
      runtimeSnapshot: this.runtimeSnapshot,
      telemetry: this.telemetry,
      inspectorDetails: this.inspectorDetails,
      registry: this.registry,
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

export function getSelectedEntityDefinitionName(
  snapshot: WorkbenchSnapshot,
): string | null {
  const selectedEntityId = snapshot.session.selection[0];

  if (!selectedEntityId) {
    return null;
  }

  const entity = snapshot.document.entities[selectedEntityId];

  if (!entity) {
    return null;
  }

  return (
    getStage1EntityDefinition(snapshot.registry, entity.definitionId)?.name ?? null
  );
}
