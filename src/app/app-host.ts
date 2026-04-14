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
