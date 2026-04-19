import {
  STATIC_UI_PLACEHOLDER_TEXT,
  handleUiEvent,
} from "@/app/app-shell/components/ui-shell-null-handlers";
import type { AppHost } from "@/app/app-host";
import { useEffect, useRef } from "react";

function resolveViewportPixelSize(element: HTMLDivElement) {
  return {
    width: Math.max(0, Math.floor(element.clientWidth)),
    height: Math.max(0, Math.floor(element.clientHeight)),
  };
}

export function CanvasPanel({ appHost }: { appHost: AppHost }) {
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const viewportSurfaceRef = useRef<HTMLDivElement | null>(null);
  const renderCanvas = appHost.workspace.render?.canvas ?? null;

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

  useEffect(() => {
    const editor = appHost.workspace.editor;
    const viewportSurface = viewportSurfaceRef.current;

    if (!editor || !viewportSurface || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      const pixelSize = resolveViewportPixelSize(viewportSurface);

      if (
        pixelSize.width === editor.state.viewport.pixelSize.width &&
        pixelSize.height === editor.state.viewport.pixelSize.height
      ) {
        return;
      }

      editor.actions.setViewportPixelSize(pixelSize);
    });

    resizeObserver.observe(viewportSurface);

    return () => {
      resizeObserver.disconnect();
    };
  }, [appHost]);

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
            <div className="canvas-placeholder">{STATIC_UI_PLACEHOLDER_TEXT}</div>
          )}
        </div>
      </div>
    </main>
  );
}