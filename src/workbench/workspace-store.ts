import type { WorldDocument } from "@/domain/document/world-document";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import type { SimulationState } from "@/simulation/host/simulation-host";
import type {
  CanvasViewState,
  WorkspaceState,
} from "@/workbench/workspace-state";
import type { WorkbenchUiState } from "@/workbench/workbench-ui-state";

export type ReadonlySnapshotStore<TSnapshot> = Pick<
  SnapshotStore<TSnapshot>,
  "getSnapshot" | "subscribe"
>;

export interface WorkspaceStore {
  rootStore: SnapshotStore<WorkspaceState>;
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  editorStore: ReadonlySnapshotStore<WorkspaceState["editor"]>;
  uiStore: ReadonlySnapshotStore<WorkbenchUiState>;
  canvasViewStore: ReadonlySnapshotStore<CanvasViewState>;
  simulationStore: ReadonlySnapshotStore<SimulationState>;
  dispose: () => void;
}

function createDerivedStore<TState, TSlice>(
  rootStore: SnapshotStore<TState>,
  selector: (state: TState) => TSlice,
): {
  store: SnapshotStore<TSlice>;
  dispose: () => void;
} {
  const store = createSnapshotStore(selector(rootStore.getSnapshot()));
  const unsubscribe = rootStore.subscribe(() => {
    store.setSnapshot(selector(rootStore.getSnapshot()));
  });

  return {
    store,
    dispose: unsubscribe,
  };
}

export function createWorkspaceStore(initialState: WorkspaceState): WorkspaceStore {
  const rootStore = createSnapshotStore(initialState);
  const documentStore = createDerivedStore(rootStore, (state) => state.document);
  const editorStore = createDerivedStore(rootStore, (state) => state.editor);
  const uiStore = createDerivedStore(rootStore, (state) => state.ui);
  const canvasViewStore = createDerivedStore(rootStore, (state) => state.canvasView);
  const simulationStore = createDerivedStore(rootStore, (state) => state.simulation);

  return {
    rootStore,
    documentStore: documentStore.store,
    editorStore: editorStore.store,
    uiStore: uiStore.store,
    canvasViewStore: canvasViewStore.store,
    simulationStore: simulationStore.store,
    dispose: () => {
      documentStore.dispose();
      editorStore.dispose();
      uiStore.dispose();
      canvasViewStore.dispose();
      simulationStore.dispose();
    },
  };
}
