import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { WorkbenchController } from "@/workspace/workspace-facade";
import type { WorkspaceDerivedStore } from "@/workbench/derived/workspace-derived-store";

export interface CanvasPanelProps {
  controller: WorkbenchController;
  workspaceDerivedStore: Pick<WorkspaceDerivedStore, "render">;
}

export function CanvasPanel(_props: CanvasPanelProps) {
  return (
    <main className="canvas-panel panel-surface">
      <div
        className="canvas-stage"
        onBlur={handleUiEvent}
        onKeyDown={handleUiEvent}
        onKeyUp={handleUiEvent}
        tabIndex={0}
      >
        <div
          className="canvas-viewport-surface"
          onContextMenu={handleUiEvent}
          onLostPointerCapture={handleUiEvent}
          onPointerCancel={handleUiEvent}
          onPointerDown={handleUiEvent}
          onPointerEnter={handleUiEvent}
          onPointerLeave={handleUiEvent}
          onPointerMove={handleUiEvent}
          onPointerUp={handleUiEvent}
          onWheel={handleUiEvent}
        >
          <div className="canvas-placeholder">{STATIC_UI_PLACEHOLDER_TEXT}</div>
        </div>
      </div>
    </main>
  );
}