import {
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";
import { useViewportResizeAdapter } from "@/app/app-shell/components/canvas-panel-files/viewport-resize-adapter";
import { useEffect, useRef } from "react";

export function CanvasPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const viewportSurfaceRef = useRef<HTMLDivElement | null>(null);
  const renderCanvas = appHost.workspace.render?.canvas ?? null;

  useViewportResizeAdapter({
    editor: appHost.workspace.editor,
    viewportSurfaceRef,
  });

  useEffect(() => {
    if (!renderCanvas) {
      return;
    }

    const rendererHost = rendererHostRef.current;
    if (!rendererHost) {
      return;
    }

    renderCanvas.classList.add("renderer-canvas");
    rendererHost.appendChild(renderCanvas);

    return () => {
      if (renderCanvas.parentElement === rendererHost) {
        rendererHost.removeChild(renderCanvas);
      }
    };
  }, [renderCanvas]);

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
          ref={viewportSurfaceRef}
        >
          {renderCanvas ? (
            <div className="renderer-host" ref={rendererHostRef} />
          ) : (
            <div className="canvas-placeholder">{t("status.ready")}</div>
          )}
        </div>
      </div>
    </main>
  );
}