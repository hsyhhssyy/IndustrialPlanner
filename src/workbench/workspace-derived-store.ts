import type { WorldDocument } from "@/domain/document/world-document";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import {
  createSnapshotStore,
  type SnapshotStore,
} from "@/shared/snapshot-store/snapshot-store";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";
import type {
  CanvasViewState,
  WorkspaceEditorState,
} from "@/workbench/workspace-state";
import type { WorkbenchUiState } from "@/workbench/workbench-ui-state";
import {
  deriveWorkspaceDerivedState,
  type WorkspaceDerivedState,
  type RenderDerivedState,
  type WorkspaceRenderDerivedInputState,
} from "@/workbench/workspace-derived-state";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";

export interface WorkspaceDerivedStore {
  rootStore: SnapshotStore<WorkspaceDerivedState>;
  renderStore: ReadonlySnapshotStore<RenderDerivedState>;
  dispose: () => void;
}

export interface CreateWorkspaceDerivedStoreOptions {
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  editorStore: ReadonlySnapshotStore<WorkspaceEditorState>;
  uiStore: ReadonlySnapshotStore<WorkbenchUiState>;
  canvasViewStore: ReadonlySnapshotStore<CanvasViewState>;
  topologyStore: ReadonlySnapshotStore<CompiledTopology>;
  registry: Stage1Registry;
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

function isSameScreenBox(
  left: RenderDerivedState["anchoredPlacementScreenBox"],
  right: RenderDerivedState["anchoredPlacementScreenBox"],
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}

function isSameRenderDerivedState(
  left: RenderDerivedState,
  right: RenderDerivedState,
): boolean {
  return (
    left.cellSizePx === right.cellSizePx &&
    left.worldBoundsPx.width === right.worldBoundsPx.width &&
    left.worldBoundsPx.height === right.worldBoundsPx.height &&
    left.cameraTransform.zoom === right.cameraTransform.zoom &&
    left.cameraTransform.viewportOffset.x ===
      right.cameraTransform.viewportOffset.x &&
    left.cameraTransform.viewportOffset.y ===
      right.cameraTransform.viewportOffset.y &&
    isSameScreenBox(
      left.anchoredPlacementScreenBox,
      right.anchoredPlacementScreenBox,
    ) &&
    isSameScreenBox(
      left.anchoredMoveScreenBox,
      right.anchoredMoveScreenBox,
    ) &&
    isSameScreenBox(
      left.anchoredSelectionScreenBox,
      right.anchoredSelectionScreenBox,
    ) &&
    isSameScreenBox(left.marqueeScreenBox, right.marqueeScreenBox)
  );
}

function isSameWorkspaceDerivedState(
  left: WorkspaceDerivedState,
  right: WorkspaceDerivedState,
): boolean {
  return isSameRenderDerivedState(left.render, right.render);
}

function createDerivedWorkspaceState(
  options: CreateWorkspaceDerivedStoreOptions,
): WorkspaceRenderDerivedInputState {
  return {
    document: options.documentStore.getSnapshot(),
    editorSession: options.editorStore.getSnapshot().session,
    ui: options.uiStore.getSnapshot(),
    canvasView: options.canvasViewStore.getSnapshot(),
  };
}

export function createWorkspaceDerivedStore(
  options: CreateWorkspaceDerivedStoreOptions,
): WorkspaceDerivedStore {
  const rootStore = createSnapshotStore(
    deriveWorkspaceDerivedState({
      workspaceState: createDerivedWorkspaceState(options),
      topology: options.topologyStore.getSnapshot(),
      registry: options.registry,
    }),
  );
  const renderStore = createSnapshotStore(rootStore.getSnapshot().render);

  const recomputeWorkspaceDerivedState = () => {
    const nextState = deriveWorkspaceDerivedState({
      workspaceState: createDerivedWorkspaceState(options),
      topology: options.topologyStore.getSnapshot(),
      registry: options.registry,
    });

    rootStore.update((currentState) =>
      isSameWorkspaceDerivedState(currentState, nextState)
        ? currentState
        : nextState,
    );
    renderStore.update((currentRenderState) =>
      isSameRenderDerivedState(currentRenderState, nextState.render)
        ? currentRenderState
        : nextState.render,
    );
  };

  const recompute = () => {
    if (options.placementPreviewProfiler) {
      options.placementPreviewProfiler.measureStage(
        "workspaceDerived.recompute",
        recomputeWorkspaceDerivedState,
      );
      return;
    }

    recomputeWorkspaceDerivedState();
  };

  const unsubscribers = [
    options.documentStore.subscribe(recompute),
    options.editorStore.subscribe(recompute),
    options.uiStore.subscribe(recompute),
    options.canvasViewStore.subscribe(recompute),
    options.topologyStore.subscribe(recompute),
  ];

  return {
    rootStore,
    renderStore,
    dispose: () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    },
  };
}
