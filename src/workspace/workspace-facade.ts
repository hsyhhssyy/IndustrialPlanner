import type { AppFacade } from "@/app/app-facade";
import type {
  CanvasInteractionTarget,
} from "@/editor/editor-facade";
import type { EditorFacade } from "@/editor/editor-facade";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { RenderFacade } from "@/renderer/render-facade";
import type { WorkspaceStore } from "@/workbench/state/workspace-store";

export type { CanvasInteractionTarget } from "@/editor/editor-facade";

/**
 * UI-facing workbench action surface.
 *
 * React and other UI entry points should call this layer instead of reaching
 * into EditorHost or EditorCore directly.
 */
export interface WorkbenchController {
  workspaceState: WorkspaceStore;
  app: AppFacade;
  editor: EditorFacade;
  render: RenderFacade;
  registry: Stage1Registry;
  requestCanvasKeyboardFocus: () => void;
  subscribeCanvasKeyboardFocusRequests: (
    listener: () => void,
  ) => () => void;
  dispose: () => void;
}
