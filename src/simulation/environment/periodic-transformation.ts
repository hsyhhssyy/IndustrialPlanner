import type { FormationEffect } from "@/domain/registry/types/periodic-range-conversion";
import type { GridRect } from "@/domain/shared/grid";
import { resolvePeriodicRangeLayerState } from "@/shared/periodic-range-conversion";
import type { RecipeRandomSource } from "../recipe-selection";

export type BeltCell = readonly string[];
export type TransformSlot = (slotId: string, convert: (original: string) => string) => boolean;
export type ReadProjection = () => "ming" | "hui" | undefined;
export type RegionSettlement = (
  effect: FormationEffect, layers: number, cells: readonly BeltCell[], random: RecipeRandomSource, transform: TransformSlot,
) => void;

export interface TransformationRegion {
  readonly regionId: string;
  readonly formationId: string;
  readonly gridRect: GridRect;
  readonly sourceDeviceId: string;
  readonly sources: readonly ReadProjection[];
  readonly cells: readonly BeltCell[];
  readonly period: number;
  readonly settleItems: RegionSettlement;
}

function readLayers(region: TransformationRegion) {
  let ming = 0;
  let hui = 0;
  for (const read of region.sources) {
    const side = read();
    if (side === "ming") ming++;
    if (side === "hui") hui++;
  }
  return resolvePeriodicRangeLayerState(ming, hui);
}

/** 世界时刻使用两引擎的共同整数时基。只为不同的周期分组，区域本身没有时钟。 */
export class PeriodicEnvironmentTransformation {
  private readonly byPeriod = new Map<number, TransformationRegion[]>();
  public nextBoundary = Infinity;

  public constructor(
    private readonly regions: readonly TransformationRegion[],
    private readonly random: RecipeRandomSource,
    private readonly transformSlot: TransformSlot,
  ) {
    for (const region of regions) {
      if (!Number.isSafeInteger(region.period) || region.period <= 0) throw new Error("Invalid formation period.");
      const group = this.byPeriod.get(region.period);
      if (group) group.push(region);
      else this.byPeriod.set(region.period, [region]);
    }
    this.seek(0);
  }

  /** 从已提交的世界时刻恢复，严格移到下一边界。 */
  public seek(time: number): void {
    let next = Infinity;
    for (const period of this.byPeriod.keys()) next = Math.min(next, time - time % period + period);
    this.nextBoundary = next;
  }

  public settle(time: number): void {
    while (this.nextBoundary <= time) {
      const due = this.nextBoundary;
      for (const [period, regions] of this.byPeriod) {
        if (due % period !== 0) continue;
        for (const region of regions) {
          const { effect, layers } = readLayers(region);
          if (effect) region.settleItems(effect, layers, region.cells, this.random, this.transformSlot);
        }
      }
      this.seek(due);
    }
  }

  /** 只读取当前运行态；不触发结算，也不扫描槽位。 */
  public snapshots(time: number) {
    return this.regions.map(region => {
      const { effect, layers } = readLayers(region);
      return {
        regionId: region.regionId, formationId: region.formationId, gridRect: region.gridRect,
        sourceDeviceId: region.sourceDeviceId, effect, layers,
        progressTimeUnits: time % region.period, periodTimeUnits: region.period, active: effect !== null,
      };
    });
  }
}

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 区域钟只触发已绑定行为，按当前阵型、原料和层数结算。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: simulation/environment/formation-transfer.ts 与 compile-periodic-environment.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//   resolvePeriodicRangeLayerProbability,
//
// type RegionEffect = SourceEffect | "heng";
//
//   readonly programSignature: string;
//
//   readonly probability: number | null;
//
// interface TransformationProgram<ItemId> {
//
//   /** 下标 0 表示一层效果。 */
//   readonly probabilities: Readonly<Record<RegionEffect, readonly number[]>>;
//   readonly conversions: Readonly<Record<RegionEffect, ReadonlyMap<ItemId, ItemId>>>;
//   /** 网络程序以最后一层概率覆盖更高层数。 */
//   readonly saturateLayerProbability?: boolean;
//
// interface TransformationRegionDefinition<SourceId, RegionId, SlotId, ItemId> extends TransformationProgram<ItemId> {
//
//   readonly programSignature: string;
//
// interface TransformationRegion<SourceId, RegionId, SlotId, ItemId> extends TransformationProgram<ItemId> {
//
//   readonly programSignature: string;
//
//     const { regionId, programSignature, gridRect, sourceIds, sourceDeviceIds, slotIds,
//       periodMs, probabilities, conversions, saturateLayerProbability } = definition;
//
//       programSignature,
//
//       probabilities,
//       conversions,
//       saturateLayerProbability,
//
//       const effect = state.effect;
//       const layers = state.layers;
//       const probabilities = region.probabilities[effect];
//       const probability = resolvePeriodicRangeLayerProbability(
//         probabilities, layers, region.saturateLayerProbability);
//       if (probability === undefined || !Number.isFinite(probability) || probability < 0 || probability > 1) {
//         throw new Error("Invalid transformation probability for the active layer count.");
//       }
//       const conversions = region.conversions[effect];
//       if (probability > 0 && conversions.size > 0) {
//         const transformItem = (itemId: ItemId): ItemId => {
//           const target = conversions.get(itemId);
//           if (target === undefined) return itemId;
//           return probability === 1 || this.random.next() < probability ? target : itemId;
//         };
//         for (const slotId of region.slotIds) this.transformSlot(slotId, transformItem);
//       }
//
//       const probability = state.effect === null
//         ? null
//         : resolvePeriodicRangeLayerProbability(
//             region.probabilities[state.effect], state.layers, region.saturateLayerProbability) ?? null;
//
//         programSignature: region.programSignature,
//
//         probability,
