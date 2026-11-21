import { observer } from "mobx-react-lite";
import { isPlannerManualBoundaryWidthFeasible } from "@/shared/planner-dimension-limits";
import type { AppHost } from "../host";
import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
import styles from "./blueprint-planner-manual.module.scss";

export const BlueprintPlannerBoundaryPositionModeOptions = observer(function BlueprintPlannerBoundaryPositionModeOptions({ appHost, disabled }: {
  appHost: AppHost; disabled: boolean;
}) {
  const state = appHost.blueprintPlannerDialog.manual, layout = state.layout, t = appHost.actions.translate;
  if (!layout) return null;
  const position = layout.boundary.position;
  const singleSide = position?.right !== null && position?.right !== undefined && position.left === null ? "right" : "left";
  const mode = position?.left !== null && position?.left !== undefined && position.right !== null ? "both"
    : position && (position.left !== null || position.right !== null) ? "single" : "none";
  const disabledReason = appHost.blueprintPlannerDialog.taskLocked ? t("eda.manual.reasonTaskLocked")
    : state.loading ? t("eda.manual.preparing") : disabled ? t("eda.manual.reasonBusy") : undefined;
  const exact = appHost.blueprintPlannerDialog.options.dimensionLimits?.exactBaseLength;
  return <>
    <BlueprintPlannerChoice label={t("eda.manual.positioning")} value={position ? "absolute" : "relative"} disabled={disabled} disabledReason={disabledReason}
      choices={[{ value: "relative", label: t("eda.manual.positioning.relative") }, { value: "absolute", label: t("eda.manual.positioning.absolute") }]}
      onChange={state.setPositioningMode} />
    {position ? <>
      <BlueprintPlannerChoice label={t("eda.manual.sidePosition")} value={mode} disabled={disabled} disabledReason={disabledReason}
        choices={(["none", "single", "both"] as const).map(value => ({ value, label: t(`eda.manual.sidePosition.${value}`),
          disabled: value === "both" && (appHost.blueprintPlannerDialog.options.dimensionLimits?.exactSideLength !== undefined || exact === undefined && mode !== "both"),
          disabledReason: value === "both" ? t(appHost.blueprintPlannerDialog.options.dimensionLimits?.exactSideLength !== undefined
            ? "eda.dimensions.otherExactReason" : "eda.manual.exactLengthRequired") : undefined }))}
        onChange={state.setBoundarySideMode} />
      {mode === "single" ? <BlueprintPlannerChoice label={t("eda.manual.singleSide")} value={singleSide} disabled={disabled} disabledReason={disabledReason}
        choices={(["left", "right"] as const).map(value => ({ value, label: t(`eda.manual.side.${value}`) }))}
        onChange={state.setBoundarySingleSide} /> : null}
    </> : null}
    {state.absoluteOrientationIncomplete ? <p role="alert" className={styles.error}>{t("eda.manual.absoluteRequiresFixed")}</p> : null}
    {state.boundaryInputError ? <p role="alert" className={styles.error}>{t(state.boundaryInputError)}</p> : null}
  </>;
});

