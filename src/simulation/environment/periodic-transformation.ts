import type { FormationEffect } from "@/domain/registry/types/periodic-range-conversion";
import type { GridRect } from "@/domain/shared/grid";
import {
  resolvePeriodicRangeLayerState,
  type PeriodicRangeEffect,
} from "@/shared/periodic-range-conversion";
import type { RecipeRandomSource } from "../recipe-selection";

export type RegionSettlement<SlotId, ItemId> = (
  effect: FormationEffect, layers: number, slots: ReadonlySet<SlotId>, random: RecipeRandomSource,
  transformSlot: (slot: SlotId, convert: (original: ItemId) => ItemId) => void,
) => void;

type SourceEffect = "ming" | "hui";

export interface PeriodicRegionRuntimeSnapshot<RegionId> {
  readonly regionId: RegionId;
  readonly formationId: string;
  readonly gridRect: GridRect;
  readonly sourceDeviceId: string;
  readonly effect: PeriodicRangeEffect | null;
  readonly layers: number;
  readonly progressTimeUnits: number;
  readonly periodTimeUnits: number;
  readonly active: boolean;
}

export interface PeriodicEnvironmentCheckpoint<SourceId, RegionId> {
  /** 历史字段名中的 Ms 仅表示调用方的时间坐标。引擎使用每秒 3000 整数单位。 */
  readonly sampledAtMs: number;
  readonly sources: readonly (readonly [SourceId, SourceEffect])[];
  readonly regions: readonly {
    readonly regionId: RegionId;
    readonly sourceIds: readonly SourceId[];
    readonly periodMs: number;
    readonly remainingMs: number;
    readonly active: boolean;
  }[];
}

interface TransformationProgram<SlotId, ItemId> {
  readonly periodMs: number;
  readonly settleItems: RegionSettlement<SlotId, ItemId>;
}

interface TransformationRegionDefinition<SourceId, RegionId, SlotId, ItemId> extends TransformationProgram<SlotId, ItemId> {
  readonly regionId: RegionId;
  readonly formationId: string;
  readonly gridRect: GridRect;
  readonly sourceIds: readonly SourceId[];
  readonly sourceDeviceIds: readonly string[];
  readonly slotIds: readonly SlotId[];
}

interface TransformationRegion<SourceId, RegionId, SlotId, ItemId> extends TransformationProgram<SlotId, ItemId> {
  readonly regionId: RegionId;
  readonly formationId: string;
  readonly gridRect: GridRect;
  readonly sourceIds: ReadonlySet<SourceId>;
  readonly sourceDeviceIds: readonly string[];
  readonly slotIds: ReadonlySet<SlotId>;
  readonly layers: Record<SourceEffect, number>;
  remainingMs: number;
  dueAtMs: number | null;
}

/**
 * 调用方提供已合并的有效区域、规范化物理槽位及整数仿真时间。
 * 参数名中的 Ms 不指定单位。双引擎使用每秒 3000 整数单位，整个运行时及检查点必须使用同一时基。
 * 每个结算点先更新运行来源、提交物流，再调用 settle。每件当前归属物品只传给 transformItem 一次。
 */
export class PeriodicEnvironmentTransformation<SourceId, RegionId, SlotId, ItemId> {
  private readonly regions = new Map<RegionId, TransformationRegion<SourceId, RegionId, SlotId, ItemId>>();
  private readonly regionsBySource = new Map<SourceId, Set<RegionId>>();
  private readonly sourceEffects = new Map<SourceId, SourceEffect>();
  private readonly dueRegions = new Map<number, Set<RegionId>>();
  private nextDueAtMs: number | undefined | null;
  private lastTimeMs = 0;
  private checkpointCache: PeriodicEnvironmentCheckpoint<SourceId, RegionId> | undefined;

  public constructor(
    private readonly random: RecipeRandomSource,
    private readonly transformSlot: (slotId: SlotId, transformItem: (itemId: ItemId) => ItemId) => void,
    private readonly migrateCheckpoint?: (saved: PeriodicEnvironmentCheckpoint<SourceId, RegionId>) => PeriodicEnvironmentCheckpoint<SourceId, RegionId>,
  ) {}

