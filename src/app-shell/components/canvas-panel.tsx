import type { WorkbenchController, WorkbenchSnapshot } from "@/app-shell/controller/workbench-controller";
import { RendererHost } from "@/renderer/host/renderer-host";
import type { CSSProperties } from "react";

export interface CanvasPanelProps {
  controller: WorkbenchController;
  snapshot: WorkbenchSnapshot;
}

export function CanvasPanel({ controller, snapshot }: CanvasPanelProps) {
  return (
    <main className="canvas-panel panel-surface">
      <div className="canvas-stage">
        <div
          className="canvas-scroll-surface"
          style={
            {
              "--renderer-width": `${Math.floor(snapshot.renderScene.worldWidth * snapshot.renderScene.zoom)}px`,
              "--renderer-height": `${Math.floor(snapshot.renderScene.worldHeight * snapshot.renderScene.zoom)}px`,
            } as CSSProperties
          }
        >
          <RendererHost
            onSceneClick={(interaction) => {
              void controller.handleSceneClick(interaction);
            }}
            scene={snapshot.renderScene}
          />
        </div>
      </div>
    </main>
  );
}
