import type { AppHost } from "@/app/host/app-host";
import type { LongPressState } from "@/app/input/gesture/adapter";
import type { GestureDiagnosticsSnapshot } from "@/app/input/gesture/diagnostics";
import type { SimulationRuntimeStatistics } from "@/domain/simulation";
import { useViewportResizeAdapter } from "@/app/shell/canvas/viewport-resize-adapter";
import { observer } from "mobx-react-lite";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent, WheelEvent } from "react";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";

interface FpsSnapshot {
  fps: number;
  tps: number;
  targetTps: number;
  bufferSize: number;
}

function pollSimulationStats(appHost: AppHost): FpsSnapshot {
  const sim = appHost.workspace.simulation;
  const stats: SimulationRuntimeStatistics | undefined = sim?.state.statistics;
  return {
    // fps 由 setInterval 回调中的 rAF 计数器填充，此处仅返回其他字段
    fps: 0,
    tps: stats?.tickPerSecond ?? 0,
    targetTps: stats?.targetTickPerSecond ?? 0,
    bufferSize: sim?.state.bufferSize ?? 0,
  };
}

export const CanvasPanel = observer(function CanvasPanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const gestureAdapter = appHost.gestureAdapter;
  const gestureDiagnostics = appHost.gestureDiagnostics;
  const showGestureDiagnosticsWindow = appHost.state.settings.debugShowGestureDiagnosticsWindow;
  const showFps = appHost.state.settings.debugShowFps;
  const rendererHostRef = useRef<HTMLDivElement | null>(null);
  const viewportSurfaceRef = useRef<HTMLDivElement | null>(null);
  const renderContainer = appHost.workspace.render?.container ?? null;
  const [longPressState, setLongPressState] = useState<LongPressState>(() =>
    gestureAdapter.getLongPressState(),
  );
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<GestureDiagnosticsSnapshot>(() =>
    gestureDiagnostics.getSnapshot(),
  );
  const [fpsSnapshot, setFpsSnapshot] = useState<FpsSnapshot>(() =>
    pollSimulationStats(appHost),
  );
  const fpsFrameCountRef = useRef(0);

  // rAF 计数器：每帧递增
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      fpsFrameCountRef.current += 1;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // 每秒轮询一次 simulation stats + FPS 帧计数
  useEffect(() => {
    const id = setInterval(() => {
      const fps = fpsFrameCountRef.current;
      fpsFrameCountRef.current = 0;
      const base = pollSimulationStats(appHost);
      setFpsSnapshot({ ...base, fps });
    }, 1000);
    return () => clearInterval(id);
  }, [appHost]);

  useViewportResizeAdapter({
    editor: appHost.workspace.editor,
    viewportSurfaceRef,
  });

  useEffect(() => {
    if (!renderContainer) {
      return;
    }

    const rendererHost = rendererHostRef.current;
    if (!rendererHost) {
      return;
    }

    rendererHost.appendChild(renderContainer);

    return () => {
      if (renderContainer.parentElement === rendererHost) {
        rendererHost.removeChild(renderContainer);
      }
    };
  }, [renderContainer]);

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

  // 通过原生 DOM document capture 阶段阻止来自 canvas-panel 内部的 touch/pen 事件
  // 合成 compat mouse/click 事件，避免 ghost click 穿透到后续渲染的 dialog。
  // React 合成事件系统的 preventDefault 无法可靠阻断浏览器原生 click 合成链。
  const canvasPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onNativePointer = (e: globalThis.PointerEvent) => {
      const el = canvasPanelRef.current;
      if (!el) return;
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (!(e.target instanceof Node) || !el.contains(e.target)) return;
      e.preventDefault();
    };

    // 同时监听 touch 事件：Chromium 中 click 合成由 preventDefault on touchstart 控制，
    // 仅阻止 pointer 事件可能不足（尤其 page.tap() 先派发 touch 后合成 pointer）
    const onNativeTouch = (e: TouchEvent) => {
      const el = canvasPanelRef.current;
      if (!el) return;
      if (!(e.target instanceof Node) || !el.contains(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener('pointerdown', onNativePointer, true);
    document.addEventListener('pointerup', onNativePointer, true);
    document.addEventListener('touchstart', onNativeTouch, true);
    document.addEventListener('touchend', onNativeTouch, true);
    return () => {
      document.removeEventListener('pointerdown', onNativePointer, true);
      document.removeEventListener('pointerup', onNativePointer, true);
      document.removeEventListener('touchstart', onNativeTouch, true);
      document.removeEventListener('touchend', onNativeTouch, true);
    };
  }, []);
  const handlePointerCancel = (event: PointerEvent<HTMLElement>) => {
    gestureAdapter.handlePointerCancel(event);
  };
  const handleLostPointerCapture = (event: PointerEvent<HTMLElement>) => {
    gestureAdapter.handleLostPointerCapture(event);
  };
  const handleWheel = (event: WheelEvent<HTMLElement>) => {
    gestureAdapter.handleWheel(event);
  };
  const handleBlur = () => {
    gestureAdapter.handleBlur();
  };

  return (
    <main
      ref={canvasPanelRef}
      className={cm(styles, "canvas-panel panel-surface")}
      onBlur={handleBlur}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      tabIndex={0}
    >
      <div className={cm(styles, "canvas-stage")}>
        <div className={cm(styles, "canvas-viewport-surface")} ref={viewportSurfaceRef}>
          {renderContainer ? <div className={cm(styles, "renderer-host")} ref={rendererHostRef} /> : null}
          {renderContainer ? null : <div className={cm(styles, "canvas-placeholder")}>{t("status.ready")}</div>}
          <CanvasTouchHoldIndicator state={longPressState} />
          {showGestureDiagnosticsWindow ? (
            <CanvasGestureDiagnosticsOverlay snapshot={diagnosticsSnapshot} />
          ) : null}
          {showFps ? (
            <CanvasFpsOverlay snapshot={fpsSnapshot} />
          ) : null}
        </div>
      </div>
    </main>
  );
});

