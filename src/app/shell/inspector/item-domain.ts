import type {
  EntityAcceptRuleDefinition,
  ItemDomain,
} from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";

export type InspectorItemDomainFilter = ItemDomain | "fluid" | "any";

export function matchesItemDomainFilter(
  item: ItemDefinition,
  domain: InspectorItemDomainFilter,
  resolveItemDomain: (itemId: string) => ItemDomain,
): boolean {
  if (domain === "any") {
    return true;
  }

  const itemDomain = resolveItemDomain(item.id);
  if (domain === "fluid") {
    return itemDomain === "liquid" || itemDomain === "gas";
  }

  return itemDomain === domain;
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
    case "any":
      return true;
    case "solid":
    case "liquid":
    case "gas":
      return resolveItemDomain(item.id) === acceptRule.base.kind;
    case "fluid": {
      const itemDomain = resolveItemDomain(item.id);
      return itemDomain === "liquid" || itemDomain === "gas";
    }
    case "item":
      return item.id === acceptRule.base.itemId;
    case "none":
      return false;
  }
}
