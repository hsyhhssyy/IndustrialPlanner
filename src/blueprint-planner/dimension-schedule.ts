import { warehouseStorageCounts, type PlannerWarehousePortProfile } from "./warehouse-port-schedule";
import { PLANNER_MAX_SIDE, breadthOutlines, type PlannerOutline } from "./search-outline";
import { plannerAttemptBudget } from "./search-policy";

export const PLANNER_SHARD_COUNT = 32;
/** AI 决策：单次领取的默认尝试上限；权重只用于分组，不分割本次额度。 */
export const PLANNER_DIMENSION_ATTEMPTS = 5_000;

export interface PlannerDimension extends PlannerOutline {
  readonly storageCount?: number;
  readonly warehouseSide?: number;
  readonly area: number;
  readonly weight: number;
}

export interface PlannerDimensionSchedule {
  readonly deviceArea?: number;
  readonly inclusive?: boolean;
  readonly boundaryLength?: number;
  readonly warehousePorts?: PlannerWarehousePortProfile;
  readonly generation: number;
  readonly targetArea: number;
  readonly minimum: PlannerOutline;
  readonly attemptsPerTask: number;
}

/** 用户设计：面积前沿、正权重、唯一归属；整体旋转等价尚未证明，保留两个方向。 */
// 订正 2026-10-11：整边模式仅枚举可行口数对应的四个指定边，权重统一为一。
export function partitionPlannerDimensions(targetArea: number, minimum: PlannerOutline, warehousePorts?: PlannerWarehousePortProfile,
  inclusive = false, boundaryLength = 0): PlannerDimension[][] {
  if (!Number.isSafeInteger(targetArea) || targetArea <= 0
    || ![minimum.width, minimum.height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("尺寸分片的面积基准或最小边长无效。");
  }
  const maximumArea = targetArea - Number(!inclusive);
  if (!Number.isSafeInteger(boundaryLength) || boundaryLength < 0) throw new Error("边界入口长度无效。");
  let dimensions: PlannerDimension[] = breadthOutlines(maximumArea, minimum)
    .filter(({ width, height }) => Math.max(width, height) >= boundaryLength).map(({ width, height }) => ({
    width, height, area: width * height, weight: Math.min(1, 2 * Math.min(width, height) / Math.max(width, height)),
  })).sort((a, b) => b.weight - a.weight || a.width - b.width || a.height - b.height);
  if (warehousePorts) {
    if (![warehousePorts.pickupLength, warehousePorts.fixedStorageCount].every(value => Number.isSafeInteger(value) && value >= 0)
      || !Number.isSafeInteger(warehousePorts.storageLength) || warehousePorts.storageLength <= 0
      || !Array.isArray(warehousePorts.automatic) || warehousePorts.automatic.length > 1000
      || new Set(warehousePorts.automatic.map(entry => entry.itemId)).size !== warehousePorts.automatic.length
      || warehousePorts.automatic.some(entry => typeof entry.itemId !== "string" || !entry.itemId
        || !Number.isSafeInteger(entry.count) || entry.count <= 0)) throw new Error("仓库口尺寸配置无效。");
    dimensions = warehouseStorageCounts(warehousePorts).flatMap(storageCount => {
      const length = warehousePorts.pickupLength + storageCount * warehousePorts.storageLength;
      if (length <= 0 || length > PLANNER_MAX_SIDE) return [];
      const depth = Math.min(PLANNER_MAX_SIDE, Math.floor(maximumArea / length));
      return [0, 1, 2, 3].flatMap(warehouseSide => {
        const width = warehouseSide % 2 === 0 ? length : depth;
        const height = warehouseSide % 2 === 0 ? depth : length;
        return width >= minimum.width && height >= minimum.height
          ? [{ width, height, area: width * height, weight: 1, storageCount, warehouseSide }] : [];
      });
    });
  }
  const shards = Array.from({ length: PLANNER_SHARD_COUNT }, () => [] as PlannerDimension[]);
  const weights = shards.map(() => 0);
  for (const dimension of dimensions) {
    let index = 0;
    for (let next = 1; next < shards.length; next++) if (weights[next]! < weights[index]!) index = next;
    shards[index]!.push(dimension);
    weights[index]! += dimension.weight;
  }
  return shards;
}

/** 恢复必须接受同一分配与顺序，拒绝复制尺寸、遗漏尺寸、篡改权重或越界游标。 */
export function assertPlannerDimensionSchedule(schedule: PlannerDimensionSchedule,
  shards: readonly { readonly dimensions?: readonly PlannerDimension[]; readonly dimensionCursor?: number }[]): void {
  if (!schedule || !Number.isSafeInteger(schedule.generation) || schedule.generation < 0
    || schedule.attemptsPerTask !== (schedule.deviceArea === undefined ? PLANNER_DIMENSION_ATTEMPTS : plannerAttemptBudget(schedule.deviceArea))
    || schedule.inclusive !== undefined && typeof schedule.inclusive !== "boolean"
    || !schedule.minimum || shards.length !== PLANNER_SHARD_COUNT) {
    throw new Error("尺寸调度检查点无效。");
  }
  const expected = partitionPlannerDimensions(schedule.targetArea, schedule.minimum, schedule.warehousePorts,
    schedule.inclusive, schedule.boundaryLength);
  for (const [index, shard] of shards.entries()) {
    const list = shard.dimensions;
    if (!Array.isArray(list) || list.length !== expected[index]!.length
      || !Number.isSafeInteger(shard.dimensionCursor) || shard.dimensionCursor! < 0
      || shard.dimensionCursor! >= Math.max(1, list.length)
      || list.some((value, position) => {
        const wanted = expected[index]![position]!;
        return !value || value.width !== wanted.width || value.height !== wanted.height
          || value.area !== wanted.area || value.weight !== wanted.weight
          || value.storageCount !== wanted.storageCount || value.warehouseSide !== wanted.warehouseSide;
      })) throw new Error("分片尺寸、权重或轮转游标无效。");
  }
}
