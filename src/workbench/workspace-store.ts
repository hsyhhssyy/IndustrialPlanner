import type { WorldDocument } from "@/domain/document/world-document";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import type { SimulationState } from "@/simulation/host/simulation-host";
import type { RuntimeRenderSnapshot } from "@/simulation/protocol/runtime-protocol";
import type {
  CanvasViewState,
  WorkspaceEditorState,
  WorkspaceState,
} from "@/workbench/workspace-state";
import type { WorkbenchUiState } from "@/workbench/workbench-ui-state";

export type ReadonlySnapshotStore<TSnapshot> = Pick<
  SnapshotStore<TSnapshot>,
  "getSnapshot" | "subscribe"
>;

export interface WorkspaceStore {
  rootStore: SnapshotStore<WorkspaceState>;
  readonly document: WorldDocument;
  readonly topology: CompiledTopology;
  readonly editorSession: WorkspaceState["editorSession"];
  readonly editorHistory: WorkspaceState["editorHistory"];
  readonly runtimeSnapshot: RuntimeRenderSnapshot;
  readonly simulationSelection: WorkspaceState["simulationSelection"];
  readonly simulationInspectorDetails: WorkspaceState["simulationInspectorDetails"];
  readonly simulationPatchSet: WorkspaceState["simulationPatchSet"];
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  topologyStore: ReadonlySnapshotStore<CompiledTopology>;
  editorSessionStore: ReadonlySnapshotStore<WorkspaceState["editorSession"]>;
  editorHistoryStore: ReadonlySnapshotStore<WorkspaceState["editorHistory"]>;
  editorStore: ReadonlySnapshotStore<WorkspaceEditorState>;
  uiStore: ReadonlySnapshotStore<WorkbenchUiState>;
  canvasViewStore: ReadonlySnapshotStore<CanvasViewState>;
  runtimeSnapshotStore: ReadonlySnapshotStore<RuntimeRenderSnapshot>;
  simulationSelectionStore: ReadonlySnapshotStore<WorkspaceState["simulationSelection"]>;
  simulationInspectorDetailsStore: ReadonlySnapshotStore<
    WorkspaceState["simulationInspectorDetails"]
  >;
  simulationPatchSetStore: ReadonlySnapshotStore<WorkspaceState["simulationPatchSet"]>;
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

function createEditorDerivedStore(
  rootStore: SnapshotStore<WorkspaceState>,
): {
  store: SnapshotStore<WorkspaceEditorState>;
  dispose: () => void;
} {
  let currentEditorState: WorkspaceEditorState = {
    session: rootStore.getSnapshot().editorSession,
    history: rootStore.getSnapshot().editorHistory,
  };
  const store = createSnapshotStore(currentEditorState);
  const unsubscribe = rootStore.subscribe(() => {
    const state = rootStore.getSnapshot();
    const nextEditorState =
      currentEditorState.session === state.editorSession &&
      currentEditorState.history === state.editorHistory
        ? currentEditorState
        : {
            session: state.editorSession,
            history: state.editorHistory,
          };

    if (nextEditorState === currentEditorState) {
      return;
    }

    currentEditorState = nextEditorState;
    store.setSnapshot(nextEditorState);
  });

  return {
    store,
    dispose: unsubscribe,
  };
}

export function createWorkspaceStore(initialState: WorkspaceState): WorkspaceStore {
  const rootStore = createSnapshotStore(initialState);
  const documentStore = createDerivedStore(rootStore, (state) => state.document);
  const topologyStore = createDerivedStore(rootStore, (state) => state.topology);
  const editorSessionStore = createDerivedStore(rootStore, (state) => state.editorSession);
  const editorHistoryStore = createDerivedStore(rootStore, (state) => state.editorHistory);
  const editorStore = createEditorDerivedStore(rootStore);
  const uiStore = createDerivedStore(rootStore, (state) => state.ui);
  const canvasViewStore = createDerivedStore(rootStore, (state) => state.canvasView);
  const runtimeSnapshotStore = createDerivedStore(
    rootStore,
    (state) => state.runtimeSnapshot,
  );
  const simulationSelectionStore = createDerivedStore(
    rootStore,
    (state) => state.simulationSelection,
  );
  const simulationInspectorDetailsStore = createDerivedStore(
    rootStore,
    (state) => state.simulationInspectorDetails,
  );
  const simulationPatchSetStore = createDerivedStore(
    rootStore,
    (state) => state.simulationPatchSet,
  );

  return {
    rootStore,
    get document() {
      return rootStore.getSnapshot().document;
    },
    get topology() {
      return rootStore.getSnapshot().topology;
    },
    get editorSession() {
      return rootStore.getSnapshot().editorSession;
    },
    get editorHistory() {
      return rootStore.getSnapshot().editorHistory;
    },
    get runtimeSnapshot() {
      return rootStore.getSnapshot().runtimeSnapshot;
    },
    get simulationSelection() {
      return rootStore.getSnapshot().simulationSelection;
    },
    get simulationInspectorDetails() {
      return rootStore.getSnapshot().simulationInspectorDetails;
    },
    get simulationPatchSet() {
      return rootStore.getSnapshot().simulationPatchSet;
    },
    documentStore: documentStore.store,
    topologyStore: topologyStore.store,
    editorSessionStore: editorSessionStore.store,
    editorHistoryStore: editorHistoryStore.store,
    editorStore: editorStore.store,
    uiStore: uiStore.store,
    canvasViewStore: canvasViewStore.store,
    runtimeSnapshotStore: runtimeSnapshotStore.store,
    simulationSelectionStore: simulationSelectionStore.store,
    simulationInspectorDetailsStore: simulationInspectorDetailsStore.store,
    simulationPatchSetStore: simulationPatchSetStore.store,
    dispose: () => {
      documentStore.dispose();
      topologyStore.dispose();
      editorSessionStore.dispose();
      editorHistoryStore.dispose();
      editorStore.dispose();
      uiStore.dispose();
      canvasViewStore.dispose();
      runtimeSnapshotStore.dispose();
      simulationSelectionStore.dispose();
      simulationInspectorDetailsStore.dispose();
      simulationPatchSetStore.dispose();
    },
  };
}
