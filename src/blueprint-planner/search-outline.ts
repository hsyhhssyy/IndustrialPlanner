import { PlannerCandidateError } from "./model";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";

export interface PlannerOutline { readonly width: number; readonly height: number; }

export const PLANNER_MAX_SIDE = 70;

/** 所有生成与恢复入口共用边长限制；面积合法不能替代逐边校验。 */
export function assertPlannerOutline(outline: PlannerOutline): void {
  if (![outline.width, outline.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= PLANNER_MAX_SIDE)) {
    throw new PlannerCandidateError(`蓝图宽、高必须为 1～${PLANNER_MAX_SIDE} 格，当前为 ${outline.width}×${outline.height}。`);
  }
}

/** 初始目标为设备占地两倍；失败重启以有限尺度放大，整数盒子始终不超过 70×70。 */
export function initialPlannerOutline(bodyArea: number, minimum: PlannerOutline, variant: number): PlannerOutline {
  if (!Number.isSafeInteger(bodyArea) || bodyArea <= 0 || bodyArea > PLANNER_MAX_SIDE ** 2) {
    throw new PlannerCandidateError("设备总占地无法容纳在 70×70 的蓝图内。");
  }
  const scale = 1 + Math.floor(variant / 3) * 0.25;
  const area = Math.min(PLANNER_MAX_SIDE ** 2, Math.ceil(bodyArea * 2 * scale * scale));
  const shapes = breadthOutlines(area, minimum).filter(shape => shape.width * shape.height >= bodyArea);
  // 在相近长宽比中最大化目标面积利用率，不通过额外边距把两倍目标再次放大。
  const ratio = [1, 1.2, 1 / 1.2][variant % 3]!;
  shapes.sort((a, b) => Math.abs(Math.log(a.width / a.height / ratio)) - Math.abs(Math.log(b.width / b.height / ratio))
    || b.width * b.height - a.width * a.height);
  if (!shapes.length) throw new PlannerCandidateError("设备最小尺寸无法容纳在 70×70 的蓝图内。");
  return shapes[0]!;
}


/** 搜索盒子必须容纳固定设施，也至少容纳任一单体设备。 */
// AI-CORRECTION 2026-10-05：设施均可移动或换边；最小宽高仅取可旋转单体的必要下界，实际长边在布局验证。
export function fixedOutlineMinimum(registry: RegistryContract,
  nodes: readonly { readonly entity: WorldEntity; readonly purpose: string; readonly external?: boolean }[]): PlannerOutline {
  return nodes.reduce((bounds, node) => {
    const definition = registry.queries.findEntityDefinition(node.entity.definitionId);
    if (!definition) throw new Error(`续搜布局引用了不存在的设备：${node.entity.definitionId}`);
    const rect = resolveEntityGridRect({ entity: node.entity, definition });
// AI-REMOVED 2026-10-05:
// Reason: 存取线改为盒外边界，统一仓库口与外接入口布局。
// Trigger: 用户确认外部存取线、最多连续面数及外接传送带互斥规则。
// Evidence: 旧实现固定设施撑大包围盒并进入面积与导出。
// Replacement: fixedOutlineMinimum；边界口位在每个候选盒子重新安排。
// Risk: 旧搜索种子失效，按算法版本重置。
// Human Review: Required
// Original code:
//     const fixed = node.purpose === "bus" || node.external || node.entity.definitionId === "unloader_1"
//       || node.entity.definitionId === "loader_1";
//     return { width: Math.max(bounds.width, rect.width, fixed ? rect.x + rect.width : 1),
//       height: Math.max(bounds.height, rect.height, fixed ? rect.y + rect.height : 1) };
    const smaller = Math.min(rect.width, rect.height);
    return { width: Math.max(bounds.width, smaller), height: Math.max(bounds.height, smaller) };
  }, { width: 1, height: 1 });
}

/** 在面积边界上覆盖所有可行整数宽度；中点递归顺序让任意前缀分散于不同长宽比。 */
export function breadthOutlines(maximumArea: number, minimum: PlannerOutline, cap?: PlannerOutline): PlannerOutline[] {
  if (!Number.isSafeInteger(maximumArea) || maximumArea < 1) return [];
  const maxWidth = Math.min(PLANNER_MAX_SIDE, cap?.width ?? Infinity, Math.floor(maximumArea / minimum.height));
  const shapes: PlannerOutline[] = [];
  for (let width = minimum.width; width <= maxWidth; width++) {
    const height = Math.min(PLANNER_MAX_SIDE, cap?.height ?? Infinity, Math.floor(maximumArea / width));
    if (height >= minimum.height) shapes.push({ width, height });
  }
  const spread: PlannerOutline[] = [];
  const intervals: Array<readonly [number, number]> = [[0, shapes.length - 1]];
  for (let index = 0; index < intervals.length; index++) {
    const [start, end] = intervals[index]!;
    if (start > end) continue;
    const middle = Math.floor((start + end) / 2);
    spread.push(shapes[middle]!);
    intervals.push([start, middle - 1], [middle + 1, end]);
  }
  return spread;
}

export function breadthOutlineKey(mode: string, shape: PlannerOutline): string {
  return `${mode}/${shape.width}/${shape.height}`;
}

