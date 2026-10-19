import type { ItemDefinition } from "@/domain/registry/types/item-definition";

/** 规划的一级原料边界；不参与地区资源及仿真仓库的无限供给判定。 */
export function isPlanningRawResourceItem(
  item: Pick<ItemDefinition, "tags"> | null | undefined,
): boolean {
  return item?.tags.some(tag => tag === "自然资源" || tag === "农作物") ?? false;
}