export const BlueprintPlannerBoundaryPositionControls = observer(function BlueprintPlannerBoundaryPositionControls({ appHost, disabled, onFocus, onSelectAll, onClearSelection, onMoveSelection }: {
  appHost: AppHost; disabled: boolean; onFocus?: () => void; onSelectAll?: () => void; onClearSelection?: () => void; onMoveSelection?: (pointer: "mouse" | "touch") => void;
}) {
  const state = appHost.blueprintPlannerDialog.manual, layout = state.layout, t = appHost.actions.translate;
  if (!layout || !layout.boundary.position && !onSelectAll) return null;
  const position = layout.boundary.position, distance = state.selectedDeviceBaseDistance();
  return <div className={styles.boundaryPositionControls}>
    {position && onFocus ? <button type="button" disabled={disabled} onClick={onFocus}>{t("eda.manual.focusBoundary")}</button> : null}
    {onSelectAll ? <button type="button" disabled={disabled || layout.placements.length === 0} onClick={onSelectAll}>{t("eda.manual.selectAll")}</button> : null}
    {onMoveSelection ? <button type="button" disabled={disabled || state.selectedCount === 0}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); onMoveSelection(event.pointerType === "touch" ? "touch" : "mouse"); }}
      onClick={event => { if (event.detail === 0) onMoveSelection("touch"); }}>{t("eda.manual.moveSelection")}</button> : null}
    {onClearSelection ? <button type="button" disabled={disabled || state.selectedCount === 0} onClick={onClearSelection}>{t("eda.manual.clearSelection")}</button> : null}
    {position?.left !== null && position?.left !== undefined && position.right !== null
      ? <output>{t("eda.manual.fixedBaseLength")} {position.right - position.left}</output> : null}
    {distance === null ? null : <output aria-label={t(state.selectedCount > 1 ? "eda.manual.selectedGroupBaseDistance" : "eda.manual.selectedBaseDistance")}>
      {t(state.selectedCount > 1 ? "eda.manual.selectedGroupBaseDistance" : "eda.manual.selectedBaseDistance")} {distance}</output>}
    {state.absoluteOrientationIncomplete || state.absoluteDirectionIncomplete ? <span role="alert" className={styles.error}>{t("eda.manual.absoluteRequiresDirection")}</span> : null}
    {!isPlannerManualBoundaryWidthFeasible(appHost.workspace.registry, { ...appHost.blueprintPlannerDialog.getRequest(), manualLayout: layout })
      ? <span role="alert" className={styles.error}>{t("eda.manual.boundaryConflict")}</span> : null}
    {state.boundaryInputError ? <span role="alert" className={styles.error}>{t(state.boundaryInputError)}</span> : null}
  </div>;
});

