import { warehouseStorageCounts, type PlannerWarehousePortProfile } from "./warehouse-port-schedule";
import { PLANNER_MAX_SIDE, breadthOutlines, type PlannerOutline } from "./search-outline";
import { plannerAttemptBudget } from "./search-policy";
import type { PlannerUnitCatalog } from "./search-unit";

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
  readonly units?: PlannerUnitCatalog;
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
// AI-CORRECTION 2026-11-05：自由外框只保留不能在原面积上限内继续扩张的矩形；整边模式仍由指定口数和边决定。
// AI-CORRECTION 2026-11-05：撤回上述裁剪；完整尺寸集合仍承担分片并发和轮转，未经调度改造不能直接删减。
// AI-CORRECTION 2026-11-05：本轮联合分片以“外框 + 单元游标序列”唯一归属；不足 32 个外框时以不同单元补足并发。
export function partitionPlannerDimensions(targetArea: number, minimum: PlannerOutline, warehousePorts?: PlannerWarehousePortProfile,
  inclusive = false, boundaryLength = 0): PlannerDimension[][] {
  if (!Number.isSafeInteger(targetArea) || targetArea <= 0
    || ![minimum.width, minimum.height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("尺寸分片的面积基准或最小边长无效。");
  }
  const maximumArea = targetArea - Number(!inclusive);
  if (!Number.isSafeInteger(boundaryLength) || boundaryLength < 0) throw new Error("边界入口长度无效。");
  let dimensions: PlannerDimension[] = breadthOutlines(maximumArea, minimum)
    .filter(({ width, height }) => Math.max(width, height) >= boundaryLength
      && (width === PLANNER_MAX_SIDE || (width + 1) * height > maximumArea)).map(({ width, height }) => ({
    width, height, area: width * height, weight: Math.min(1, 2 * Math.min(width, height) / Math.max(width, height)),
  })).sort((a, b) => b.weight - a.weight || a.width - b.width || a.height - b.height);
  // AI-REMOVED 2026-11-05:
  // Reason: 直接裁剪尺寸会减少可并行领取的分片，破坏全局重调度契约。
  // Trigger: 八项首解优化的第一轮实验被基础回归否定。
  // Evidence: normal 4982 项通过、global-rescheduling.test.ts 4 项失败；CPU/GPU 预期 3 通道实际 2。
  // Replacement: 上方完整整数尺寸枚举；后续独立实验在 candidate.ts 启用已有约束修复。
  // Risk: 被包含尺寸的预算浪费仍未解决；不改变初始面积。Human Review: Required
  // Original code:
  // .filter((dimension, _index, frontier) => !frontier.some(other => other.width >= dimension.width
  //   && other.height >= dimension.height && other.area > dimension.area))
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
  // 外框较少时分开其搜索单元；保留原面积和每单元额度，不用更小外框凑并发。
  const owners = dimensions.map(() => 1);
  for (const shard of shards) {
    if (shard.length || !dimensions.length) continue;
    let selected = 0;
    for (let index = 1; index < dimensions.length; index++) {
      if (owners[index]! / dimensions[index]!.weight < owners[selected]! / dimensions[selected]!.weight) selected = index;
    }
    shard.push({ ...dimensions[selected]! });
    owners[selected]!++;
  }
  return shards;
}

/** 同一外框的分片持有互不相交的单元序列；只由已保存的分配和本地游标推导。 */
export function plannerDimensionUnitCursor(shards: readonly { readonly dimensions?: readonly PlannerDimension[] }[],
  shardIndex: number, dimension: PlannerDimension, cursor: number): number {
  const owners = shards.flatMap((shard, index) => shard.dimensions?.some(value => value.width === dimension.width
    && value.height === dimension.height && value.warehouseSide === dimension.warehouseSide
    && value.storageCount === dimension.storageCount) ? [index] : []);
  const offset = owners.indexOf(shardIndex);
  const combined = cursor * owners.length + offset;
  if (offset < 0 || !Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(combined)) {
    throw new Error("尺寸搜索单元的分片归属或游标无效。");
  }
  return combined;
}

/** 恢复必须接受同一分配与顺序，拒绝复制尺寸、遗漏尺寸、篡改权重或越界游标。 */
// AI-CORRECTION 2026-11-05：仅允许联合分片计划生成的重复外框；额外复制仍须拒绝，单元序列由固定归属推导。
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

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 fc7ed212fed08550759acde68de4fab45bb214eac79c6925d8b8f65ef57f7bc4。
// Replacement: src/blueprint-planner/dimension-schedule.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/dimension-schedule.ts):
// import { warehouseStorageCounts, type PlannerWarehousePortProfile } from "./warehouse-port-schedule";
// import { PLANNER_MAX_SIDE, breadthOutlines, type PlannerOutline } from "./search-outline";
// import { plannerAttemptBudget } from "./search-policy";
//
// export const PLANNER_SHARD_COUNT = 32;
// /** AI 决策：单次领取的默认尝试上限；权重只用于分组，不分割本次额度。 */
// export const PLANNER_DIMENSION_ATTEMPTS = 5_000;
//
// export interface PlannerDimension extends PlannerOutline {
//   readonly storageCount?: number;
//   readonly warehouseSide?: number;
//   readonly area: number;
//   readonly weight: number;
// }
//
// export interface PlannerDimensionSchedule {
//   readonly deviceArea?: number;
//   /** 首解可独立重复的生产份数；按子网形状分配尺寸，不改变总面积上限。 */
//   // AI-CORRECTION 2026-10-18：续搜的 repeatedSchedule 也使用此份数，独立于整网调度。
//   readonly repeatedUnits?: number;
//   /** 初始化设备清单确认可独立组合的份数，供取得首解后的第二套尺寸调度使用。 */
//   readonly continuationRepeatedUnits?: number;
//   readonly inclusive?: boolean;
//   readonly boundaryLength?: number;
//   readonly warehousePorts?: PlannerWarehousePortProfile;
//   readonly generation: number;
//   readonly targetArea: number;
//   readonly minimum: PlannerOutline;
//   readonly attemptsPerTask: number;
// }
//
// /** 用户设计：面积前沿、正权重、唯一归属；整体旋转等价尚未证明，保留两个方向。 */
// // 订正 2026-10-11：整边模式仅枚举可行口数对应的四个指定边，权重统一为一。
// export function partitionPlannerDimensions(targetArea: number, minimum: PlannerOutline, warehousePorts?: PlannerWarehousePortProfile,
//   inclusive = false, boundaryLength = 0, repeatedUnits = 1): PlannerDimension[][] {
//   if (!Number.isSafeInteger(targetArea) || targetArea <= 0
//     || ![minimum.width, minimum.height].every(value => Number.isSafeInteger(value) && value > 0)) {
//     throw new Error("尺寸分片的面积基准或最小边长无效。");
//   }
//   const maximumArea = targetArea - Number(!inclusive);
//   // 2026-10-21：同面积改善与严格缩面积都要可达；整数整除时两条面积前沿不同。
//   const frontiers = inclusive ? [maximumArea, maximumArea - 1] : [maximumArea];
//   if (!Number.isSafeInteger(boundaryLength) || boundaryLength < 0) throw new Error("边界入口长度无效。");
//   if (!Number.isSafeInteger(repeatedUnits) || repeatedUnits < 1 || repeatedUnits > 4900) throw new Error("生产子网份数无效。");
//   const weight = (width: number, height: number) => repeatedUnits === 1 ? Math.min(1, 2 * Math.min(width, height) / Math.max(width, height))
//     : Math.max(0.001, ...Array.from({ length: repeatedUnits }, (_, index) => index + 1)
//     .filter(rows => repeatedUnits % rows === 0).map(rows => {
//       const unitWidth = Math.floor(width / (repeatedUnits / rows)), unitHeight = Math.floor(height / rows);
//       return unitWidth && unitHeight ? Math.min(1, 2 * Math.min(unitWidth, unitHeight) / Math.max(unitWidth, unitHeight))
//         * unitWidth * unitHeight * repeatedUnits / maximumArea : 0;
//     }));
//   let dimensions: PlannerDimension[] = frontiers.flatMap(area => breadthOutlines(area, minimum))
//     .filter(({ width, height }) => Math.max(width, height) >= boundaryLength).map(({ width, height }) => ({
//     width, height, area: width * height, weight: weight(width, height),
//   // 2026-10-16：相同形状权重优先领取接近面积上限的外框，避免首轮先跑被 70 格截短的小面积。
//   })).sort((a, b) => b.weight - a.weight || b.area - a.area || a.width - b.width || a.height - b.height);
//   if (warehousePorts) {
//     if (![warehousePorts.pickupLength, warehousePorts.fixedStorageCount].every(value => Number.isSafeInteger(value) && value >= 0)
//       || !Number.isSafeInteger(warehousePorts.storageLength) || warehousePorts.storageLength <= 0
//       || !Array.isArray(warehousePorts.automatic) || warehousePorts.automatic.length > 1000
//       || new Set(warehousePorts.automatic.map(entry => entry.itemId)).size !== warehousePorts.automatic.length
//       || warehousePorts.automatic.some(entry => typeof entry.itemId !== "string" || !entry.itemId
//         || !Number.isSafeInteger(entry.count) || entry.count <= 0)) throw new Error("仓库口尺寸配置无效。");
//     dimensions = frontiers.flatMap(area => warehouseStorageCounts(warehousePorts).flatMap(storageCount => {
//       const length = warehousePorts.pickupLength + storageCount * warehousePorts.storageLength;
//       if (length <= 0 || length > PLANNER_MAX_SIDE) return [];
//       const depth = Math.min(PLANNER_MAX_SIDE, Math.floor(area / length));
//       return [0, 1, 2, 3].flatMap(warehouseSide => {
//         const width = warehouseSide % 2 === 0 ? length : depth;
//         const height = warehouseSide % 2 === 0 ? depth : length;
//         return width >= minimum.width && height >= minimum.height
//           ? [{ width, height, area: width * height, weight: 1, storageCount, warehouseSide }] : [];
//       });
//     }));
//   }
//   // 两个前沿大多重合；统一去重后仍保证每个带边界配置的尺寸只有一个归属。
//   dimensions = [...new Map(dimensions.map(dimension => [
//     `${dimension.width}/${dimension.height}/${dimension.warehouseSide ?? "any"}/${dimension.storageCount ?? "any"}`, dimension,
//   ])).values()];
//   const shards = Array.from({ length: PLANNER_SHARD_COUNT }, () => [] as PlannerDimension[]);
//   const weights = shards.map(() => 0);
//   for (const dimension of dimensions) {
//     let index = 0;
//     for (let next = 1; next < shards.length; next++) if (weights[next]! < weights[index]!) index = next;
//     shards[index]!.push(dimension);
//     weights[index]! += dimension.weight;
//   }
//   return shards;
// }
//
// /** 恢复必须接受同一分配与顺序，拒绝复制尺寸、遗漏尺寸、篡改权重或越界游标。 */
// export function assertPlannerDimensionSchedule(schedule: PlannerDimensionSchedule,
//   shards: readonly { readonly dimensions?: readonly PlannerDimension[]; readonly dimensionCursor?: number }[]): void {
//   if (!schedule || !Number.isSafeInteger(schedule.generation) || schedule.generation < 0
//     || schedule.attemptsPerTask !== (schedule.deviceArea === undefined ? PLANNER_DIMENSION_ATTEMPTS : plannerAttemptBudget(schedule.deviceArea, schedule.repeatedUnits))
//     || schedule.inclusive !== undefined && typeof schedule.inclusive !== "boolean"
//     || !schedule.minimum || shards.length !== PLANNER_SHARD_COUNT) {
//     throw new Error("尺寸调度检查点无效。");
//   }
//   if (schedule.continuationRepeatedUnits !== undefined && (!Number.isSafeInteger(schedule.continuationRepeatedUnits)
//     || schedule.continuationRepeatedUnits < 2 || schedule.continuationRepeatedUnits > 4900)) throw new Error("续搜子网份数无效。");
//   const expected = partitionPlannerDimensions(schedule.targetArea, schedule.minimum, schedule.warehousePorts,
//     schedule.inclusive, schedule.boundaryLength, schedule.repeatedUnits);
//   for (const [index, shard] of shards.entries()) {
//     const list = shard.dimensions;
//     if (!Array.isArray(list) || list.length !== expected[index]!.length
//       || !Number.isSafeInteger(shard.dimensionCursor) || shard.dimensionCursor! < 0
//       || shard.dimensionCursor! >= Math.max(1, list.length)
//       || list.some((value, position) => {
//         const wanted = expected[index]![position]!;
//         return !value || value.width !== wanted.width || value.height !== wanted.height
//           || value.area !== wanted.area || value.weight !== wanted.weight
//           || value.storageCount !== wanted.storageCount || value.warehouseSide !== wanted.warehouseSide;
//       })) throw new Error("分片尺寸、权重或轮转游标无效。");
//   }
// }
//
