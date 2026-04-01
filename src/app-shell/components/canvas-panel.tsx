import type { WorkbenchController, WorkbenchSnapshot } from "@/app-shell/controller/workbench-controller";
import { RendererHost } from "@/renderer/host/renderer-host";
import type { CSSProperties, MouseEvent } from "react";

export interface CanvasPanelProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

export function CanvasPanel({ controller, snapshot }: CanvasPanelProps) {
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
              "--renderer-width": `${Math.floor(snapshot.renderScene.worldWidth * snapshot.renderScene.zoom)}px`,
              "--renderer-height": `${Math.floor(snapshot.renderScene.worldHeight * snapshot.renderScene.zoom)}px`,
            } as CSSProperties
          }
        >
          <RendererHost scene={snapshot.renderScene} />
        </div>
      </div>
    </main>
  );
}