// AI-REMOVED 2026-11-21:
// Reason: 用户只在布局设置填写全局精确长度，不选择边坐标、锚定侧或拖动边界；净距通过选择并移动设备调整。
// Trigger: 本轮用户明确交互修正。
// Evidence: 前序长度为唯一配置入口；固定参照不随设备组变化。
// Replacement: 上方固定参照模式与只读距离、共享画布选择和移动。
// Risk: 旧几何继续读取，原操作入口撤销；需触屏与桌面验证。Human Review: Required
// Original code:
// import { isPlannerManualBoundaryWidthFeasible } from "@/shared/planner-dimension-limits";
// import { useEffect, useRef, useState } from "react";
// import { observer } from "mobx-react-lite";
// import type { BlueprintPlannerManualBoundaryPosition } from "@/domain/blueprint-planner";
// import type { GridPoint, GridRotation } from "@/domain/shared/grid";
// import { projectManualBoundaryRect } from "@/shared/geometry/manual-boundary-position";
// import { rotateManualPoint } from "@/shared/geometry/manual-layout-transform";
// import { resolveEntityGridRect } from "@/shared/geometry/power-range";
// import { resolveViewportPointFromWorldPoint, resolveWorldPointFromViewportPoint } from "@/shared/geometry/viewport-transform";
// import type { AppHost } from "../host";
// import type { CanvasInteractionController } from "../canvas";
// import { BlueprintPlannerChoice } from "./blueprint-planner-choice";
// import styles from "./blueprint-planner-manual.module.scss";
//
// function IntegerPosition({ value, label, disabled, commit, syncToken }: {
//   value: number; label: string; disabled: boolean; syncToken: number; commit: (value: number) => void;
// }) {
//   const [input, setInput] = useState({ draft: String(value), value, syncToken });
//   if (input.value !== value || input.syncToken !== syncToken) setInput({ draft: String(value), value, syncToken });
//   const draft = input.draft;
//   return <label>{label}<input aria-label={label} type="number" step="1" value={draft} disabled={disabled}
//     onChange={event => setInput({ ...input, draft: event.target.value })} onBlur={() => commit(draft.trim() === "" ? NaN : Number(draft))}
//     onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
// }
//
// // AI-REMOVED 2026-11-20:
// // Reason: 相对／绝对及侧边模式必须前置，精确长度编辑唯一几何，包围盒净距不能冒充单设备参照。
// // Trigger: 用户验收订正 REQ-051 相对摆放与绝对定位矩阵。
// // Evidence: 最新需求及实施设计的向导职责与距离口径。
// // Replacement: 下方 ModeOptions、Controls 及选中设备只读净距。
// // Risk: 控件入口变化，需重新三屏验收。Human Review: Required
// // Original code:
// // export const BlueprintPlannerBoundaryPositionControls = observer(function BlueprintPlannerBoundaryPositionControls({ appHost, disabled }: {
// //   appHost: AppHost; disabled: boolean;
// // }) {
// //   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout, t = appHost.actions.translate;
// //   if (!layout) return null;
// //   const position = layout.boundary.position;
// //   const eligible = layout.orientation === "fixed" && layout.boundary.rotation !== null;
// //   const rectangles = layout.placements.flatMap(placement => {
// //     const definition = appHost.workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId);
// //     return definition ? [projectManualBoundaryRect(resolveEntityGridRect({ definition, entity: {
// //       id: placement.referenceNode.id, definitionId: definition.id, position: placement.position,
// //       rotation: placement.rotation, config: {}, tags: [],
// //     } }), layout.boundary.rotation ?? 0)] : [];
// //   });
// //   const left = rectangles.length ? Math.min(...rectangles.map(rect => rect.x)) : 0;
// //   const right = rectangles.length ? Math.max(...rectangles.map(rect => rect.x + rect.width)) : 30;
// //   const bottom = rectangles.length ? Math.max(...rectangles.map(rect => rect.y + rect.height)) : 20;
// //   const singleSide = position?.right !== null && position?.right !== undefined && position.left === null ? "right" : "left";
// //   const mode = position?.left !== null && position?.left !== undefined && position.right !== null ? "both"
// //     : position && (position.left !== null || position.right !== null) ? "single" : "none";
// //   return <div className={styles.boundaryPositionControls}>
// //     <label title={!eligible ? t("eda.manual.boundaryInactive") : undefined}><input type="checkbox" role="switch" checked={position !== null} disabled={disabled || !eligible}
// //       onChange={event => state.setBoundaryPosition(event.target.checked ? { base: bottom, left: null, right: null } : null)} />{t("eda.manual.lockBoundary")}</label>
// //     {position ? <>
// //       <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.base} label={t("eda.manual.baseCoordinate")} disabled={disabled || !eligible}
// //         commit={base => state.setBoundaryPosition({ ...position, base })} />
// //       <BlueprintPlannerChoice label={t("eda.manual.sidePosition")} value={mode} disabled={disabled || !eligible}
// //         choices={(["none", "single", "both"] as const).map(value => ({ value, label: t(`eda.manual.sidePosition.${value}`) }))}
// //         onChange={value => state.setBoundaryPosition({ ...position,
// //           left: value === "both" || value === "single" && singleSide === "left" ? position.left ?? left : null,
// //           right: value === "both" || value === "single" && singleSide === "right" ? position.right ?? Math.max(right, (position.left ?? left) + 1) : null })} />
// //       {mode === "single" ? <BlueprintPlannerChoice label={t("eda.manual.singleSide")} value={singleSide} disabled={disabled || !eligible}
// //         choices={(["left", "right"] as const).map(value => ({ value, label: t(`eda.manual.side.${value}`) }))}
// //         onChange={value => state.setBoundaryPosition({ ...position,
// //           left: value === "left" ? position.left ?? left : null, right: value === "right" ? position.right ?? right : null })} /> : null}
// //       {position.left === null ? null : <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.left} label={t("eda.manual.leftCoordinate")} disabled={disabled || !eligible}
// //         commit={value => state.setBoundaryPosition({ ...position, left: value })} />}
// //       {position.right === null ? null : <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.right} label={t("eda.manual.rightCoordinate")} disabled={disabled || !eligible}
// //         commit={value => state.setBoundaryPosition({ ...position, right: value })} />}
// //       {position.left !== null && position.right !== null ? <output>{t("eda.manual.exactWidth")} {position.right - position.left}</output> : null}
// //       {rectangles.length ? <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.base - bottom} label={t("eda.manual.baseDistance")}
// //         disabled={disabled || !eligible} commit={distance => state.setBoundaryPosition({ ...position, base: bottom + distance })} /> : null}
// //     </> : null}
// //     {!eligible && position ? <span>{t("eda.manual.boundaryInactive")}</span> : null}
// //     {!isPlannerManualBoundaryWidthFeasible(appHost.workspace.registry, { ...appHost.blueprintPlannerDialog.getRequest(), manualLayout: layout })
// //       ? <span role="alert" className={styles.error}>{t("eda.manual.boundaryConflict")}</span> : null}
// //     {state.boundaryInputError ? <span role="alert" className={styles.error}>{t("eda.manual.boundaryInvalid")}</span> : null}
// //   </div>;
// // });
//
// export const BlueprintPlannerBoundaryPositionModeOptions = observer(function BlueprintPlannerBoundaryPositionModeOptions({ appHost, disabled }: {
//   appHost: AppHost; disabled: boolean;
// }) {
//   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout, t = appHost.actions.translate;
//   if (!layout) return null;
//   const position = layout.boundary.position;
//   const singleSide = position?.right !== null && position?.right !== undefined && position.left === null ? "right" : "left";
//   const mode = position?.left !== null && position?.left !== undefined && position.right !== null ? "both"
//     : position && (position.left !== null || position.right !== null) ? "single" : "none";
//   const rectangles = layout.placements.flatMap(placement => {
//     const definition = appHost.workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId);
//     return definition ? [projectManualBoundaryRect(resolveEntityGridRect({ definition, entity: {
//       id: placement.referenceNode.id, definitionId: definition.id, position: placement.position,
//       rotation: placement.rotation, config: {}, tags: [],
//     } }), layout.boundary.rotation ?? 0)] : [];
//   });
//   const left = rectangles.length ? Math.min(...rectangles.map(rect => rect.x)) - 3 : 0;
//   const right = rectangles.length ? Math.max(...rectangles.map(rect => rect.x + rect.width)) + 3 : 24;
//   const bottom = rectangles.length ? Math.max(...rectangles.map(rect => rect.y + rect.height)) + 3 : 16;
//   return <>
//     <BlueprintPlannerChoice label={t("eda.manual.positioning")} value={position ? "absolute" : "relative"} disabled={disabled}
//       choices={[{ value: "relative", label: t("eda.manual.positioning.relative") }, { value: "absolute", label: t("eda.manual.positioning.absolute") }]}
//       onChange={value => state.setBoundaryPosition(value === "absolute" ? { base: bottom, left: null, right: null } : null)} />
//     {position ? <>
//       <BlueprintPlannerChoice label={t("eda.manual.sidePosition")} value={mode} disabled={disabled}
//         choices={(["none", "single", "both"] as const).map(value => ({ value, label: t(`eda.manual.sidePosition.${value}`) }))}
//         onChange={value => state.setBoundaryPosition({ ...position,
//           left: value === "both" || value === "single" && singleSide === "left" ? position.left ?? left : null,
//           right: value === "both" || value === "single" && singleSide === "right" ? position.right ?? Math.max(right, (position.left ?? left) + 1) : null })} />
//       {mode === "single" ? <BlueprintPlannerChoice label={t("eda.manual.singleSide")} value={singleSide} disabled={disabled}
//         choices={(["left", "right"] as const).map(value => ({ value, label: t(`eda.manual.side.${value}`) }))}
//         onChange={value => {
//           state.setBoundaryWidthAnchor(value);
//           state.setBoundaryPosition({ ...position, left: value === "left" ? position.left ?? left : null,
//             right: value === "right" ? position.right ?? right : null });
//         }} /> : null}
//     </> : null}
//     {state.absoluteOrientationIncomplete ? <p role="alert" className={styles.error}>{t("eda.manual.absoluteRequiresFixed")}</p> : null}
//   </>;
// });
//
// export const BlueprintPlannerBoundaryPositionControls = observer(function BlueprintPlannerBoundaryPositionControls({ appHost, disabled, onFocus }: {
//   appHost: AppHost; disabled: boolean; onFocus?: () => void;
// }) {
//   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout, t = appHost.actions.translate;
//   if (!layout?.boundary.position) return null;
//   const position = layout.boundary.position;
//   const selectedDistance = state.selectedDeviceBaseDistance();
//   return <div className={styles.boundaryPositionControls}>
//     {onFocus ? <button type="button" disabled={disabled} onClick={onFocus}>{t("eda.manual.focusBoundary")}</button> : null}
//     <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.base} label={t("eda.manual.baseCoordinate")} disabled={disabled}
//       commit={base => state.setBoundaryPosition({ ...position, base })} />
//     {position.left === null ? null : <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.left} label={t("eda.manual.leftCoordinate")} disabled={disabled}
//       commit={left => state.setBoundaryPosition({ ...position, left })} />}
//     {position.right === null ? null : <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.right} label={t("eda.manual.rightCoordinate")} disabled={disabled}
//       commit={right => state.setBoundaryPosition({ ...position, right })} />}
//     {position.left !== null && position.right !== null ? <>
//       <BlueprintPlannerChoice label={t("eda.manual.widthAnchor")} value={state.boundaryWidthAnchor} disabled={disabled}
//         choices={(["left", "right"] as const).map(value => ({ value, label: t(`eda.manual.side.${value}`) }))}
//         onChange={state.setBoundaryWidthAnchor} />
//       <IntegerPosition syncToken={state.boundaryInputEpoch} value={position.right - position.left} label={t("eda.manual.exactBaseLength")} disabled={disabled}
//         commit={state.setBoundaryWidth} />
//     </> : null}
//     {selectedDistance === null ? null : <output>{t("eda.manual.selectedBaseDistance")} {selectedDistance}</output>}
//     {state.absoluteOrientationIncomplete || state.absoluteDirectionIncomplete ? <span role="alert" className={styles.error}>{t("eda.manual.absoluteRequiresDirection")}</span> : null}
//     {!isPlannerManualBoundaryWidthFeasible(appHost.workspace.registry, { ...appHost.blueprintPlannerDialog.getRequest(), manualLayout: layout })
//       ? <span role="alert" className={styles.error}>{t("eda.manual.boundaryConflict")}</span> : null}
//     {state.boundaryInputError ? <span role="alert" className={styles.error}>{t("eda.manual.boundaryInvalid")}</span> : null}
//   </div>;
// });
//
// /** 只呈现操作手柄；约束线与非法区域仍由共享 SceneSpace 的 Renderer 绘制。 */
// export const BlueprintPlannerBoundaryPositionHandles = observer(function BlueprintPlannerBoundaryPositionHandles({ appHost, canvas, disabled }: {
//   appHost: AppHost; canvas: CanvasInteractionController; disabled: boolean;
// }) {
//   const state = appHost.blueprintPlannerDialog.manual, layout = state.layout, t = appHost.actions.translate;
//   const drag = useRef<{ id: number; key: keyof BlueprintPlannerManualBoundaryPosition; start: GridPoint;
//     position: BlueprintPlannerManualBoundaryPosition; value: number } | null>(null);
//   const [preview, setPreview] = useState<{ key: keyof BlueprintPlannerManualBoundaryPosition; value: number } | null>(null);
//   const container = useRef<HTMLDivElement>(null);
//   const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
//   const activeHandles = JSON.stringify([layout?.orientation, layout?.boundary.rotation,
//     !!layout?.boundary.position, layout?.boundary.position?.left === null, layout?.boundary.position?.right === null]);
//   useEffect(() => {
//     const root = container.current;
//     if (!root) return;
//     const observer = new ResizeObserver(entries => {
//       setSizes(previous => {
//         let next = previous;
//         for (const entry of entries) {
//           const key = (entry.target as HTMLElement).dataset.boundaryHandle;
//           if (!key) continue;
//           const box = entry.borderBoxSize[0];
//           const width = box?.inlineSize ?? entry.target.getBoundingClientRect().width;
//           const height = box?.blockSize ?? entry.target.getBoundingClientRect().height;
//           if (previous[key]?.width !== width || previous[key]?.height !== height) next = { ...next, [key]: { width, height } };
//         }
//         return next;
//       });
//     });
//     root.querySelectorAll("button").forEach(button => observer.observe(button));
//     return () => observer.disconnect();
//   }, [activeHandles]);
//   if (!layout?.boundary.position || layout.orientation !== "fixed" || layout.boundary.rotation === null) return null;
//   const position = layout.boundary.position, rotation = layout.boundary.rotation;
//   const view = canvas.view.state;
//   const projection = { viewportBounds: view.clientRect, viewportCenter: view.center,
//     gridCellPixelSize: view.gridCellPixelSize, displayRotation: view.displayRotation };
//   const inverse = ((360 - rotation) % 360) as GridRotation;
//   const localCenter = rotateManualPoint(view.center, inverse);
//   const localPointer = (clientX: number, clientY: number) => {
//     const world = resolveWorldPointFromViewportPoint({ ...projection, viewportPoint: { x: clientX, y: clientY } });
//     return world === null ? null : rotateManualPoint(world, inverse);
//   };
//   const finish = (pointerId: number, cancelled = false) => {
//     const current = drag.current;
//     if (current?.id !== pointerId) return;
//     if (!cancelled) state.setBoundaryPosition({ ...current.position, [current.key]: current.value });
//     drag.current = null; setPreview(null);
//   };
//   // AI-REMOVED 2026-11-20:
//   // Reason: 仅避让其他标签仍会遮住已摆设备的中心和点击区域。
//   // Trigger: mobile 真实三格放置后，底边标签覆盖设备中心。
//   // Evidence: mobile-1795190286326/final.png，设备约 y200..230，标签约 y214..244。
//   // Replacement: 下方已摆设备真实占地的屏幕矩形作为同一有限候选的障碍。
//   // Risk: Low；只移动标签沿线位置。Human Review: Required
//   // Original code:
//   // const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
//   const occupied: Array<{ x: number; y: number; width: number; height: number }> = layout.placements.flatMap(placement => {
//     const definition = appHost.workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId);
//     if (!definition) return [];
//     const rect = resolveEntityGridRect({ definition, entity: { id: placement.referenceNode.id, definitionId: definition.id,
//       position: placement.position, rotation: placement.rotation, config: {}, tags: [] } });
//     const points = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
//       { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]
//       .map(worldPoint => resolveViewportPointFromWorldPoint({ ...projection, worldPoint }));
//     const x = Math.min(...points.map(point => point.x)) - view.clientRect.left;
//     const y = Math.min(...points.map(point => point.y)) - view.clientRect.top;
//     const right = Math.max(...points.map(point => point.x)) - view.clientRect.left;
//     const bottom = Math.max(...points.map(point => point.y)) - view.clientRect.top;
//     return x < view.clientRect.width && right > 0 && y < view.clientRect.height && bottom > 0
//       ? [{ x, y, width: right - x, height: bottom - y }] : [];
//   });
//   return <div ref={container} className={styles.boundaryHandles}>
//     {(["base", "left", "right"] as const).flatMap(key => {
//       const value = preview?.key === key ? preview.value : position[key];
//       if (value === null) return [];
//       const local = key === "base" ? { x: localCenter.x, y: value } : { x: value, y: localCenter.y };
//       const worldPoint = rotateManualPoint(local, rotation);
//       const point = resolveViewportPointFromWorldPoint({ ...projection, worldPoint });
//       const horizontal = (key === "base") !== ((rotation + view.displayRotation) % 180 === 90);
//       const anchorX = point.x - view.clientRect.left, anchorY = point.y - view.clientRect.top;
//       const visible = anchorX >= 0 && anchorX <= view.clientRect.width && anchorY >= 0 && anchorY <= view.clientRect.height;
//       // 2026-11-20：仅将可见边界的标签向视口内对齐；约束线与拖动参照仍在真实世界坐标。
//       // 订正（2026-11-20）：真实浏览器的混合百分比 clamp 未限制右侧位移，改为沿边界法线朝视口中心对齐。
//       // AI-REMOVED 2026-11-20:
//       // Reason: 浏览器对 transform 中混合百分比 clamp 的计算未将右侧标签约束在画布内。
//       // Trigger: tablet 真实视觉验收仍发现标签裁切。
//       // Evidence: camera width=290、anchorX=285.95、label width=73.80；computed translateX=-36.90，而上限应约 -69.75。
//       // Replacement: 下方沿法线朝视口中心的单值百分比对齐。
//       // Risk: Low；保留真实世界锚点、离屏隐藏和拖动增量。Human Review: Required
//       // Original code:
//       // const alignment = `translate(clamp(${-anchorX}px, -50%, calc(${view.clientRect.width - anchorX}px - 100%)), clamp(${-anchorY}px, -50%, calc(${view.clientRect.height - anchorY}px - 100%)))`;
//       // AI-REMOVED 2026-11-20:
//       // Reason: 三个标签同时采用视口切向中心，会在真实边界交点附近重叠。
//       // Trigger: desktop 三屏验收发现底边与左边标签覆盖。
//       // Evidence: base bbox x1465..1535/y658.65..690.65，left x1405.97..1480.65/y670..702。
//       // Replacement: 下方仅沿各自约束线选择最近的不相交标签位置。
//       // Risk: Low；真实约束坐标、离屏规则和拖动起点不变。Human Review: Required
//       // Original code:
//       // const alignment = horizontal
//       //   ? `translate(-50%, ${anchorY <= view.clientRect.height / 2 ? "0%" : "-100%"})`
//       //   : `translate(${anchorX <= view.clientRect.width / 2 ? "0%" : "-100%"}, -50%)`;
//       const { width, height } = sizes[key] ?? { width: 70, height: 32 };
//       const span = horizontal ? view.clientRect.width : view.clientRect.height;
//       const extent = horizontal ? width : height;
//       const preferred = (horizontal ? anchorX : anchorY) - extent / 2;
//       // 订正（2026-11-20）：优先贴在合法区域外侧；外侧不足才回退到视口内并沿线避让设备。
//       const outward = rotateManualPoint(key === "base" ? { x: 0, y: 1 } : { x: key === "left" ? -1 : 1, y: 0 }, rotation);
//       const outwardPoint = resolveViewportPointFromWorldPoint({ ...projection,
//         worldPoint: { x: worldPoint.x + outward.x, y: worldPoint.y + outward.y } });
//       const outwardSign = Math.sign(horizontal ? outwardPoint.y - point.y : outwardPoint.x - point.x);
//       const normalAnchor = horizontal ? anchorY : anchorX, normalExtent = horizontal ? height : width;
//       const normalSpan = horizontal ? view.clientRect.height : view.clientRect.width;
//       const outwardNormal = normalAnchor - (outwardSign < 0 ? normalExtent : 0);
//       const fits = (start: number) => start >= 0 && start + normalExtent <= normalSpan;
//       // AI-REMOVED 2026-11-20:
//       // Reason: 朝视口中心放置会在三格净距处遮住设备。
//       // Trigger: mobile 实际设备交互与视觉验收。
//       // Evidence: 底边外侧尚有 33px，32px 标签却放进合法区域。
//       // Replacement: 外侧放得下时留 1px，差 1px 时允许贴线；否则复用原内侧沿线候选。
//       // Risk: Low；真实边界锚点和拖动增量不变。Human Review: Required
//       // Original code:
//       // const normal = horizontal ? anchorY <= view.clientRect.height / 2 ? anchorY : anchorY - height
//       //   : anchorX <= view.clientRect.width / 2 ? anchorX : anchorX - width;
//       const normal = fits(outwardNormal + outwardSign) ? outwardNormal + outwardSign
//         : fits(outwardNormal) ? outwardNormal
//         : normalAnchor <= normalSpan / 2 ? normalAnchor : normalAnchor - normalExtent;
//       const at = (tangent: number) => horizontal ? { x: tangent, y: normal, width, height }
//         : { x: normal, y: tangent, width, height };
//       const gap = 6;
//       const candidates = [preferred, 0, span - extent, ...occupied.flatMap(box => horizontal
//         ? [box.x - width - gap, box.x + box.width + gap] : [box.y - height - gap, box.y + box.height + gap])]
//         .map(value => Math.max(0, Math.min(span - extent, value)))
//         .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
//       const tangent = candidates.find(value => {
//         const candidate = at(value);
//         return occupied.every(box => candidate.x + width + gap <= box.x || box.x + box.width + gap <= candidate.x
//           || candidate.y + height + gap <= box.y || box.y + box.height + gap <= candidate.y);
//       }) ?? candidates[0]!;
//       const box = at(tangent);
//       if (visible) occupied.push(box);
//       return [<button key={key} type="button" className={styles.boundaryHandle} disabled={disabled}
//         aria-label={t(`eda.manual.drag.${key}`)} data-boundary-handle={key}
//         style={{ left: box.x, top: box.y, transform: "none", visibility: visible && sizes[key] ? "visible" : "hidden",
//           cursor: horizontal ? "ns-resize" : "ew-resize" }}
//         onPointerDown={event => {
//           event.preventDefault(); event.stopPropagation();
//           const start = localPointer(event.clientX, event.clientY);
//           if (start === null) return;
//           event.currentTarget.setPointerCapture(event.pointerId);
//           drag.current = { id: event.pointerId, key, start, position, value };
//         }} onPointerMove={event => {
//           const current = drag.current;
//           if (current?.id !== event.pointerId) return;
//           event.preventDefault(); event.stopPropagation();
//           const point = localPointer(event.clientX, event.clientY);
//           if (point === null) return;
//           current.value = current.position[key]! + Math.round(key === "base" ? point.y - current.start.y : point.x - current.start.x);
//           setPreview({ key, value: current.value });
//         }} onPointerUp={event => { event.preventDefault(); event.stopPropagation(); finish(event.pointerId); }}
//         onPointerCancel={event => finish(event.pointerId, true)} onLostPointerCapture={event => finish(event.pointerId, true)}>
//         {t(`eda.manual.side.${key}`)} {value}
//       </button>];
//     })}
//   </div>;
// });
