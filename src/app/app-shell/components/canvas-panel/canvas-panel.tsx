import { RendererHost } from "@/renderer/host/renderer-host";
import { observer } from "@/shared/mobx";
import type { WorkbenchController } from "@/workspace/workspace-facade";
import type { WorkspaceDerivedStore } from "@/workbench/derived/workspace-derived-store";

const noop = () => {};

export interface CanvasPanelProps {
  controller: WorkbenchController;
  workspaceDerivedStore: Pick<WorkspaceDerivedStore, "render">;
}

export const CanvasPanel = observer(function CanvasPanel({
  controller,
}: CanvasPanelProps) {
  return (
    <main className="canvas-panel panel-surface">
      <div className="canvas-stage" onBlur={noop} onKeyDown={noop} onKeyUp={noop} tabIndex={0}>
        <div
          className="canvas-viewport-surface"
          onContextMenu={noop}
          onLostPointerCapture={noop}
          onPointerCancel={noop}
          onPointerDown={noop}
          onPointerEnter={noop}
          onPointerLeave={noop}
          onPointerMove={noop}
          onPointerUp={noop}
          onWheel={noop}
        >
          <RendererHost
            sceneSource={{
              documentStore: controller.workspaceState.documentStore,
              editorStore: controller.workspaceState.editorStore,
              uiStore: controller.workspaceState.uiStore,
              canvasViewStore: controller.workspaceState.canvasViewStore,
              topologyStore: controller.workspaceState.topologyStore,
              registry: controller.registry,
            }}
          />
        </div>
      </div>
    </main>
  );
});