import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import {
  createWorkspaceDerivedStore,
  type WorkspaceDerivedStore,
} from "@/workbench/derived/workspace-derived-store";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";

export interface AppHost {
  controller: WorkbenchController;
  workspaceDerivedStore: WorkspaceDerivedStore;
  placementPreviewProfiler?: PlacementPreviewProfiler;
  dispose: () => void;
}

export interface CreateAppHostOptions {
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

export function createAppHost(
  controller: WorkbenchController,
  options: CreateAppHostOptions = {},
): AppHost {
  const workspaceDerivedStore = createWorkspaceDerivedStore({
    documentStore: controller.workspaceState.documentStore,
    editorStore: controller.workspaceState.editorStore,
    canvasViewStore: controller.workspaceState.canvasViewStore,
    topologyStore: controller.workspaceState.topologyStore,
    registry: controller.registry,
    placementPreviewProfiler: options.placementPreviewProfiler,
  });

  return {
    controller,
    workspaceDerivedStore,
    placementPreviewProfiler: options.placementPreviewProfiler,
    dispose: () => {
      workspaceDerivedStore.dispose();
    },
  };
}
