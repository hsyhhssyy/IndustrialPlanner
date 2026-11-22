// AI-REMOVED 2026-11-21: Reason: 取货口提示改为CSS视口定位。Trigger: 用户最新订正。
// Evidence: 提示不得依赖世界边界。Replacement: busHint边选择器。Risk: Low。Human Review: Required
// Original code:
// import type { SceneSpace } from "@/domain/shared/scene-space";
import { manualBoundarySides, manualBusEdge } from "@/shared/planner-manual-devices";
import { matchManualPlacements } from "@/shared/planner-manual-binding";
import { createItemIconAssetUrl } from "@/shared/browser/public-asset-url";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { observer } from "mobx-react-lite";
import type { BlueprintPlannerManualLayout, BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import { rotateManualPoint } from "@/shared/geometry/manual-layout-transform";
import { resolveViewportPointFromWorldPoint } from "@/shared/geometry/viewport-transform";
import type { CanvasInteractionController } from "../canvas";
import styles from "./blueprint-planner-manual.module.scss";

/** 虚线仅供量取尺寸。真实锁边由 SceneSpace 绘制，并独立参与放置约束。 */
export const BlueprintPlannerDimensionGuides = observer(function BlueprintPlannerDimensionGuides({ layout, limits, canvas }: {
  layout: BlueprintPlannerManualLayout;
  limits: BlueprintPlannerOptions["dimensionLimits"];
  canvas: CanvasInteractionController;
}) {
  if (layout.orientation !== "fixed" || !limits) return null;
  const position = layout.boundary.position;
  const view = canvas.view.state;
  const rotation = layout.boundary.rotation ?? 0;
  const guides = [];
  for (const axis of ["x", "y"] as const) {
    const lower = axis === "x" ? position?.left : position?.top;
    const upper = axis === "x" ? position?.right : position?.base;
    const exact = axis === "x" ? limits.exactBaseLength : limits.exactSideLength;
    const span = exact ?? (axis === "x" ? limits.maxBaseLength : limits.maxSideLength);
    if (span === undefined || (exact !== undefined && (lower != null || upper != null))) continue;
    const start = lower ?? (upper != null ? upper - span : axis === "x" ? 0 : 16 - span);
    for (const side of ["start", "end"] as const) {
      if (side === "start" ? lower != null : upper != null) continue;
      const offset = side === "start" ? start : start + span;
      const point = resolveViewportPointFromWorldPoint({ viewportBounds: view.clientRect, viewportCenter: view.center,
        gridCellPixelSize: view.gridCellPixelSize, displayRotation: view.displayRotation,
        worldPoint: rotateManualPoint(axis === "x" ? { x: offset, y: 0 } : { x: 0, y: offset }, rotation) });
      const vertical = (axis === "x") === ((rotation + view.displayRotation) % 180 === 0);
      const pixel = vertical ? point.x - view.clientRect.left : point.y - view.clientRect.top;
      guides.push(<line key={axis + side} data-axis={axis} data-side={side}
        x1={vertical ? pixel : 0} x2={vertical ? pixel : "100%"} y1={vertical ? 0 : pixel} y2={vertical ? "100%" : pixel} />);
    }
  }
  if (!guides.length) return null;
  return <svg aria-hidden="true" data-dimension-guides="true" className={styles.dimensionGuides}>{guides}</svg>;
});

/** 存取口提示固定在对应视口边中点，不接收指针事件。 */
export const BlueprintPlannerBusPortHints = observer(function BlueprintPlannerBusPortHints({ layout, shape, registry, label }: {
  layout: BlueprintPlannerManualLayout; shape: BlueprintPlannerOptions["warehouseBus"];
  registry: RegistryContract; label: string;
}) {
  const matched = matchManualPlacements(layout.preparation.nodes, layout.boundary.assignments, layout.mode).assignments;
  return <div className={styles.busHints} data-bus-hints="true">
    {manualBoundarySides(shape).map(role => {
      const edge = manualBusEdge(shape, layout.boundary.busEdges, role);
      const items = layout.boundary.assignments.filter(entry => entry.side === role).flatMap(entry => {
        const node = matched.get(entry.referenceNode.id);
        return node ? [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))] : [];
      });
      if (!items.length) return null;
      return <div key={role} className={styles.busHint} data-bus-hint-role={role} data-bus-hint-edge={edge}>
        <span>{label}</span><div>{items.map((id, index) => <img key={`${id}-${index}`} src={createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id)} alt="" />)}</div>
      </div>;
    })}
  </div>;
});

