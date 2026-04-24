import type { AppHost } from "@/app/app-host";
import type { LongPressState } from "@/app/input/gesture-adapter";
import type { GestureDiagnosticsSnapshot } from "@/app/input/gesture-diagnostics";
import { useViewportResizeAdapter } from "@/app/app-shell/components/canvas-panel-files/viewport-resize-adapter";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent, WheelEvent } from "react";

export function CanvasPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const gestureAdapter = appHost.gestureAdapter;
  const gestureDiagnostics = appHost.gestureDiagnostics;
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const viewportSurfaceRef = useRef<HTMLDivElement | null>(null);
  const renderCanvas = appHost.workspace.render?.canvas ?? null;
  const [longPressState, setLongPressState] = useState<LongPressState>(() =>
    gestureAdapter.getLongPressState(),
  );
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<GestureDiagnosticsSnapshot>(() =>
    gestureDiagnostics.getSnapshot(),
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
    return gestureDiagnostics.subscribe(setDiagnosticsSnapshot);
  }, [gestureDiagnostics]);

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
          <CanvasGestureDiagnosticsOverlay snapshot={diagnosticsSnapshot} />
        </div>
      </div>
    </main>
  );
}

function CanvasGestureDiagnosticsOverlay({
  snapshot,
}: {
  snapshot: GestureDiagnosticsSnapshot;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();
  const latest = snapshot.latestEvent;
  const pressedKeys = Array.from(snapshot.keyboard.pressedKeys);
  const toggleLabel = collapsed ? "Show" : "Hide";

  const handleToggleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setCollapsed((value) => !value);
  };
  const stopToggleInputPropagation = (
    event: PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
  };

  return (
    <section
      className={`canvas-gesture-diagnostics${collapsed ? " is-collapsed" : ""}`}
      aria-label="gesture diagnostics"
    >
      <div className="canvas-gesture-diagnostics-header">
        <div className="canvas-gesture-diagnostics-header-copy">
          <span>Gesture</span>
          <strong>{latest?.type ?? "idle"}</strong>
        </div>
        <button
          aria-controls={bodyId}
          aria-expanded={!collapsed}
          className="canvas-gesture-diagnostics-toggle"
          onClick={handleToggleClick}
          onKeyDown={stopToggleInputPropagation}
          onKeyUp={stopToggleInputPropagation}
          onPointerCancel={stopToggleInputPropagation}
          onPointerDown={stopToggleInputPropagation}
          onPointerMove={stopToggleInputPropagation}
          onPointerUp={stopToggleInputPropagation}
          type="button"
        >
          {toggleLabel}
        </button>
      </div>
      {collapsed ? null : (
        <div className="canvas-gesture-diagnostics-body" id={bodyId}>
          <dl className="canvas-gesture-diagnostics-grid">
            <div>
              <dt>ID</dt>
              <dd>{latest?.gestureId ?? "-"}</dd>
            </div>
            <div>
              <dt>Position</dt>
              <dd>{latest?.position ? formatPoint(latest.position) : "-"}</dd>
            </div>
            <div>
              <dt>Delta</dt>
              <dd>{latest?.delta ? formatPoint(latest.delta) : "-"}</dd>
            </div>
            <div>
              <dt>Keys</dt>
              <dd>{pressedKeys.length > 0 ? pressedKeys.join(" + ") : "-"}</dd>
            </div>
          </dl>
          <ol className="canvas-gesture-diagnostics-events">
            {snapshot.events.slice(0, 4).map((event) => (
              <li key={event.sequence}>
                <span>{event.type}</span>
                <small>{event.detail}</small>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function formatPoint(point: { readonly x: number; readonly y: number }): string {
  return `${Math.round(point.x)}, ${Math.round(point.y)}`;
}

function CanvasTouchHoldIndicator({ state }: { state: LongPressState }) {
  if (!state.visible || state.position === null) {
    return null;
  }

  const progress = Math.max(0, Math.min(1, state.progress));
  const left = state.position.x - 12;
  const top = state.position.y - 12;
  const animationDuration = `${state.durationMs}ms`;
  const animationDelay = `-${progress * state.durationMs}ms`;
  const progressDashOffset = 100.53 * (1 - progress);

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
            animationDelay,
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
