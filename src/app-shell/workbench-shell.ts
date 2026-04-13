import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import {
  createWorkspaceDerivedStore,
  type WorkspaceDerivedStore,
} from "@/workbench/workspace-derived-store";
import type { PlacementPreviewProfiler } from "@/workbench/diagnostics/placement-preview-profiler";

export interface WorkbenchShell {
  controller: WorkbenchController;
  workspaceDerivedStore: WorkspaceDerivedStore;
  placementPreviewProfiler?: PlacementPreviewProfiler;
  dispose: () => void;
}

export interface CreateWorkbenchShellOptions {
  placementPreviewProfiler?: PlacementPreviewProfiler;
}

export function createWorkbenchShell(
  controller: WorkbenchController,
  options: CreateWorkbenchShellOptions = {},
): WorkbenchShell {
  const workspaceDerivedStore = createWorkspaceDerivedStore({
    documentStore: controller.documentStore,
    editorStore: controller.editorStore,
    canvasViewStore: controller.canvasViewStore,
    topologyStore: controller.topologyStore,
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
