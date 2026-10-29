import { memo, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerResult } from "@/domain/blueprint-planner";
import type { BlueprintPreviewHandle, BlueprintPreviewViewport } from "@/domain/renderer";
import { resolveWheelZoomDirection } from "@/shared/browser/wheel-zoom";
import type { AppHost } from "../host";
import styles from "./blueprint-planner-dialog.module.scss";

const clampZoom = (zoom: number) => Math.max(.25, Math.min(6, zoom));

/** 最优蓝图身份不变时沿用画布；统计刷新、改名和保存不重建 WebGL 上下文。 */
export const BlueprintPlannerResultPreview = memo(observer(function BlueprintPlannerResultPreview({ appHost, result }: {
  appHost: AppHost; result: BlueprintPlannerResult;
}) {
  const renderer = appHost.workspace.render, t = appHost.actions.translate;
  const stage = useRef<HTMLDivElement>(null), canvasHost = useRef<HTMLDivElement>(null);
  const handle = useRef<BlueprintPreviewHandle | null>(null);
  const dimensions = useRef({ width: 0, height: 0 });
  const [ready, setReady] = useState(false), [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<BlueprintPreviewViewport>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const viewRef = useRef(view);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      dimensions.current = { width: Math.max(0, Math.floor(rect.width)), height: Math.max(0, Math.floor(rect.height)) };
      setReady(dimensions.current.width > 0 && dimensions.current.height > 0);
      if (renderer && handle.current) renderer.actions.resizeBlueprintPreview(handle.current, dimensions.current.width, dimensions.current.height);
    };
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(element);
    return () => observer.disconnect();
  }, [renderer]);
  useEffect(() => {
    viewRef.current = view;
    if (renderer && handle.current) renderer.actions.updateBlueprintPreviewViewport(handle.current, view);
  }, [renderer, view]);
  useEffect(() => {
    const element = canvasHost.current;
    if (!renderer || !ready || !element) return;
    let alive = true, mounted: BlueprintPreviewHandle | null = null;
    void renderer.actions.mountBlueprintPreview({ blueprint: result.blueprint, ...dimensions.current, viewport: viewRef.current })
      .then(value => {
        if (!alive) { renderer.actions.disposeBlueprintPreview(value); return; }
        mounted = value; handle.current = value;
        const canvas = renderer.queries.getBlueprintPreviewCanvas(value);
        if (canvas) {
          canvas.ariaHidden = "true";
          // 内嵌画布允许单指纵向滚动，双指缩放由预览容器处理。
          canvas.style.touchAction = "pan-y";
          element.replaceChildren(canvas);
        }
        renderer.actions.resizeBlueprintPreview(value, dimensions.current.width, dimensions.current.height);
        renderer.actions.updateBlueprintPreviewViewport(value, viewRef.current);
      }).catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => {
      alive = false; handle.current = null; element.replaceChildren();
      if (mounted) renderer.actions.disposeBlueprintPreview(mounted);
    };
  }, [renderer, result.blueprint, ready]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let gesture: { distance: number; x: number; y: number } | null = null;
    const pair = (event: TouchEvent) => {
      if (event.touches.length !== 2) return null;
      const a = event.touches[0]!, b = event.touches[1]!;
      return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    };
    const start = (event: TouchEvent) => {
      gesture = pair(event);
      if (gesture && event.cancelable) event.preventDefault();
    };
    const move = (event: TouchEvent) => {
      const next = pair(event), previous = gesture;
      if (!previous || !next) return;
      if (event.cancelable) event.preventDefault();
      setView(view => ({ zoom: clampZoom(view.zoom * (previous.distance > 0 ? next.distance / previous.distance : 1)),
        offsetX: view.offsetX + next.x - previous.x, offsetY: view.offsetY + next.y - previous.y }));
      gesture = next;
    };
    const end = () => { gesture = null; };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const direction = resolveWheelZoomDirection(event.deltaY, appHost.internalState.settings.invertWheelZoom);
      if (direction) setView(view => ({ ...view, zoom: clampZoom(view.zoom * (direction > 0 ? 1.12 : 1 / 1.12)) }));
    };
    element.addEventListener("touchstart", start, { passive: false });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end); element.addEventListener("touchcancel", end);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("touchstart", start); element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end); element.removeEventListener("touchcancel", end);
      element.removeEventListener("wheel", wheel);
    };
  }, [appHost]);
  return <section className={styles.resultPreview} aria-label={t("eda.preview")}>
    <div className={styles.resultPreviewHeading}>
      <div><h3>{t("eda.preview")}</h3>
        <p>{result.metrics.width} × {result.metrics.height} · {result.metrics.productionDeviceCount} {t("eda.devices")}
          {result.metrics.gasDiffuserCount > 0 ? ` · ${t("eda.environmentCount").replace("{count}", String(result.metrics.gasDiffuserCount))}` : ""}</p>
      </div>
      <div className={styles.previewControls}>
        <button type="button" aria-label={t("eda.previewZoomOut")} onClick={() => setView(view => ({ ...view, zoom: clampZoom(view.zoom / 1.3) }))}>−</button>
        <button type="button" onClick={() => setView({ zoom: 1, offsetX: 0, offsetY: 0 })}>{t("eda.previewFit")}</button>
        <button type="button" aria-label={t("eda.previewZoomIn")} onClick={() => setView(view => ({ ...view, zoom: clampZoom(view.zoom * 1.3) }))}>+</button>
      </div>
    </div>
    <div ref={stage} className={styles.resultPreviewStage}
      onPointerDown={event => {
        if (event.pointerType === "touch" || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }} onPointerMove={event => {
        const previous = drag.current;
        if (!previous || previous.id !== event.pointerId) return;
        setView(view => ({ ...view, offsetX: view.offsetX + event.clientX - previous.x, offsetY: view.offsetY + event.clientY - previous.y }));
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <div ref={canvasHost} className={styles.previewCanvas} />
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </section>;
}), (previous, next) => previous.appHost === next.appHost && previous.result.taskId === next.result.taskId
  && previous.result.blueprint.blueprintId === next.result.blueprint.blueprintId);
