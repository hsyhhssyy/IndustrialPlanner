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
