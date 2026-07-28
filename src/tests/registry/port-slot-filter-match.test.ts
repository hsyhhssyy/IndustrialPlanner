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

import type { EntityAcceptRuleDefinition, ItemDomain } from "@/domain/registry/types/entity-definition";
import {
  ItemDomainFlag,
  domainFlagsToLabel,
} from "@/domain/shared/item-domain-flags";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { ITEM_DEFINITIONS } from "@/registry/item-definition";

// ---------------------------------------------------------------------------
// 辅助：从 ITEM_DEFINITIONS 解析物品域
// ---------------------------------------------------------------------------

const ITEM_DOMAIN_BY_ID = new Map<string, ItemDomain>(
  ITEM_DEFINITIONS.map((item) => [
    item.id,
    item.tags.includes("gas")
      ? ItemDomainFlag.Gas
      : item.tags.includes("liquid")
        ? ItemDomainFlag.Liquid
        : ItemDomainFlag.Solid,
  ]),
);

/**
 * 将 acceptRule base 展开为它能接受的 ItemDomain 集合。
 * "none" 返回空集。
 */
// AI-CORRECTION 2026-07-28: acceptRule 已迁移为位标志，返回值改为域位集合。
function acceptDomains(
  base: EntityAcceptRuleDefinition["base"],
): ItemDomain {
  switch (base.kind) {
    case "domain":
      return base.flags;
    case "item":
      return ITEM_DOMAIN_BY_ID.get(base.itemId) ?? ItemDomainFlag.Solid;
    case "none":
      return ItemDomainFlag.None;
  }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("port-slot filter type union match", () => {
  it("每个槽位组的 itemFilterType 覆盖所有绑定端口的 acceptRule 并集", () => {
    const failures: Array<{
      entityId: string;
      slotGroupId: string;
      slotFilterType: number;
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
        let portUnion = ItemDomainFlag.None;
        const portDescs: string[] = [];

        for (const binding of boundBindings) {
          const portGroup = def.portGroups.find((pg) => pg.id === binding.portGroupId);
          if (!portGroup) {
            continue;
          }
          for (const port of portGroup.ports) {
            const domains = acceptDomains(port.acceptRule.base);
            portUnion |= domains;
            portDescs.push(`${portGroup.id}.${port.id}(${port.acceptRule.base.kind})`);
          }
        }

        if (portUnion === ItemDomainFlag.None) {
          continue; // "none" 端口不产生域约束
        }

        // 验证槽位 filterType 覆盖 portUnion
        const slotFilter = slotGroup.slots[0]?.itemFilterType ?? ItemDomainFlag.Solid;

        if ((slotFilter & portUnion) !== portUnion) {
          const missingFlags = portUnion & ~slotFilter;
          failures.push({
            entityId: def.id,
            slotGroupId: slotGroup.id,
            slotFilterType: slotFilter,
            portUnionDesc: `{${domainFlagsToLabel(portUnion)}} ← ${portDescs.join(", ")}`,
            missingDomains: domainFlagsToLabel(missingFlags),
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
