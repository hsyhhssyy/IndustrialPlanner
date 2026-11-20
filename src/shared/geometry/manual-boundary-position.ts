import type { BlueprintPlannerManualLayout } from "@/domain/blueprint-planner";
import type { GridRotation } from "@/domain/shared/grid";
import type { SceneBounds } from "@/domain/shared/scene-space";
import { rotateManualPoint } from "./manual-layout-transform";

export function getManualBoundaryPosition(manual: BlueprintPlannerManualLayout | undefined) {
  return manual?.enabled && manual.orientation === "fixed" && manual.boundary.rotation !== null
    ? manual.boundary.position ?? undefined : undefined;
}

/** 完整半开占地的四角逆旋转；不能只旋转实体锚点。 */
export function projectManualBoundaryRect(rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  rotation: GridRotation) {
  const inverse = ((360 - rotation) % 360) as GridRotation;
  const points = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }]
    .map(point => rotateManualPoint(point, inverse));
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
}

export function manualBoundarySceneBounds(manual: BlueprintPlannerManualLayout | undefined): SceneBounds {
  const position = getManualBoundaryPosition(manual);
  if (!position || !Number.isSafeInteger(position.base)
    || position.left !== null && !Number.isSafeInteger(position.left)
    || position.right !== null && !Number.isSafeInteger(position.right)
    || position.left !== null && position.right !== null && position.left >= position.right) return { minX: null, minY: null, maxX: null, maxY: null };
  const { base, left, right } = position;
  const negate = (value: number | null) => value === null ? null : -value;
  switch (manual!.boundary.rotation) {
    case 90: return { minX: -base, maxX: null, minY: left, maxY: right };
    case 180: return { minX: negate(right), maxX: negate(left), minY: -base, maxY: null };
    case 270: return { minX: null, maxX: base, minY: negate(right), maxY: negate(left) };
    default: return { minX: left, maxX: right, minY: null, maxY: base };
  }
}

export function isRectWithinManualBoundary(rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  manual: BlueprintPlannerManualLayout | undefined): boolean {
  const position = getManualBoundaryPosition(manual);
  if (!position) return true;
  const projected = projectManualBoundaryRect(rect, manual!.boundary.rotation!);
  return projected.y + projected.height <= position.base
    && (position.left === null || projected.x >= position.left)
    && (position.right === null || projected.x + projected.width <= position.right);
}
