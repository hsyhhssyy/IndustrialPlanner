// =========================================================================
// 用户手动创建的测试
// 验证：每个设备中，槽位组的 itemFilterType 必须能容纳所有绑定到该槽位组的
// 端口 acceptRule 能接收的物品域。
//
// 规则：
//   对每个 storageSlotGroup，收集所有通过 portStorageBindings 绑定到它的
//   端口，取这些端口 acceptRule 能接受的物品域的并集（portUnion）。
//   槽位的 itemFilterType 必须覆盖（⊇）该并集。
//
// 域集合定义：
//   "solid"  → {solid}
//   "liquid" → {liquid}
//   "gas"    → {gas}
//   "fluid"  → {liquid, gas}
//   "any"    → {solid, liquid, gas}
//
// 例如：混料池 solid端口 + fluid端口 绑定同一槽位 → portUnion = {solid, liquid, gas}
//   → 槽位 "any" 覆盖该并集，通过。
// 反例：端口 acceptRule=fluid ({liquid,gas}) → 槽位 "liquid" ({liquid})
//   → 槽位不覆盖端口并集，失败。
// =========================================================================

import { describe, expect, it } from "vitest";

import type { ItemDomain } from "@/domain/registry/types/entity-definition";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { ITEM_DEFINITIONS } from "@/registry/item-definition";

// ---------------------------------------------------------------------------
// 辅助：从 ITEM_DEFINITIONS 解析物品域
// ---------------------------------------------------------------------------

const ITEM_DOMAIN_BY_ID = new Map<string, ItemDomain>(
  ITEM_DEFINITIONS.map((item) => [
    item.id,
    item.tags.includes("gas")
      ? "gas"
      : item.tags.includes("liquid")
        ? "liquid"
        : "solid",
  ]),
);

/**
 * 将 acceptRule base 展开为它能接受的 ItemDomain 集合。
 * "none" 返回空集。
 */
function acceptDomains(
  base: { kind: string; itemId?: string },
): Set<ItemDomain> {
  switch (base.kind) {
    case "solid":
      return new Set<ItemDomain>(["solid"]);
    case "liquid":
      return new Set<ItemDomain>(["liquid"]);
    case "gas":
      return new Set<ItemDomain>(["gas"]);
    case "fluid":
      return new Set<ItemDomain>(["liquid", "gas"]);
    case "any":
      return new Set<ItemDomain>(["solid", "liquid", "gas"]);
    case "item":
      return new Set<ItemDomain>([ITEM_DOMAIN_BY_ID.get(base.itemId!) ?? "solid"]);
    case "none":
      return new Set<ItemDomain>();
  }
  return new Set<ItemDomain>();
}

/**
 * 将 slot itemFilterType 展开为它能容纳的 ItemDomain 集合。
 */
function slotDomains(filterType: string): Set<ItemDomain> {
  switch (filterType) {
    case "solid":
      return new Set<ItemDomain>(["solid"]);
    case "liquid":
      return new Set<ItemDomain>(["liquid"]);
    case "gas":
      return new Set<ItemDomain>(["gas"]);
    case "fluid":
      return new Set<ItemDomain>(["liquid", "gas"]);
    case "any":
      return new Set<ItemDomain>(["solid", "liquid", "gas"]);
  }
  return new Set<ItemDomain>();
}

/** 判断 superset ⊇ subset */
function isSuperset<T>(superset: Set<T>, subset: Set<T>): boolean {
  for (const item of subset) {
    if (!superset.has(item)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("port-slot filter type union match", () => {
  it("每个槽位组的 itemFilterType 覆盖所有绑定端口的 acceptRule 并集", () => {
    const failures: Array<{
      entityId: string;
      slotGroupId: string;
      slotFilterType: string;
      portUnionDesc: string;
      missingDomains: string;
    }> = [];

    for (const def of ENTITY_DEFINITIONS) {
      for (const slotGroup of def.storageSlotGroups) {
        // 收集所有绑定到该槽位组的端口
        const boundBindings = def.portStorageBindings.filter(
          (b) => b.storageSlotGroupId === slotGroup.id,
        );

        if (boundBindings.length === 0) {
          continue;
        }

        // 计算所有绑定端口的 acceptRule 并集
        const portUnion = new Set<ItemDomain>();
        const portDescs: string[] = [];

        for (const binding of boundBindings) {
          const portGroup = def.portGroups.find((pg) => pg.id === binding.portGroupId);
          if (!portGroup) {
            continue;
          }
          for (const port of portGroup.ports) {
            const domains = acceptDomains(port.acceptRule.base);
            for (const d of domains) {
              portUnion.add(d);
            }
            portDescs.push(`${portGroup.id}.${port.id}(${port.acceptRule.base.kind})`);
          }
        }

        if (portUnion.size === 0) {
          continue; // "none" 端口不产生域约束
        }

        // 验证槽位 filterType 覆盖 portUnion
        const slotFilter = slotGroup.slots[0]?.itemFilterType ?? "solid";
        const slotSet = slotDomains(slotFilter);

        if (!isSuperset(slotSet, portUnion)) {
          const portUnionStr = [...portUnion].join(", ");
          const missing = [...portUnion].filter((d) => !slotSet.has(d)).join(", ");
          failures.push({
            entityId: def.id,
            slotGroupId: slotGroup.id,
            slotFilterType: slotFilter,
            portUnionDesc: `{${portUnionStr}} ← ${portDescs.join(", ")}`,
            missingDomains: missing,
          });
        }
      }
    }

    if (failures.length > 0) {
      console.error(
        "端口并集不被槽位覆盖:\n" +
          failures
            .map(
              (f) =>
                `  ${f.entityId}: 槽位组 ${f.slotGroupId} filterType="${f.slotFilterType}" ` +
                `端口并集 ${f.portUnionDesc}, ` +
                `缺失覆盖: {${f.missingDomains}}`,
            )
            .join("\n"),
      );
    }

    expect(failures).toEqual([]);
  });
});