  public addRegion(definition: TransformationRegionDefinition<SourceId, RegionId, SlotId, ItemId>, nowMs: number): void {
    const { regionId, formationId, gridRect, sourceIds, sourceDeviceIds, slotIds,
      periodMs, settleItems } = definition;
    if (this.regions.has(regionId)) throw new Error("Transformation region already exists.");
    if (!Number.isSafeInteger(periodMs) || periodMs <= 0) throw new Error("Invalid transformation period.");
    this.observeTime(nowMs);
    this.checkpointCache = undefined;
    const region: TransformationRegion<SourceId, RegionId, SlotId, ItemId> = {
      regionId,
      formationId,
      gridRect: { ...gridRect },
      sourceIds: new Set(sourceIds),
      sourceDeviceIds: [...sourceDeviceIds],
      slotIds: new Set(slotIds),
      periodMs,
      settleItems,
      layers: { ming: 0, hui: 0 },
      remainingMs: periodMs,
      dueAtMs: null,
    };
    this.regions.set(regionId, region);
    for (const sourceId of region.sourceIds) {
      const effect = this.sourceEffects.get(sourceId);
      if (effect !== undefined) region.layers[effect] += 1;
      let linked = this.regionsBySource.get(sourceId);
      if (linked === undefined) {
        linked = new Set();
        this.regionsBySource.set(sourceId, linked);
      }
      linked.add(regionId);
    }
    if (region.layers.ming + region.layers.hui > 0) this.schedule(regionId, region, nowMs + periodMs);
  }

  public removeRegion(regionId: RegionId): void {
    const region = this.regions.get(regionId);
    if (region === undefined) return;
    this.checkpointCache = undefined;
    this.unschedule(regionId, region);
    for (const sourceId of region.sourceIds) {
      const linked = this.regionsBySource.get(sourceId)!;
      linked.delete(regionId);
      if (linked.size === 0) this.regionsBySource.delete(sourceId);
    }
    this.regions.delete(regionId);
  }

  /** 停工、失效和拆除来源时传入 null。双区域来源的一次状态变化会同步更新两侧。 */
  public setSourceEffect(sourceId: SourceId, effect: SourceEffect | null, nowMs: number): void {
    this.observeTime(nowMs);
    const previous = this.sourceEffects.get(sourceId);
    if ((previous ?? null) === effect) return;
    this.checkpointCache = undefined;
    if (effect === null) this.sourceEffects.delete(sourceId);
    else this.sourceEffects.set(sourceId, effect);

    const linked = this.regionsBySource.get(sourceId);
    if (linked === undefined) return;
    for (const regionId of linked) {
      const region = this.regions.get(regionId)!;
      if (previous !== undefined) region.layers[previous] -= 1;
      if (effect !== null) region.layers[effect] += 1;
      if (region.layers.ming + region.layers.hui > 0) {
        if (region.dueAtMs === null) this.schedule(regionId, region, nowMs + region.remainingMs);
      } else if (region.dueAtMs !== null) {
        region.remainingMs = region.dueAtMs - nowMs;
        this.unschedule(regionId, region);
      }
    }
  }

  /** 单次结算只处理当前到期桶，桶内按入队顺序执行。 */
  public settle(nowMs: number): void {
    this.observeTime(nowMs);
    const due = this.dueRegions.get(nowMs);
    if (due === undefined) return;
    this.checkpointCache = undefined;
    for (const regionId of due) {
      const region = this.regions.get(regionId)!;
      const state = resolvePeriodicRangeLayerState(region.layers.ming, region.layers.hui);
      if (state.effect === null) {
        this.unschedule(regionId, region);
        continue;
      }
      region.settleItems(state.effect, state.layers, region.slotIds, this.random, this.transformSlot);
      this.unschedule(regionId, region);
      this.schedule(regionId, region, nowMs + region.periodMs);
    }
  }

  public progress(regionId: RegionId, nowMs: number): number | undefined {
    const region = this.regions.get(regionId);
    if (region === undefined) return undefined;
    const remaining = region.dueAtMs === null ? region.remainingMs : region.dueAtMs - nowMs;
    return Math.max(0, Math.min(region.periodMs, region.periodMs - remaining));
  }

  /** 只读取当前运行态；不触发结算，也不扫描槽位。 */
  public snapshots(nowMs: number): readonly PeriodicRegionRuntimeSnapshot<RegionId>[] {
    this.observeTime(nowMs);
    return [...this.regions.values()].map(region => {
      const state = resolvePeriodicRangeLayerState(region.layers.ming, region.layers.hui);
      const remaining = region.dueAtMs === null ? region.remainingMs : region.dueAtMs - nowMs;
      return {
        regionId: region.regionId,
        formationId: region.formationId,
        gridRect: { ...region.gridRect },
        sourceDeviceId: region.sourceDeviceIds[0] ?? "",
        effect: state.effect,
        layers: state.layers,
        progressTimeUnits: Math.max(0, Math.min(region.periodMs, region.periodMs - remaining)),
        periodTimeUnits: region.periodMs,
        active: region.dueAtMs !== null,
      };
    });
  }

