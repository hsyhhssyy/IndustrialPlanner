import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerBlueprintBoundary } from "@/domain/blueprint-planner";
import type { BlueprintPreviewHandle, BlueprintPreviewViewport } from "@/domain/renderer";
import type { AppHost } from "../host";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";
import { resolveRotatedPortGeometry } from "@/shared/geometry/port";
import { resolveViewportAxisPixelPosition } from "@/shared/geometry/viewport-transform";
import { blueprintBoundaryKey } from "@/shared/planner-task";
import { layoutIdentificationMarkers } from "./blueprint-identification-marker-layout";
import styles from "./blueprint-planner-dialog.module.scss";

/** 标记和预览共用固定 bounds、viewport；不读取 Renderer 的内部对象。 */
// AI-CORRECTION 2026-10-08：bounds 在同一帧中共用；随容器尺寸为偏移标签保留上下空位。
export function BlueprintIdentificationPreview({ appHost, blueprint, boundaries, selected, focusVersion, onSelect }: {
  appHost: AppHost; blueprint: BlueprintDocument; boundaries: readonly BlueprintPlannerBlueprintBoundary[];
  selected: string | null; focusVersion: number; onSelect: (boundary: BlueprintPlannerBlueprintBoundary) => void;
}) {
  const frame = useRef<HTMLDivElement>(null), canvasHost = useRef<HTMLDivElement>(null);
  const handle = useRef<BlueprintPreviewHandle | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<BlueprintPreviewViewport>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const viewRef = useRef(view), sizeRef = useRef(size);
  const focusedVersion = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const renderer = appHost.workspace.render, t = appHost.actions.translate;
  const geometry = useMemo(() => resolveEntityGridGeometry({
    entities: blueprint.entityOrder.map(id => blueprint.entities[id]!),
    entityDefinitionMap: new Map(appHost.workspace.registry.entityDefinitions.map(definition => [definition.id, definition])),
  }), [appHost.workspace.registry, blueprint]);
  const bounds = useMemo(() => {
    if (!geometry) return null;
    const box = geometry.boundingBox;
    const cell = Math.max(.5, Math.min(size.width / (box.width + 4), size.height / (box.height + 4),
      Math.max(1, size.height - 56) / box.height));
    const verticalMargin = Math.max(2, 28 / cell);
    return { left: box.left - 2, top: box.top - verticalMargin,
      width: box.width + 4, height: box.height + 2 * verticalMargin };
  }, [geometry, size]);
  const markers = useMemo(() => {
    let input = 0, output = 0;
    return boundaries.flatMap(boundary => {
      const entry = geometry?.entries.find(entry => entry.entity.id === boundary.entityId);
      if (!entry) return [];
      const port = boundary.kind === "port" ? entry.definition.portGroups.find(group => group.id === boundary.portGroupId)
        ?.ports.find(port => port.id === boundary.portId) : null;
      const anchor = port ? resolveRotatedPortGeometry({ footprint: entry.definition.footprint, port, rotation: entry.entity.rotation }).anchor
        : { x: entry.gridArea.footprint.width / 2, y: entry.gridArea.footprint.height / 2 };
      const flowPort = port ?? entry.definition.portGroups.find(group => group.direction === (boundary.direction === "input" ? "output" : "input"))?.ports[0];
      const delta = flowPort ? resolveRotatedPortGeometry({ footprint: entry.definition.footprint, port: flowPort, rotation: entry.entity.rotation }).delta : { x: 1, y: 0 };
      const sign = boundary.kind === "port" ? boundary.direction === "input" ? -1 : 1 : boundary.direction === "input" ? 1 : -1;
      const arrow = delta.x * sign > 0 ? "→" : delta.x * sign < 0 ? "←" : delta.y * sign > 0 ? "↓" : "↑";
      return [{ boundary, key: blueprintBoundaryKey(boundary), entry, arrow,
        x: entry.entity.position.x + anchor.x, y: entry.entity.position.y + anchor.y,
        label: t(boundary.direction === "input" ? "eda.inputMarker" : "eda.outputMarker")
          .replace("{index}", String(boundary.direction === "input" ? ++input : ++output)) }];
    });
  }, [boundaries, geometry, t]);
  const scale = bounds ? Math.max(.5, Math.min(size.width / bounds.width, size.height / bounds.height)) * view.zoom : 1;
  const xPixel = (x: number) => resolveViewportAxisPixelPosition({ viewportStart: view.offsetX, viewportSpan: size.width,
    viewportCenter: bounds ? bounds.left + bounds.width / 2 : 0, gridCellPixelSize: scale, worldCoordinate: x });
  const yPixel = (y: number) => resolveViewportAxisPixelPosition({ viewportStart: view.offsetY, viewportSpan: size.height,
    viewportCenter: bounds ? bounds.top + bounds.height / 2 : 0, gridCellPixelSize: scale, worldCoordinate: y });
  const entryRect = (entry: NonNullable<typeof geometry>["entries"][number]) => ({
    left: xPixel(entry.entity.position.x), top: yPixel(entry.entity.position.y),
    width: entry.gridArea.footprint.width * scale, height: entry.gridArea.footprint.height * scale,
  });
  const markerLayouts = layoutIdentificationMarkers(markers.map(marker => ({
    key: marker.key, x: xPixel(marker.x), y: yPixel(marker.y),
    width: Math.max(48, [...`${marker.arrow} ${marker.label}`].reduce((sum, character) => sum + (character.codePointAt(0)! > 127 ? 12 : 7), 12)),
    target: entryRect(marker.entry),
  })), geometry?.entries.map(entryRect) ?? [], size.width, size.height);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const rect = { width: element.clientWidth, height: element.clientHeight };
      setSize(previous => previous.width === Math.floor(rect.width) && previous.height === Math.floor(rect.height) ? previous
        : { width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
// AI-REMOVED 2026-10-07:
// Reason: 通过引用保存最新尺寸，不使用依赖规则例外。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/app/shell/blueprint-identification-preview.tsx 挂载与更新 effects
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//   useEffect(() => {
//     if (!renderer || !bounds || !canvasHost.current || size.width === 0) return;
//     let alive = true, mounted: BlueprintPreviewHandle | null = null;
//     const element = canvasHost.current;
//     void renderer.actions.mountBlueprintPreview({ blueprint, width: size.width, height: size.height, viewportBounds: bounds })
//       .then(value => {
//         if (!alive) { renderer.actions.disposeBlueprintPreview(value); return; }
//         mounted = value; handle.current = value;
//         const canvas = renderer.queries.getBlueprintPreviewCanvas(value);
//         if (canvas) element.replaceChildren(canvas);
//         renderer.actions.updateBlueprintPreviewViewport(value, viewRef.current);
//         renderer.actions.resizeBlueprintPreview(value, sizeRef.current.width, sizeRef.current.height);
//       }).catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : String(failure)); });
//     return () => {
//       alive = false; handle.current = null; element.replaceChildren();
//       if (mounted) renderer.actions.disposeBlueprintPreview(mounted);
//     };
//     // 初次尺寸用于挂载；后续 ResizeObserver 更新走 resize 契约，避免重建 WebGL 上下文。
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [renderer, blueprint, bounds, size.width > 0]);
//   const viewRef = useRef(view), sizeRef = useRef(size);
//   useEffect(() => {
//     viewRef.current = view; sizeRef.current = size;
//     if (!renderer || !handle.current) return;
//     renderer.actions.updateBlueprintPreviewViewport(handle.current, view);
//     renderer.actions.resizeBlueprintPreview(handle.current, size.width, size.height);
//   }, [renderer, view, size]);
  useEffect(() => {
    viewRef.current = view; sizeRef.current = size;
    if (!renderer || !handle.current) return;
    renderer.actions.updateBlueprintPreviewViewport(handle.current, view);
    renderer.actions.resizeBlueprintPreview(handle.current, size.width, size.height);
  }, [renderer, view, size]);
  const sized = size.width > 0;
  useEffect(() => {
    if (!renderer || !bounds || !canvasHost.current || !sized) return;
    let alive = true, mounted: BlueprintPreviewHandle | null = null;
    const element = canvasHost.current, initial = sizeRef.current;
    void renderer.actions.mountBlueprintPreview({ blueprint, width: initial.width, height: initial.height, viewportBounds: bounds })
      .then(value => {
        if (!alive) { renderer.actions.disposeBlueprintPreview(value); return; }
        mounted = value; handle.current = value;
        const canvas = renderer.queries.getBlueprintPreviewCanvas(value);
        if (canvas) element.replaceChildren(canvas);
        renderer.actions.updateBlueprintPreviewViewport(value, viewRef.current);
        renderer.actions.resizeBlueprintPreview(value, sizeRef.current.width, sizeRef.current.height);
      }).catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => {
      alive = false; handle.current = null; element.replaceChildren();
      if (mounted) renderer.actions.disposeBlueprintPreview(mounted);
    };
    // 初次尺寸用于挂载；后续 ResizeObserver 更新走 resize 契约，避免重建 WebGL 上下文。
  }, [renderer, blueprint, bounds, sized]);
  useEffect(() => {
    if (!focusVersion || focusVersion === focusedVersion.current || !bounds) return;
    const marker = markers.find(marker => marker.key === selected);
    if (!marker) return;
    focusedVersion.current = focusVersion;
    setView(previous => {
      const zoom = Math.max(previous.zoom, 1.5);
      const cell = Math.max(.5, Math.min(size.width / bounds.width, size.height / bounds.height)) * zoom;
      return { zoom, offsetX: -(marker.x - bounds.left - bounds.width / 2) * cell,
        offsetY: -(marker.y - bounds.top - bounds.height / 2) * cell };
    });
    // 定位仅由列表选择触发，配置物品变化不会重置用户视口。
    // AI-CORRECTION 2026-10-07：记录定位版本以保持视口，同时声明完整依赖。
  }, [focusVersion, bounds, markers, selected, size]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); setView(previous => ({ ...previous, zoom: Math.max(.25, Math.min(6, previous.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12))) }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const active = markers.find(marker => marker.key === selected);
  return <div className={styles.identificationPreview}>
    <div ref={frame} className={styles.previewFrame} aria-label={t("eda.preview")}
      style={{ "--boundary-label-min-height": `${Math.ceil(markers.length / 2) * 26 + 8}px` } as CSSProperties} onPointerDown={event => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }} onPointerMove={event => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;
      const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (before > 0) setView(view => ({ ...view, zoom: Math.max(.25, Math.min(6, view.zoom * after / before)) }));
      } else setView(view => ({ ...view, offsetX: view.offsetX + event.clientX - previous.x, offsetY: view.offsetY + event.clientY - previous.y }));
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }} onPointerUp={event => pointers.current.delete(event.pointerId)} onPointerCancel={event => pointers.current.delete(event.pointerId)}
      onLostPointerCapture={event => pointers.current.delete(event.pointerId)}>
      <div ref={canvasHost} className={styles.previewCanvas} />
      {active ? <div className={styles.previewSelection} style={{ left: xPixel(active.entry.entity.position.x), top: yPixel(active.entry.entity.position.y),
        width: active.entry.gridArea.footprint.width * scale, height: active.entry.gridArea.footprint.height * scale }} /> : null}
      {/* AI-REMOVED 2026-10-08:
        Reason: 居中按钮覆盖目标设备，且按钮公共样式放大了标签。
        Trigger: 用户要求参考端口优先级组，使用圆点、引线与不重叠的偏移标签。
        Evidence: 原 style 将按钮中心直接设置为 marker.x / marker.y。
        Replacement: markerLayouts、boundaryLeader 与下方偏移按钮。
        Risk: Low；视口极拥挤时仍需检查布局。Human Review: Required
        Original code:
        {markers.map(marker => <button key={marker.key} type="button" className={styles.boundaryMarker}
          data-direction={marker.boundary.direction} aria-pressed={selected === marker.key}
          aria-label={`${marker.label} · ${t(marker.entry.definition.nameKey)}`} title={`${marker.label} · ${t(marker.entry.definition.nameKey)}`}
          style={{ left: xPixel(marker.x), top: yPixel(marker.y) }} onClick={() => onSelect(marker.boundary)}>{marker.arrow} {marker.label}</button>)}
      */}
      <svg className={styles.boundaryLeaders} width={size.width} height={size.height} aria-hidden="true">
        {markerLayouts.map(layout => {
          const marker = markers.find(marker => marker.key === layout.key)!;
          return <g key={layout.key} data-direction={marker.boundary.direction} data-selected={selected === layout.key}>
            <line x1={layout.targetX} y1={layout.targetY} x2={layout.lineX} y2={layout.lineY} />
            <circle cx={layout.targetX} cy={layout.targetY} r="3" />
          </g>;
        })}
      </svg>
      {markerLayouts.map(layout => {
        const marker = markers.find(marker => marker.key === layout.key)!;
        return <button key={marker.key} type="button" className={styles.boundaryMarker}
          data-direction={marker.boundary.direction} aria-pressed={selected === marker.key}
          aria-label={`${marker.label} · ${t(marker.entry.definition.nameKey)}`} title={`${marker.label} · ${t(marker.entry.definition.nameKey)}`}
          style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }}
          onClick={() => onSelect(marker.boundary)}>{marker.arrow} {marker.label}</button>;
      })}
    </div>
    <div className={styles.previewControls}>
      <button type="button" aria-label={t("eda.previewZoomOut")} onClick={() => setView(view => ({ ...view, zoom: Math.max(.25, view.zoom / 1.3) }))}>−</button>
      <button type="button" onClick={() => setView({ zoom: 1, offsetX: 0, offsetY: 0 })}>{t("eda.previewFit")}</button>
      <button type="button" aria-label={t("eda.previewZoomIn")} onClick={() => setView(view => ({ ...view, zoom: Math.min(6, view.zoom * 1.3) }))}>+</button>
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </div>;
}
