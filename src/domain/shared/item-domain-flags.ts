/**
 * 物品域位标志。
 *
 * 位值与游戏数据 phaseType 保持一致；位值发布后不得修改，只能继续分配新位。
 */
export type ItemDomainFlag = number;

export const ItemDomainFlag = {
  None: 0,
  Solid: 1 << 0,
  Liquid: 1 << 1,
  Gas: 1 << 2,
} as const;

/** 所有当前已知物品域。 */
export const AnyDomain: ItemDomainFlag =
  ItemDomainFlag.Solid | ItemDomainFlag.Liquid | ItemDomainFlag.Gas;

/** 可由管道承载的液体与气体联合域。 */
export const FluidDomain: ItemDomainFlag =
  ItemDomainFlag.Liquid | ItemDomainFlag.Gas;

/** 配方使用的内部域占位符；这些值都不是注册表物品 ID。 */
export const RecipeItemDomainId = {
  Solid: "__domain_solid",
  Liquid: "__domain_liquid",
  Gas: "__domain_gas",
  Fluid: "__domain_fluid",
} as const;

/** 暗管 void 配方使用的液体与气体联合域占位符。 */
export const FLUID_DOMAIN_RECIPE_ITEM_ID = RecipeItemDomainId.Fluid;

/** 将内部配方占位符解析为物品域；普通物品 ID 返回 null。 */
export function resolveRecipeItemDomainFlags(
  itemId: string,
): ItemDomainFlag | null {
  switch (itemId) {
    case RecipeItemDomainId.Solid:
      return ItemDomainFlag.Solid;
    case RecipeItemDomainId.Liquid:
      return ItemDomainFlag.Liquid;
    case RecipeItemDomainId.Gas:
      return ItemDomainFlag.Gas;
    case RecipeItemDomainId.Fluid:
      return FluidDomain;
    default:
      return null;
  }
}

/** 判断 flags 是否完整包含 domain 的全部位。 */
export function hasDomain(
  flags: ItemDomainFlag,
  domain: ItemDomainFlag,
): boolean {
  return domain !== ItemDomainFlag.None && (flags & domain) === domain;
}

/** 将域位标志转换为稳定、可读的诊断标签。 */
export function domainFlagsToLabel(flags: ItemDomainFlag): string {
  if (flags === ItemDomainFlag.None) {
    return "none";
  }

  const labels: string[] = [];
  if ((flags & ItemDomainFlag.Solid) !== 0) {
    labels.push("solid");
  }
  if ((flags & ItemDomainFlag.Liquid) !== 0) {
    labels.push("liquid");
  }
  if ((flags & ItemDomainFlag.Gas) !== 0) {
    labels.push("gas");
  }
  return labels.join("|");
}