// AI-REMOVED 2026-10-10:
// Reason: 全局临时选尺寸及跨分片借用已被唯一归属替代，移除未使用的旧调度入口。
// Trigger: 用户要求固定尺寸唯一归属 32 分片、跨领取轮转和验收后统一切换。
// Evidence: 旧调度每次临时选尺寸，旧任务回写可能覆盖新游标。
// Replacement: dimension-schedule.ts partitionPlannerDimensions
// Risk: 调度顺序与历史任务恢复语义变化；由分片及 Host 回归覆盖。
// Human Review: Required
// Original code:
// /** 优先未占用、访问次数最少的尺寸；分片文件以稳定宽度模数减少跨客户端重复。 */
// // AI-CORRECTION 2026-10-10：主排序为已用与在途提案；相同预算才比较派发次数，避免早退变体锁死宽度。
// export function selectBreadthOutline(shapes: readonly PlannerOutline[], mode: string,
//   evaluations: (key: string) => number, occupied: ReadonlySet<string>, partition?: { readonly count: number; readonly index: number },
//   attempts?: (key: string) => number): PlannerOutline | undefined {
//   const assigned = partition ? shapes.filter(shape => shape.width % partition.count === partition.index) : shapes;
//   const available = (choices: readonly PlannerOutline[]) => choices.filter(shape => !occupied.has(breadthOutlineKey(mode, shape)));
//   const assignedFree = available(assigned);
//   const globalFree = assignedFree.length ? assignedFree : available(shapes);
//   const candidates = assignedFree.length ? assignedFree : globalFree.length ? globalFree : assigned.length ? assigned : shapes;
//   return candidates.reduce<PlannerOutline | undefined>((best, shape) => {
//     if (!best) return shape;
//     const key = breadthOutlineKey(mode, shape), bestKey = breadthOutlineKey(mode, best);
//     return evaluations(key) < evaluations(bestKey) || (evaluations(key) === evaluations(bestKey)
//       && (attempts?.(key) ?? 0) < (attempts?.(bestKey) ?? 0)) ? shape : best;
//   }, undefined);
// }
//
/** 停滞后枚举较小面积的整数长宽组合；允许一边增长，固定设施和显式边界始终是硬约束。 */
export function continuationOutline(seed: { width: number; height: number }, variant: number, step = 0,
  minimum = { width: 1, height: 1 }, cap?: { readonly width: number; readonly height: number }, maximumArea?: number) {
  if (maximumArea !== undefined && (!Number.isSafeInteger(maximumArea) || maximumArea < 1)) throw new Error("面积上限必须是正整数。");
  cap = { width: Math.min(PLANNER_MAX_SIDE, cap?.width ?? PLANNER_MAX_SIDE), height: Math.min(PLANNER_MAX_SIDE, cap?.height ?? PLANNER_MAX_SIDE) };
  const shrink = { width: Math.max(1, seed.width - (variant % 2 ? 1 : 0)),
    height: Math.max(1, seed.height - (variant % 2 ? 0 : 1)) };
  if (step >= 2 || (maximumArea !== undefined && (shrink.width * shrink.height > maximumArea
    || shrink.width < minimum.width || shrink.height < minimum.height)) || shrink.width > cap.width || shrink.height > cap.height) {
    const area = Math.min(seed.width * seed.height, (maximumArea ?? Infinity) + 1);
    const shapes = [{ width: seed.width - 1, height: seed.height }, { width: seed.width, height: seed.height - 1 }];
    for (let width = Math.max(1, Math.ceil(seed.width * 0.75)); width <= Math.floor(seed.width * 1.25); width++) {
      shapes.push({ width, height: Math.floor((area - 1) / width) });
    }
    // 2026-09-30：局部长宽窗口无解时仍检查固定设施可容纳的范围，不能回退到超面积盒子。
    if (maximumArea !== undefined && !shapes.some(shape => shape.width >= minimum.width && shape.height >= minimum.height
      && shape.width <= (cap?.width ?? Infinity) && shape.height <= (cap?.height ?? Infinity) && shape.width * shape.height < area)) {
      for (let width = minimum.width; width <= Math.min(cap?.width ?? Infinity, Math.floor((area - 1) / minimum.height)); width++) {
        shapes.push({ width, height: Math.min(cap?.height ?? Infinity, Math.floor((area - 1) / width)) });
      }
    }
    const unique = [...new Map(shapes.map(shape => [`${shape.width}/${shape.height}`, shape])).values()]
      .filter(shape => shape.width >= minimum.width && shape.height >= minimum.height
        && shape.width <= (cap?.width ?? Infinity) && shape.height <= (cap?.height ?? Infinity)
        && shape.width * shape.height < area)
      .sort((a, b) => b.width * b.height - a.width * a.height
        || Math.abs(a.width - seed.width) + Math.abs(a.height - seed.height)
          - Math.abs(b.width - seed.width) - Math.abs(b.height - seed.height)
        || a.width - b.width);
    if (unique.length) return unique[Math.max(0, step - 2) % unique.length]!;
  }
  const result = { width: Math.min(cap?.width ?? Infinity, shrink.width), height: Math.min(cap?.height ?? Infinity, shrink.height) };
  if ((maximumArea !== undefined && result.width * result.height > maximumArea) || result.width < minimum.width || result.height < minimum.height) {
    throw new PlannerCandidateError("本轮固定设施或显式边界无法容纳面积上限。");
  }
  return result;
}
