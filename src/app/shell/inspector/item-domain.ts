import type {
  EntityAcceptRuleDefinition,
  ItemDomain,
} from "@/domain/registry/types/entity-definition";
import type { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";

export type InspectorItemDomainFilter = ItemDomainFlag;

export function matchesItemDomainFilter(
  item: ItemDefinition,
  domain: InspectorItemDomainFilter,
  resolveItemDomain: (itemId: string) => ItemDomain,
): boolean {
  const itemDomain = resolveItemDomain(item.id);
  return (itemDomain & domain) !== 0;
}

export function matchesItemAcceptRule(
  item: ItemDefinition,
  acceptRule: EntityAcceptRuleDefinition,
  resolveItemDomain: (itemId: string) => ItemDomain,
): boolean {
  if (acceptRule.exclude.includes(item.id)) {
    return false;
  }

  switch (acceptRule.base.kind) {
    case "domain":
      return (resolveItemDomain(item.id) & acceptRule.base.flags) !== 0;
    case "item":
      return item.id === acceptRule.base.itemId;
    case "none":
      return false;
  }
}