// AI-REMOVED 2026-11-21:
// Reason: 提示始终固定在视口边中点，不再跟随锁边投影或因世界边离屏隐藏。
// Trigger: 用户最新订正。
// Evidence: 取货口物品在平移、缩放及锁边离屏时应保持视口像素位置。
// Replacement: 上方纯CSS边定位组件。
// Risk: Low；真实锁边仍由Renderer绘制。Human Review: Required
// Original code:
// /** 存取口提示独立于相机旋转，不接收指针事件。 */
// export const BlueprintPlannerBusPortHints = observer(function BlueprintPlannerBusPortHints({ layout, shape, canvas, registry, label, space }: {
//   layout: BlueprintPlannerManualLayout; shape: BlueprintPlannerOptions["warehouseBus"];
//   canvas: CanvasInteractionController; registry: RegistryContract; label: string; space: SceneSpace;
// }) {
//   const view = canvas.view.state;
//   const bounds = space.areas[0]?.bounds;
//   const position = bounds ? { left: bounds.minX, right: bounds.maxX, top: bounds.minY, base: bounds.maxY } : null;
//   const width = view.clientRect.width, height = view.clientRect.height;
//   const matched = matchManualPlacements(layout.preparation.nodes, layout.boundary.assignments, layout.mode).assignments;
//   const project = (x: number, y: number) => resolveViewportPointFromWorldPoint({ viewportBounds: { left: 0, top: 0, width, height },
//     viewportCenter: view.center, gridCellPixelSize: view.gridCellPixelSize, displayRotation: view.displayRotation, worldPoint: { x, y } });
//   const lower = project(position?.left ?? view.center.x, position?.top ?? view.center.y);
//   const upper = project(position?.right ?? view.center.x, position?.base ?? view.center.y);
//   const clamp = (value: number, size: number) => Math.max(18, Math.min(Math.max(18, size - 18), value));
//   return <div className={styles.busHints} data-bus-hints="true">
//     {manualBoundarySides(shape).map(role => {
//       const edge = manualBusEdge(shape, layout.boundary.busEdges, role);
//       const horizontal = edge === "top" || edge === "bottom";
//       const locked = position?.[edge === "bottom" ? "base" : edge] != null;
//       const midpoint = !locked ? (horizontal ? width : height) / 2 : horizontal ? (Math.max(0, position?.left != null ? lower.x : 0) + Math.min(width, position?.right != null ? upper.x : width)) / 2
//         : (Math.max(0, position?.top != null ? lower.y : 0) + Math.min(height, position?.base != null ? upper.y : height)) / 2;
//       const segmentStart = horizontal ? position?.left != null ? lower.x : 0 : position?.top != null ? lower.y : 0;
//       const segmentEnd = horizontal ? position?.right != null ? upper.x : width : position?.base != null ? upper.y : height;
//       if (locked && Math.max(0, segmentStart) >= Math.min(horizontal ? width : height, segmentEnd)) return null;
//       const x = horizontal ? clamp(midpoint, width) : edge === "left" ? locked ? clamp(lower.x + 18, width) : 18 : locked ? clamp(upper.x - 18, width) : width - 18;
//       const y = horizontal ? edge === "top" ? locked ? clamp(lower.y + 18, height) : 18 : locked ? clamp(upper.y - 18, height) : height - 18 : clamp(midpoint, height);
//       const items = layout.boundary.assignments.filter(entry => entry.side === role).flatMap(entry => {
//         const node = matched.get(entry.referenceNode.id);
//         return node ? [...new Set((node.outputs.length ? node.outputs : node.inputs).map(flow => flow.itemId))] : [];
//       });
//       if (!items.length) return null;
//       const linePixel = horizontal ? edge === "top" ? lower.y : upper.y : edge === "left" ? lower.x : upper.x;
//       if (locked && (linePixel < 0 || linePixel > (horizontal ? height : width))) return null;
//       return <div key={role} className={styles.busHint} data-bus-hint-role={role} data-bus-hint-edge={edge} data-locked={locked} style={{ left: x, top: y }}>
//         <span>{label}</span><div>{items.map((id, index) => <img key={`${id}-${index}`} src={createItemIconAssetUrl(registry.queries.findItemDefinition(id)?.iconId ?? id)} alt="" />)}</div>
//       </div>;
//     })}
//   </div>;
// });