  public checkpoint(nowMs: number): PeriodicEnvironmentCheckpoint<SourceId, RegionId> {
    if (this.checkpointCache !== undefined) return this.checkpointCache;
    const activeRegions = [...this.dueRegions.values()].flatMap(due => [...due]);
    const pausedRegions = [...this.regions].filter(([, region]) => region.dueAtMs === null).map(([id]) => id);
    this.checkpointCache = {
      sampledAtMs: nowMs,
      sources: [...this.sourceEffects],
      regions: [...activeRegions, ...pausedRegions].map(regionId => {
        const region = this.regions.get(regionId)!;
        return {
          regionId,
          sourceIds: [...region.sourceIds],
          periodMs: region.periodMs,
          remainingMs: region.periodMs - this.progress(regionId, nowMs)!,
          active: region.dueAtMs !== null,
        };
      }),
    };
    return this.checkpointCache;
  }

  /** 仅延续相同程序、几何和至少一个原来源的区域，排序保留同一到期桶的抽样顺序。 */
  public restore(checkpoint: PeriodicEnvironmentCheckpoint<SourceId, RegionId> | undefined, nowMs: number): void {
    this.checkpointCache = undefined;
    if (checkpoint && this.migrateCheckpoint) checkpoint = this.migrateCheckpoint(checkpoint);
    this.lastTimeMs = nowMs;
    this.dueRegions.clear();
    this.nextDueAtMs = undefined;
    this.sourceEffects.clear();
    for (const [sourceId, effect] of checkpoint?.sources ?? []) {
      if (this.regionsBySource.has(sourceId)) this.sourceEffects.set(sourceId, effect);
    }
    for (const region of this.regions.values()) {
      region.layers.ming = 0;
      region.layers.hui = 0;
      region.dueAtMs = null;
      region.remainingMs = region.periodMs;
      for (const sourceId of region.sourceIds) {
        const effect = this.sourceEffects.get(sourceId);
        if (effect !== undefined) region.layers[effect] += 1;
      }
    }
    for (const saved of checkpoint?.regions ?? []) {
      const region = this.regions.get(saved.regionId);
      if (region === undefined || region.periodMs !== saved.periodMs
        || !saved.sourceIds.some(sourceId => region.sourceIds.has(sourceId))) continue;
      const elapsed = saved.active ? nowMs - checkpoint!.sampledAtMs : 0;
      region.remainingMs = Math.max(0, Math.min(region.periodMs, saved.remainingMs - elapsed));
      if (region.layers.ming + region.layers.hui > 0) {
        this.schedule(saved.regionId, region, nowMs + region.remainingMs);
      }
    }
    for (const [regionId, region] of this.regions) {
      if (region.dueAtMs === null && region.layers.ming + region.layers.hui > 0) {
        this.schedule(regionId, region, nowMs + region.remainingMs);
      }
    }
  }

  /** 交给引擎调度时，可直接定位下一个需要决算的仿真时间点。 */
  public nextDueTimeMs(): number | undefined {
    if (this.nextDueAtMs === null) {
      let earliest: number | undefined;
      for (const deadline of this.dueRegions.keys()) {
        if (earliest === undefined || deadline < earliest) earliest = deadline;
      }
      this.nextDueAtMs = earliest;
    }
    return this.nextDueAtMs;
  }

  private observeTime(nowMs: number): void {
    if (!Number.isSafeInteger(nowMs) || nowMs < this.lastTimeMs) {
      throw new Error("Invalid transformation simulation time.");
    }
    const earliest = this.nextDueTimeMs();
    if (earliest !== undefined && earliest < nowMs) throw new Error("Transformation settlement time was skipped.");
    this.lastTimeMs = nowMs;
  }

  private schedule(regionId: RegionId, region: TransformationRegion<SourceId, RegionId, SlotId, ItemId>, deadline: number): void {
    if (!Number.isSafeInteger(deadline)) throw new Error("Invalid transformation deadline.");
    let due = this.dueRegions.get(deadline);
    if (due === undefined) {
      due = new Set();
      this.dueRegions.set(deadline, due);
    }
    due.add(regionId);
    region.dueAtMs = deadline;
    if (this.nextDueAtMs === undefined || (this.nextDueAtMs !== null && deadline < this.nextDueAtMs)) {
      this.nextDueAtMs = deadline;
    }
  }

  private unschedule(regionId: RegionId, region: TransformationRegion<SourceId, RegionId, SlotId, ItemId>): void {
    const deadline = region.dueAtMs;
    if (deadline === null) return;
    const due = this.dueRegions.get(deadline)!;
    due.delete(regionId);
    if (due.size === 0) {
      this.dueRegions.delete(deadline);
      if (this.nextDueAtMs === deadline) this.nextDueAtMs = null;
    }
    region.dueAtMs = null;
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
