import type { BlueprintPlannerManualLayout } from "@/domain/blueprint-planner";
import type { GridRotation } from "@/domain/shared/grid";
import type { SceneBounds } from "@/domain/shared/scene-space";
import { rotateManualPoint } from "./manual-layout-transform";

export function getManualBoundaryPosition(manual: BlueprintPlannerManualLayout | undefined) {
  return manual?.enabled && manual.orientation === "fixed"
    ? manual.boundary.position ?? undefined : undefined;
}

/** 相对模式没有定位前提；绝对模式必须固定整体朝向并选择四向底边。 */
// AI-CORRECTION 2026-11-21：布局底边固定南向，定位仅要求固定设备组朝向，不再要求选择四向。
export function hasManualBoundaryPositionPrerequisites(manual: BlueprintPlannerManualLayout | undefined): boolean {
  if (!manual?.enabled || manual.boundary.position === null || manual.boundary.position === undefined) return true;
  return manual.orientation === "fixed";
}

/** 执行入口必须拒绝不完整绝对模式；草稿几何查询仍允许前两步编辑和修正。 */
export function assertManualBoundaryPositionReady(manual: BlueprintPlannerManualLayout | undefined): void {
  if (!manual?.enabled) return;
  const position = manual.boundary.position;
  if (position === null || position === undefined) return;
  if (!hasManualBoundaryPositionPrerequisites(manual)) {
    throw new Error("按边界定位要求固定设备组朝向。");
  }
  if (position.base !== null && !Number.isSafeInteger(position.base)
    || position.top != null && !Number.isSafeInteger(position.top)
    || position.left !== null && !Number.isSafeInteger(position.left)
    || position.right !== null && !Number.isSafeInteger(position.right)) throw new Error("人工边界位置必须为安全整数格线。");
  if (position.top != null && position.base !== null && (!Number.isSafeInteger(position.base - position.top) || position.base <= position.top)) throw new Error("固定纵轴必须形成正高度。");
  if (position.left !== null && position.right !== null
    && (!Number.isSafeInteger(position.right - position.left) || position.right <= position.left)) {
    throw new Error("固定双侧必须按左、右顺序形成正宽度。");
  }
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

export function manualBoundarySceneBounds(manual: BlueprintPlannerManualLayout | undefined, exactBaseLength?: number, exactSideLength?: number): SceneBounds {
  const position = getManualBoundaryPosition(manual);
  if (!position || position.base !== null && !Number.isSafeInteger(position.base)
    || position.top != null && !Number.isSafeInteger(position.top)
    || position.left !== null && !Number.isSafeInteger(position.left)
    || position.right !== null && !Number.isSafeInteger(position.right)
    || position.left !== null && position.right !== null && position.left >= position.right
    || position.top != null && position.base !== null && position.top >= position.base) return { minX: null, minY: null, maxX: null, maxY: null };
  let base = position.base;
  let { left, right } = position;
  if (Number.isSafeInteger(exactBaseLength) && exactBaseLength! > 0) {
    if (left !== null && right === null && Number.isSafeInteger(left + exactBaseLength!)) right = left + exactBaseLength!;
    else if (right !== null && left === null && Number.isSafeInteger(right - exactBaseLength!)) left = right - exactBaseLength!;
  }
  let top = position.top ?? null;
  if (Number.isSafeInteger(exactSideLength) && exactSideLength! > 0) {
    if (base !== null && top === null && Number.isSafeInteger(base - exactSideLength!)) top = base - exactSideLength!;
    else if (top !== null && base === null && Number.isSafeInteger(top + exactSideLength!)) base = top + exactSideLength!;
  }
  const negate = (value: number | null) => value === null ? null : -value;
  switch (manual!.boundary.rotation) {
    case 90: return { minX: negate(base), maxX: negate(top), minY: left, maxY: right };
    case 180: return { minX: negate(right), maxX: negate(left), minY: negate(base), maxY: negate(top) };
    case 270: return { minX: top, maxX: base, minY: negate(right), maxY: negate(left) };
    default: return { minX: left, maxX: right, minY: top, maxY: base };
  }
}

export function isRectWithinManualBoundary(rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  manual: BlueprintPlannerManualLayout | undefined, exactSideLength?: number, exactBaseLength?: number): boolean {
  const position = getManualBoundaryPosition(manual);
  if (!position) return true;
  const projected = projectManualBoundaryRect(rect, manual!.boundary.rotation ?? 0);
  return (position.base === null || projected.y + projected.height <= position.base)
    && (position.top == null || projected.y >= position.top)
    && (exactSideLength === undefined || position.base === null || projected.y >= position.base - exactSideLength)
    && (exactSideLength === undefined || position.top == null || projected.y + projected.height <= position.top + exactSideLength)
    && (position.left === null || projected.x >= position.left)
    && (position.right === null || projected.x + projected.width <= position.right)
    && (exactBaseLength === undefined || position.left === null || projected.x + projected.width <= position.left + exactBaseLength)
    && (exactBaseLength === undefined || position.right === null || projected.x >= position.right - exactBaseLength);
}
