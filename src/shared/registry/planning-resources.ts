import type { ItemDefinition } from "@/domain/registry/types/item-definition";

/** 规划的一级原料边界；不参与地区资源及仿真仓库的无限供给判定。 */
export function isPlanningRawResourceItem(
  item: Pick<ItemDefinition, "tags"> | null | undefined,
): boolean {
  // 2026-11-23：「畜产」与「农作物」同属规划一级原料，但不会进入地区资源配置或仿真无限供给。
  // 引入原因：兽奶无生产配方，导致唯一装瓶配方被 isRecipeExcludedFromProductionPlanningAuto 整条排除。
  return item?.tags.some(tag => tag === "自然资源" || tag === "农作物" || tag === "畜产") ?? false;
}