// AI-REMOVED 2026-05-21:
// Reason: 视口发光已改由 renderer 暴露的 container 内部 DOM overlay 承担，app shell 不再负责 renderer 视觉细节。
// Trigger: 用户要求 renderer 对外从 canvas 改成 div，并让 CSS 属于 renderer。
// Evidence: RenderContract.container 与 renderer-host.css 已接管 placement/marquee 全视口 glow。
// Replacement: src/renderer/renderer-host.tsx, src/renderer/renderer-host.css, src/renderer/scene/render-scene-orchestrator.ts
// Risk: Low
// Human Review: Required
//
// Original code:
// const CanvasPlacementGlowOverlay = observer(function CanvasPlacementGlowOverlay({
//   appHost,
//   show,
// }: {
//   appHost: AppHost;
//   show: boolean;
// }) {
//   if (!show) {
//     return null;
//   }
//
//   const activeTool = appHost.state.activeTool;
//   const logisticsKind = appHost.internalState.runtime.logisticsPlacement.kind;
//   const isSinglePlacement = activeTool === "single-placement";
//   const isLogisticsPlacement = activeTool === "logistics-placement" && logisticsKind !== null;
//
//   if (!isSinglePlacement && !isLogisticsPlacement) {
//     return null;
//   }
//
//   return <div className={cm(styles, "canvas-placement-glow-overlay")} />;
// });

function CanvasFpsOverlay({
  snapshot,
}: {
  snapshot: FpsSnapshot;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();
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
      className={cm(styles, `canvas-fps${collapsed ? " is-collapsed" : ""}`)}
      aria-label="fps diagnostics"
    >
      <div className={cm(styles, "canvas-fps-header")}>
        <div className={cm(styles, "canvas-fps-header-copy")}>
          <span>FPS</span>
          <strong>{snapshot.fps}</strong>
        </div>
        <button
          aria-controls={bodyId}
          aria-expanded={!collapsed}
          className={cm(styles, "canvas-fps-toggle")}
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
        <div className={cm(styles, "canvas-fps-body")} id={bodyId}>
          <table className={cm(styles, "canvas-fps-table")}>
            <tbody>
              <tr>
                <th>Tick生成/秒</th>
                <td>{snapshot.tps.toFixed(1)}</td>
              </tr>
              <tr>
                <th>动态Tick因数</th>
                <td>{snapshot.targetTps}</td>
              </tr>
              <tr>
                <th>帧缓存</th>
                <td>{snapshot.bufferSize}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
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
      className={cm(styles, `canvas-gesture-diagnostics${collapsed ? " is-collapsed" : ""}`)}
      aria-label="gesture diagnostics"
    >
      <div className={cm(styles, "canvas-gesture-diagnostics-header")}>
        <div className={cm(styles, "canvas-gesture-diagnostics-header-copy")}>
          <span>Gesture</span>
          <strong>{latest?.type ?? "idle"}</strong>
        </div>
        <button
          aria-controls={bodyId}
          aria-expanded={!collapsed}
          className={cm(styles, "canvas-gesture-diagnostics-toggle")}
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
        <div className={cm(styles, "canvas-gesture-diagnostics-body")} id={bodyId}>
          <dl className={cm(styles, "canvas-gesture-diagnostics-grid")}>
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
              <dt>Entity</dt>
              <dd>{latest?.pointerEntityId ?? "-"}</dd>
            </div>
            <div>
              <dt>Keys</dt>
              <dd>{pressedKeys.length > 0 ? pressedKeys.join(" + ") : "-"}</dd>
            </div>
          </dl>
          <ol className={cm(styles, "canvas-gesture-diagnostics-events")}>
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
      className={cm(styles, "canvas-touch-hold-indicator")}
      key={state.startedAt ?? "ready"}
      style={{ left, top }}
    >
      <svg className={cm(styles, "canvas-touch-hold-indicator-ring")} viewBox="0 0 40 40">
        <circle
          className={cm(styles, "canvas-touch-hold-indicator-track")}
          cx="20"
          cy="20"
          r="16"
        />
        <circle
          className={cm(styles, "canvas-touch-hold-indicator-progress")}
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
      <div className={cm(styles, "canvas-touch-hold-indicator-core")} />
    </div>
  );
}
