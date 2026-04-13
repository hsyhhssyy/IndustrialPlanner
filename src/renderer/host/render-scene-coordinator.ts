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
  WorkspaceEditorState,
} from "@/workbench/workspace-state";
import type { WorkbenchUiState } from "@/workbench/workbench-ui-state";
import type { AppLocale } from "@/i18n/messages";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";
import {
  getManagedMoveDraft,
  getManagedPlacementPreview,
  getSelectedEntityIds,
} from "@/editor/contracts/editor-session-helpers";
import {
  getPendingLinkSourceEntityId,
  isMoveInteractionMode,
  isPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
import {
  deriveSelectionPresentation,
  isSameSelectionPresentationState,
} from "@/editor/contracts/selection-presentation";

export interface RenderSceneCoordinatorSource {
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  editorStore: ReadonlySnapshotStore<WorkspaceEditorState>;
  uiStore: ReadonlySnapshotStore<WorkbenchUiState>;
  canvasViewStore: ReadonlySnapshotStore<CanvasViewState>;
  runtimeSnapshotStore: ReadonlySnapshotStore<SimulationState["runtimeSnapshot"]>;
  simulationSelectionStore: ReadonlySnapshotStore<SimulationState["selection"]>;
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
  document: WorldDocument,
  editor: WorkspaceEditorState,
  ui: WorkbenchUiState,
  simulationSelection: SimulationState["selection"],
): RenderSceneInteractionState {
  if (ui.phase === "simulate") {
    return {
      selectedEntityIds: simulationSelection,
      placementPreview: null,
      moveDraft: null,
      pendingLinkSourceEntityId: null,
    };
  }

  return {
    selectedEntityIds: getSelectedEntityIds(editor.session),
    selectionPresentation: deriveSelectionPresentation(editor.session),
    drafts: editor.session.drafts,
    draftEntities: editor.session.draftEntities,
    draftInteractionMode:
      isPlacementInteractionMode(editor.session.currentMode) ||
      isMoveInteractionMode(editor.session.currentMode)
        ? editor.session.currentMode.inputMode
        : null,
    placementPreview: getManagedPlacementPreview(editor.session),
    moveDraft: getManagedMoveDraft(editor.session, document),
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
  const document = source.documentStore.getSnapshot();

  return {
    locale: ui.locale,
    document,
    topology: source.topologyStore.getSnapshot(),
    canvasView: source.canvasViewStore.getSnapshot(),
    interaction: buildRenderInteractionState(
      document,
      editor,
      ui,
      source.simulationSelectionStore.getSnapshot(),
    ),
    runtimeSnapshot: source.runtimeSnapshotStore.getSnapshot(),
  };
}

function isSameRenderSceneInteractionState(
  left: RenderSceneInteractionState,
  right: RenderSceneInteractionState,
): boolean {
  return (
    left.selectedEntityIds === right.selectedEntityIds &&
    isSameSelectionPresentationState(
      left.selectionPresentation,
      right.selectionPresentation,
    ) &&
    left.drafts === right.drafts &&
    left.draftEntities === right.draftEntities &&
    left.draftInteractionMode === right.draftInteractionMode &&
    left.placementPreview === right.placementPreview &&
    left.moveDraft === right.moveDraft &&
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
    options.source.runtimeSnapshotStore.subscribe(handleStoreChange),
    options.source.simulationSelectionStore.subscribe(handleStoreChange),
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
