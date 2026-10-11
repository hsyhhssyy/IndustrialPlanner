import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";

export interface PlannerWarehouseRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 1 为取货口，2 为存货口。 */
  readonly kind: number;
  readonly side: number;
}

/** 共边才相邻；跨角仍使用实体矩形，不把角点或盒外存取线视为连接。 */
export function warehouseRectsAdjacent(a: PlannerWarehouseRect, b: PlannerWarehouseRect): boolean {
  return ((a.x + a.width === b.x || b.x + b.width === a.x)
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
    || ((a.y + a.height === b.y || b.y + b.height === a.y)
      && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x));
}

/** 断开的分量数提供修复梯度；两种连续方式取较小违约数。 */
export function warehousePortViolations(rects: readonly PlannerWarehouseRect[],
  rule: BlueprintPlannerOptions["warehousePortPlacement"], width: number, height: number, requiredSide = -1): number {
  if (rule === "any") return 0;
  const components = (kind: number) => {
    const labels = rects.map((rect, index) => kind === 0 || rect.kind === kind ? index : -1);
    let count = labels.filter(label => label >= 0).length;
    for (let i = 0; i < rects.length; i++) for (let j = 0; j < i; j++) {
      if (labels[i]! < 0 || labels[j]! < 0 || labels[i] === labels[j] || !warehouseRectsAdjacent(rects[i]!, rects[j]!)) continue;
      const previous = labels[i]!, next = labels[j]!;
      for (let k = 0; k < labels.length; k++) if (labels[k] === previous) labels[k] = next;
      count--;
    }
    return Math.max(0, count - 1);
  };
  if (rule === "continuous") return Math.min(components(0), components(1) + components(2));
  if (!rects.length) return 1;
  let best = Infinity;
  for (let side = 0; side < 4; side++) {
    if (requiredSide >= 0 && side !== requiredSide) continue;
    const horizontal = side % 2 === 0;
    const intervals = rects.filter(rect => rect.side === side).map(rect => ({
      start: horizontal ? rect.x : rect.y, end: horizontal ? rect.x + rect.width : rect.y + rect.height,
    })).sort((a, b) => a.start - b.start);
    let penalty = rects.length - intervals.length, end = 0;
    for (const interval of intervals) { penalty += Math.abs(interval.start - end); end = interval.end; }
    penalty += Math.abs((horizontal ? width : height) - end);
    best = Math.min(best, penalty);
  }
  return best;
}
