import type { WorldDocument } from "@/domain/document/world-document";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import { isSameCanvasViewState } from "@/workbench/canvas-view-store";
import { isSameEditorSession } from "@/editor/editor-runtime-store";
import {
  computed,
  makeAutoObservable,
  observable,
  reaction,
} from "@/shared/mobx";
import { createSnapshotBridge } from "@/shared/mobx/snapshot-bridge";
import type { ReadonlySnapshotStore } from "@/workbench/workspace-store";
import type {
  CanvasViewState,
  WorkspaceEditorState,
} from "@/workbench/workspace-state";
import {
  type RenderDerivedState,
  type WorkspaceRenderDerivedInputState,
  deriveRenderDerivedState,
} from "@/workbench/workspace-derived-state";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";

export interface WorkspaceDerivedStore {
  renderStore: ReadonlySnapshotStore<RenderDerivedState>;
  dispose: () => void;
}

export interface CreateWorkspaceDerivedStoreOptions {
  documentStore: ReadonlySnapshotStore<WorldDocument>;
  editorStore: ReadonlySnapshotStore<WorkspaceEditorState>;
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

function createDerivedWorkspaceState(options: {
  document: WorldDocument;
  editorSession: WorkspaceEditorState["session"];
  canvasView: CanvasViewState;
}): WorkspaceRenderDerivedInputState {
  return {
    document: options.document,
    editorSession: options.editorSession,
    canvasView: options.canvasView,
  };
}

class WorkspaceDerivedStoreImpl implements WorkspaceDerivedStore {
  readonly renderStore;

  private documentInput: WorldDocument;
  private editorSessionInput: WorkspaceEditorState["session"];
  private canvasViewInput: CanvasViewState;
  private topologyInput: CompiledTopology;

  private readonly registry: Stage1Registry;
  private readonly documentStoreSource: ReadonlySnapshotStore<WorldDocument>;
  private readonly editorStoreSource: ReadonlySnapshotStore<WorkspaceEditorState>;
  private readonly canvasViewStoreSource: ReadonlySnapshotStore<CanvasViewState>;
  private readonly topologyStoreSource: ReadonlySnapshotStore<CompiledTopology>;
  private readonly placementPreviewProfiler?: PlacementPreviewProfiler;
  private readonly renderSnapshotBridge;
  private readonly stopRenderReaction: () => void;
  private readonly inputUnsubscribers: Array<() => void>;

  constructor(options: CreateWorkspaceDerivedStoreOptions) {
    this.documentStoreSource = options.documentStore;
    this.editorStoreSource = options.editorStore;
    this.canvasViewStoreSource = options.canvasViewStore;
    this.topologyStoreSource = options.topologyStore;
    this.registry = options.registry;
    this.placementPreviewProfiler = options.placementPreviewProfiler;
    this.documentInput = options.documentStore.getSnapshot();
    this.editorSessionInput = options.editorStore.getSnapshot().session;
    this.canvasViewInput = options.canvasViewStore.getSnapshot();
    this.topologyInput = options.topologyStore.getSnapshot();

    makeAutoObservable(
      this,
      {
        documentStoreSource: false,
        editorStoreSource: false,
        canvasViewStoreSource: false,
        topologyStoreSource: false,
        registry: false,
        placementPreviewProfiler: false,
        renderStore: false,
        renderSnapshotBridge: false,
        stopRenderReaction: false,
        inputUnsubscribers: false,
        documentInput: observable.ref,
        editorSessionInput: observable.ref,
        canvasViewInput: observable.ref,
        topologyInput: observable.ref,
        render: computed,
        dispose: false,
      },
      {
        autoBind: true,
      },
    );

    this.renderSnapshotBridge = createSnapshotBridge(this.render);
    this.renderStore = this.renderSnapshotBridge;
    this.stopRenderReaction = reaction(
      () => this.render,
      (nextRender) => {
        this.renderSnapshotBridge.publish(nextRender);
      },
      {
        equals: isSameRenderDerivedState,
      },
    );
    this.inputUnsubscribers = [
      this.documentStoreSource.subscribe(this.syncDocumentInput),
      this.editorStoreSource.subscribe(this.syncEditorSessionInput),
      this.canvasViewStoreSource.subscribe(this.syncCanvasViewInput),
      this.topologyStoreSource.subscribe(this.syncTopologyInput),
    ];
  }

  get render(): RenderDerivedState {
    const derive = () =>
      deriveRenderDerivedState({
        workspaceState: createDerivedWorkspaceState({
          document: this.documentInput,
          editorSession: this.editorSessionInput,
          canvasView: this.canvasViewInput,
        }),
        topology: this.topologyInput,
        registry: this.registry,
      });

    if (!this.placementPreviewProfiler) {
      return derive();
    }

    return this.placementPreviewProfiler.measureStage(
      "workspaceDerived.recompute",
      derive,
    );
  }

  dispose(): void {
    this.stopRenderReaction();

    for (const unsubscribe of this.inputUnsubscribers) {
      unsubscribe();
    }
  }

  private syncDocumentInput(): void {
    const nextDocument = this.documentStoreSource.getSnapshot();

    if (this.documentInput === nextDocument) {
      return;
    }

    this.documentInput = nextDocument;
  }

  private syncEditorSessionInput(): void {
    const nextSession = this.editorStoreSource.getSnapshot().session;

    if (isSameEditorSession(this.editorSessionInput, nextSession)) {
      return;
    }

    this.editorSessionInput = nextSession;
  }

  private syncCanvasViewInput(): void {
    const nextCanvasView = this.canvasViewStoreSource.getSnapshot();

    if (isSameCanvasViewState(this.canvasViewInput, nextCanvasView)) {
      return;
    }

    this.canvasViewInput = nextCanvasView;
  }

  private syncTopologyInput(): void {
    const nextTopology = this.topologyStoreSource.getSnapshot();

    if (this.topologyInput === nextTopology) {
      return;
    }

    this.topologyInput = nextTopology;
  }
}

export function createWorkspaceDerivedStore(
  options: CreateWorkspaceDerivedStoreOptions,
): WorkspaceDerivedStore {
  return new WorkspaceDerivedStoreImpl(options);
}
