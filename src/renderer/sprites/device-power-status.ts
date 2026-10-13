import type { WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

/** 断电提示只表示供电覆盖缺失，不依赖仿真状态或基地总电量。 */
export function shouldShowPowerDisconnectedIcon(options: {
  definition: Pick<EntityDefinition, "id" | "powerDemand">;
  config: WorldEntity["config"];
  isInPowerRange: boolean;
}): boolean {
  if (options.definition.powerDemand <= 0 || options.isInPowerRange) {
    return false;
  }

  // 协议储存箱仅在定时上传开启时提示断电；普通收发与储存不触发提示。
  if (options.definition.id === "storager_1") {
    const channelRecipes = options.config.channelRecipes;
    return channelRecipes !== null
      && typeof channelRecipes === "object"
      && "warehouse_submit" in channelRecipes
      && channelRecipes.warehouse_submit === "r_warehouse_submit";
  }

  return true;
}
