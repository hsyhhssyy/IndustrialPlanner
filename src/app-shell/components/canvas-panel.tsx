import type { WorkbenchController } from "@/app-shell/contracts/workbench-facade";
import { useExternalStore } from "@/app-shell/hooks/use-external-store";
import { RendererHost } from "@/renderer/host/renderer-host";
import type { CSSProperties, MouseEvent } from "react";

export interface CanvasPanelProps {
  controller: WorkbenchController;
}

export function CanvasPanel({ controller }: CanvasPanelProps) {
  const renderScene = useExternalStore(controller.renderSceneStore);

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    void controller.handleCanvasClick({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  return (
    <main className="canvas-panel panel-surface">
      <div className="canvas-stage">
        <div
          onClick={handleCanvasClick}
          className="canvas-scroll-surface"
          style={
            {
              "--renderer-width": `${Math.floor(renderScene.worldWidth * renderScene.zoom)}px`,
              "--renderer-height": `${Math.floor(renderScene.worldHeight * renderScene.zoom)}px`,
            } as CSSProperties
          }
        >
          <RendererHost scene={renderScene} />
        </div>
      </div>
    </main>
  );
}
