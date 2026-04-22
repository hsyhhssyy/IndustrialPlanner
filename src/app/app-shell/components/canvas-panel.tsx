import type { AppHost } from "@/app/app-host";
import type { LongPressState } from "@/app/input/gesture-adapter";
import { useViewportResizeAdapter } from "@/app/app-shell/components/canvas-panel-files/viewport-resize-adapter";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, WheelEvent } from "react";

export function CanvasPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const gestureAdapter = appHost.gestureAdapter;
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const viewportSurfaceRef = useRef<HTMLDivElement | null>(null);
  const renderCanvas = appHost.workspace.render?.canvas ?? null;
  const [longPressState, setLongPressState] = useState<LongPressState>(() =>
    gestureAdapter.getLongPressState(),
  );

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

  useEffect(() => {
    return gestureAdapter.subscribeLongPressState((state) => {
      const viewportRect = viewportSurfaceRef.current?.getBoundingClientRect();
      setLongPressState({
        ...state,
        position:
          state.position === null
            ? null
            : {
                x: state.position.x - (viewportRect?.left ?? 0),
                y: state.position.y - (viewportRect?.top ?? 0),
              },
      });
    });
  }, [gestureAdapter]);

  useEffect(() => {
    const handleWindowBlur = () => {
      gestureAdapter.handleBlur();
    };
    const handleVisibilityChange = () => {
      gestureAdapter.handleVisibilityChange(document.visibilityState === "hidden");
    };

    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      gestureAdapter.handleBlur();
    };
  }, [gestureAdapter]);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    gestureAdapter.handlePointerDown(event);
  };
  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    gestureAdapter.handlePointerMove(event);
  };
  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    gestureAdapter.handlePointerUp(event);
  };
  const handlePointerCancel = (event: PointerEvent<HTMLElement>) => {
    gestureAdapter.handlePointerCancel(event);
  };
  const handleLostPointerCapture = (event: PointerEvent<HTMLElement>) => {
    gestureAdapter.handleLostPointerCapture(event);
  };
  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    gestureAdapter.handleWheel(event);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    gestureAdapter.handleKeyDown(event);
  };
  const handleKeyUp = (event: KeyboardEvent<HTMLElement>) => {
    gestureAdapter.handleKeyUp(event);
  };
  const handleBlur = () => {
    gestureAdapter.handleBlur();
  };

  return (
    <main
      className="canvas-panel panel-surface"
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      tabIndex={0}
    >
      <div className="canvas-stage">
        <div className="canvas-viewport-surface" ref={viewportSurfaceRef}>
          {renderCanvas ? <div className="renderer-host" ref={rendererHostRef} /> : null}
          {renderCanvas ? null : <div className="canvas-placeholder">{t("status.ready")}</div>}
          <CanvasTouchHoldIndicator state={longPressState} />
        </div>
      </div>
    </main>
  );
}

function CanvasTouchHoldIndicator({ state }: { state: LongPressState }) {
  if (!state.visible || state.position === null) {
    return null;
  }

  const left = state.position.x;
  const top = state.position.y;
  const animationDuration = `${state.durationMs}ms`;
  const progressDashOffset = 100.53 * (1 - state.progress);

  return (
    <div
      className="canvas-touch-hold-indicator"
      key={state.startedAt ?? "ready"}
      style={{ left, top }}
    >
      <svg className="canvas-touch-hold-indicator-ring" viewBox="0 0 40 40">
        <circle
          className="canvas-touch-hold-indicator-track"
          cx="20"
          cy="20"
          r="16"
        />
        <circle
          className="canvas-touch-hold-indicator-progress"
          cx="20"
          cy="20"
          r="16"
          style={{
            animationDuration,
            strokeDasharray: 100.53,
            strokeDashoffset: progressDashOffset,
          }}
        />
      </svg>
      <div className="canvas-touch-hold-indicator-core" />
    </div>
  );
}
