/**
 * 明晦炉与分影明晦炉的区域附属设备。
 *
 * 2026-11-25：区域设备只承载区域效果、配方归属与业务识别，不进入仿真设备集合；
 * 配方 machineId 指向区域设备，ownerDeviceId 指向实际执行它的炉子。
 */
export const MAGIC_SPAWNER_RANGE_DEVICE_IDS = {
  ming: "magic_spawner_range_ming",
  hui: "magic_spawner_range_hui",
  heng: "magic_spawner_range_heng",
} as const;

export const MAGIC_SPAWNER_FORMATION = {
  id: "stacked-environment-transformation",
  periodSeconds: 10,
  machines: MAGIC_SPAWNER_RANGE_DEVICE_IDS,
} as const;

export const MAGIC_SPAWNER_DEVICE_IDS = ["magic_spawner_1", "magic_spawner_2"] as const;

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 物料关系、分层概率和投影范围分别由配方行为及本地口声明。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: registry/recipe-definition.ts、registry/entity-definition.ts 与 shared/formation-recipes.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
//
// /** 周期转化程序 effects 顺序：0 = 明，1 = 晦，2 = 双侧配对成衡。 */
// export const MAGIC_SPAWNER_RANGE_DEVICE_ID_BY_EFFECT_INDEX = [
//   MAGIC_SPAWNER_RANGE_DEVICE_IDS.ming,
//   MAGIC_SPAWNER_RANGE_DEVICE_IDS.hui,
//   MAGIC_SPAWNER_RANGE_DEVICE_IDS.heng,
// ] as const;
//
// export const MAGIC_SPAWNER_RANGE_DEVICE_ID_LIST = MAGIC_SPAWNER_RANGE_DEVICE_ID_BY_EFFECT_INDEX;
//
// /**
//  * 区域环境转化的产线规划占位配方。
//  *
//  * 2026-11-25：区域设备没有配方通道，这些配方永远不会被仿真选中；
//  * 它们只为产线规划提供真实 recipeId 与静态输入输出，替代自动生成候选。
//  */
// export const ENVIRONMENT_RANGE_PLACEHOLDER_RECIPE_TAG = "EnvironmentRangePlaceholder";
//
