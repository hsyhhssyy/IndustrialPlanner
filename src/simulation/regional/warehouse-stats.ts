import type {
  CompiledRegionalResourceSupply,
  RuntimeTickSnapshot,
  WarehouseStats,
} from "../types";

export function aggregateRegionalWarehouseStats(options: {
  readonly baseSnapshots: readonly RuntimeTickSnapshot[];
  readonly authorityCounts: Readonly<Record<string, number>>;
  readonly supply: CompiledRegionalResourceSupply | undefined;
}): WarehouseStats {
  const items: Record<string, {
    producedPerMinute: number;
    consumedPerMinute: number;
    warehouseCount: number;
    infinite: boolean;
    lastChangedTick: number;
  }> = {};

  for (const snapshot of options.baseSnapshots) {
    if (snapshot.warehouseStats === null) continue;
    for (const [itemType, stats] of Object.entries(snapshot.warehouseStats.items)) {
      const target = items[itemType] ??= {
        producedPerMinute: 0,
        consumedPerMinute: 0,
        warehouseCount: 0,
        infinite: false,
        lastChangedTick: 0,
      };
      target.producedPerMinute += stats.producedPerMinute;
      target.consumedPerMinute += stats.consumedPerMinute;
      target.infinite ||= stats.infinite;
      target.lastChangedTick = Math.max(target.lastChangedTick, stats.lastChangedTick);
    }
  }
  for (const [itemType, count] of Object.entries(options.authorityCounts)) {
    if (count <= 0) continue;
    const target = items[itemType] ??= {
      producedPerMinute: 0,
      consumedPerMinute: 0,
      warehouseCount: 0,
      infinite: false,
      lastChangedTick: 0,
    };
    target.warehouseCount = count;
  }
  for (const itemType of options.supply?.infiniteItemIds ?? []) {
    const target = items[itemType] ??= {
      producedPerMinute: 0,
      consumedPerMinute: 0,
      warehouseCount: 0,
      infinite: false,
      lastChangedTick: 0,
    };
    target.infinite = true;
  }
  for (const [itemType, perMinute] of Object.entries(
    options.supply?.finitePerMinuteByItemId ?? {},
  )) {
    const target = items[itemType] ??= {
      producedPerMinute: 0,
      consumedPerMinute: 0,
      warehouseCount: 0,
      infinite: false,
      lastChangedTick: 0,
    };
    target.producedPerMinute += perMinute;
  }
  return {
    items,
    statsWindowReady: options.baseSnapshots.every(
      (snapshot) => snapshot.warehouseStats?.statsWindowReady === true,
    ) && options.baseSnapshots.length > 0,
  };
}
