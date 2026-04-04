import type { WorkbenchController } from "@/workbench/contracts/workbench-facade";
import {
  createWorkspaceDerivedStore,
  type WorkspaceDerivedStore,
} from "@/workbench/workspace-derived-store";

export interface WorkbenchShell {
  controller: WorkbenchController;
  workspaceDerivedStore: WorkspaceDerivedStore;
  dispose: () => void;
}

export function createWorkbenchShell(
  controller: WorkbenchController,
): WorkbenchShell {
  const workspaceDerivedStore = createWorkspaceDerivedStore({
    documentStore: controller.documentStore,
    editorStore: controller.editorStore,
    uiStore: controller.uiStore,
    canvasViewStore: controller.canvasViewStore,
    simulationStore: controller.simulationStore,
    topologyStore: controller.topologyStore,
    registry: controller.registry,
  });

  return {
    controller,
    workspaceDerivedStore,
    dispose: () => {
      workspaceDerivedStore.dispose();
    },
  };
}
