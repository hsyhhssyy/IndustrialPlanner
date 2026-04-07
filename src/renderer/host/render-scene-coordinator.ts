import type { WorldDocument } from "@/domain/document/world-document";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import { buildRenderScene } from "@/renderer/scene/build-render-scene";
import type {
  RenderSceneInteractionState,
  RenderSceneModel,
} from "@/renderer/scene/types";
import type { SimulationState } from "@/simulation/host/simulation-host";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";
import type {
  CanvasViewState,
  WorkspaceState,
} from "@/workbench/workspace-state";
import type { WorkbenchUiState } from "@/workbench/workbench-ui-state";
import type { AppLocale } from "@/i18n/messages";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import { getPendingLinkSourceEntityId } from "@/editor/contracts/interaction-mode";

export interface RenderSceneCoordinatorSource {
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  editorStore: ReadonlySnapshotStore<WorkspaceState["editor"]>;
  uiStore: ReadonlySnapshotStore<WorkbenchUiState>;
  canvasViewStore: ReadonlySnapshotStore<CanvasViewState>;
  simulationStore: ReadonlySnapshotStore<SimulationState>;
  topologyStore: ReadonlySnapshotStore<CompiledTopology>;
  registry: Stage1Registry;
}

export interface RenderSceneCoordinator {
  dispose: () => void;
}

interface RenderSceneCoordinatorInput {
  locale: AppLocale;
  document: WorldDocument;
  topology: CompiledTopology;
  canvasView: CanvasViewState;
  interaction: RenderSceneInteractionState;
  runtimeSnapshot: SimulationState["runtimeSnapshot"];
}

export interface CreateRenderSceneCoordinatorOptions {
  source: RenderSceneCoordinatorSource;
  presentScene: (scene: RenderSceneModel) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

function buildRenderInteractionState(
  editor: WorkspaceState["editor"],
  ui: WorkbenchUiState,
  simulation: SimulationState,
): RenderSceneInteractionState {
  if (ui.phase === "simulate") {
    return {
      selectedEntityIds: simulation.selection,
      placementPreview: null,
      pendingLinkSourceEntityId: null,
    };
  }

  return {
    selectedEntityIds: editor.session.selection,
    placementPreview: editor.session.placementPreview,
    pendingLinkSourceEntityId: getPendingLinkSourceEntityId(
      editor.session.currentMode,
    ),
  };
}

function collectRenderSceneCoordinatorInput(
  source: RenderSceneCoordinatorSource,
): RenderSceneCoordinatorInput {
  const ui = source.uiStore.getSnapshot();
  const editor = source.editorStore.getSnapshot();
  const simulation = source.simulationStore.getSnapshot();

  return {
    locale: ui.locale,
    document: source.documentStore.getSnapshot(),
    topology: source.topologyStore.getSnapshot(),
    canvasView: source.canvasViewStore.getSnapshot(),
    interaction: buildRenderInteractionState(editor, ui, simulation),
    runtimeSnapshot: simulation.runtimeSnapshot,
  };
}

function isSameRenderSceneInteractionState(
  left: RenderSceneInteractionState,
  right: RenderSceneInteractionState,
): boolean {
  return (
    left.selectedEntityIds === right.selectedEntityIds &&
    left.placementPreview === right.placementPreview &&
    left.pendingLinkSourceEntityId === right.pendingLinkSourceEntityId
  );
}

function isSameRenderSceneCoordinatorInput(
  left: RenderSceneCoordinatorInput,
  right: RenderSceneCoordinatorInput,
): boolean {
  return (
    left.locale === right.locale &&
    left.document === right.document &&
    left.topology === right.topology &&
    left.canvasView === right.canvasView &&
    left.runtimeSnapshot === right.runtimeSnapshot &&
    isSameRenderSceneInteractionState(left.interaction, right.interaction)
  );
}

export function createRenderSceneCoordinator(
  options: CreateRenderSceneCoordinatorOptions,
): RenderSceneCoordinator {
  const requestFrame =
    options.requestFrame ?? window.requestAnimationFrame.bind(window);
  const cancelFrame =
    options.cancelFrame ?? window.cancelAnimationFrame.bind(window);
  let disposed = false;
  let dirty = true;
  let pendingFrameHandle: number | null = null;
  let currentInput = collectRenderSceneCoordinatorInput(options.source);

  const flush = () => {
    pendingFrameHandle = null;

    if (disposed || !dirty) {
      return;
    }

    dirty = false;
    const scene = options.placementPreviewProfiler
      ? options.placementPreviewProfiler.measureStage(
          "render.coordinator.buildScene",
          () =>
            buildRenderScene({
              locale: currentInput.locale,
              document: currentInput.document,
              topology: currentInput.topology,
              registry: options.source.registry,
              canvasView: currentInput.canvasView,
              interaction: currentInput.interaction,
              runtimeSnapshot: currentInput.runtimeSnapshot,
            }),
        )
      : buildRenderScene({
          locale: currentInput.locale,
          document: currentInput.document,
          topology: currentInput.topology,
          registry: options.source.registry,
          canvasView: currentInput.canvasView,
          interaction: currentInput.interaction,
          runtimeSnapshot: currentInput.runtimeSnapshot,
        });

    options.presentScene(scene);
  };

  const schedule = () => {
    if (disposed) {
      return;
    }

    dirty = true;

    if (pendingFrameHandle !== null) {
      return;
    }

    pendingFrameHandle = requestFrame(() => {
      flush();
    });
  };

  const handleStoreChange = () => {
    const nextInput = options.placementPreviewProfiler
      ? options.placementPreviewProfiler.measureStage(
          "render.coordinator.collectInput",
          () => collectRenderSceneCoordinatorInput(options.source),
        )
      : collectRenderSceneCoordinatorInput(options.source);

    if (isSameRenderSceneCoordinatorInput(currentInput, nextInput)) {
      return;
    }

    currentInput = nextInput;
    schedule();
  };

  const unsubscribers = [
    options.source.documentStore.subscribe(handleStoreChange),
    options.source.editorStore.subscribe(handleStoreChange),
    options.source.uiStore.subscribe(handleStoreChange),
    options.source.canvasViewStore.subscribe(handleStoreChange),
    options.source.simulationStore.subscribe(handleStoreChange),
    options.source.topologyStore.subscribe(handleStoreChange),
  ];

  schedule();

  return {
    dispose: () => {
      disposed = true;

      if (pendingFrameHandle !== null) {
        cancelFrame(pendingFrameHandle);
        pendingFrameHandle = null;
      }

      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    },
  };
}
