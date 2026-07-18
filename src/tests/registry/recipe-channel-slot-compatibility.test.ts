// =========================================================================
// 用户手动创建的测试
// 验证：每个配方中的原料和产物可以放入其设备至少一个 recipe channel
// 对应的原料/产物槽位中。
//
// 规则：
//   对每个 RECIPE，找到其 machineId 对应的设备，遍历设备的 recipeChannels：
//   - 配方每个 input 的物品域，必须在 channel.ingredientStorageGroupIds
//     对应的槽位组中，至少有一个槽位的 itemFilterType 能容纳该域。
//   - 配方每个 output 的物品域，必须在 channel.productStorageGroupIds
//     对应的槽位组中，至少有一个槽位的 itemFilterType 能容纳该域。
//   - 至少一个 channel 同时满足上述两个条件。
//
// 域集合定义（与 port-slot-filter-match.test.ts 一致）：
//   "solid"  → {solid}
//   "liquid" → {liquid}
//   "gas"    → {gas}
//   "fluid"  → {liquid, gas}
//   "any"    → {solid, liquid, gas}
// =========================================================================

import { describe, expect, it } from "vitest";

import type { ItemDomain } from "@/domain/registry/types/entity-definition";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";
import { ITEM_DEFINITIONS } from "@/registry/item-definition";
import { RECIPE_DEFINITIONS } from "@/registry/recipe-definition";

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

/**
 * 槽位组中所有槽位能容纳的 ItemDomain 并集。
 */
function slotGroupUnion(filterType: string): Set<ItemDomain> {
  return slotDomains(filterType);
}

/**
 * 给定一组槽位组 ID，返回它们的 itemFilterType 能容纳的域的并集。
 * 组内所有 slot 同质（filterType 一致），取第一个即可。
 */
function storageGroupsDomainUnion(
  groupIds: string[],
  storageSlotGroups: typeof ENTITY_DEFINITIONS[number]["storageSlotGroups"],
): Set<ItemDomain> {
  const union = new Set<ItemDomain>();
  for (const gid of groupIds) {
    const group = storageSlotGroups.find((g) => g.id === gid);
    if (!group || group.slots.length === 0) continue;
    const filterType = group.slots[0]!.itemFilterType ?? "solid";
    for (const d of slotGroupUnion(filterType)) {
      union.add(d);
    }
  }
  return union;
}

/**
 * 将物品 ID 解析为它能出现的域集合。
 * "any" → {solid, liquid, gas}
 * "fluid" → {liquid, gas}
 * "solid" → {solid}
 * 其他通过 ITEM_DEFINITIONS 查 tags。
 */
function itemDomains(itemId: string): Set<ItemDomain> {
  if (itemId === "any") {
    return new Set<ItemDomain>(["solid", "liquid", "gas"]);
  }
  if (itemId === "fluid") {
    return new Set<ItemDomain>(["liquid", "gas"]);
  }
  if (itemId === "solid") {
    return new Set<ItemDomain>(["solid"]);
  }
  const domain = ITEM_DOMAIN_BY_ID.get(itemId) ?? "solid";
  return new Set<ItemDomain>([domain]);
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

describe("recipe channel slot compatibility", () => {
  it("每个配方的原料和产物都可放入其设备至少一个 recipe channel 的对应槽位", () => {
    const failures: Array<{
      recipeId: string;
      machineId: string;
      channelResults: string;
    }> = [];

    for (const recipe of RECIPE_DEFINITIONS) {
      const def = ENTITY_DEFINITIONS.find((d) => d.id === recipe.machineId);
      if (!def) {
        failures.push({
          recipeId: recipe.id,
          machineId: recipe.machineId,
          channelResults: `设备 ${recipe.machineId} 未找到`,
        });
        continue;
      }

      if (def.recipeChannels.length === 0) {
        // 无 channel 的设备（如纯仓库），跳过
        continue;
      }

      // 计算每个配方物品可出现的域集合（通配符 any/fluid 展开为多个域）
      const inputDomainSets = recipe.inputs.map((inp) => itemDomains(inp.itemId));
      const outputDomainSets = recipe.outputs.map((out) => itemDomains(out.itemId));

      let anyChannelOk = false;
      const channelResults: string[] = [];

      for (const channel of def.recipeChannels) {
        const ingUnion = storageGroupsDomainUnion(
          channel.ingredientStorageGroupIds as string[],
          def.storageSlotGroups,
        );
        const prodUnion = storageGroupsDomainUnion(
          channel.productStorageGroupIds as string[],
          def.storageSlotGroups,
        );

        const missingIng: Set<ItemDomain>[] = [];
        for (const ds of inputDomainSets) {
          if (!isSuperset(ingUnion, ds)) {
            const missing = [...ds].filter((d) => !ingUnion.has(d));
            if (missing.length > 0) {
              missingIng.push(new Set(missing));
            }
          }
        }
        const missingProd: Set<ItemDomain>[] = [];
        for (const ds of outputDomainSets) {
          if (!isSuperset(prodUnion, ds)) {
            const missing = [...ds].filter((d) => !prodUnion.has(d));
            if (missing.length > 0) {
              missingProd.push(new Set(missing));
            }
          }
        }

        const ok = missingIng.length === 0 && missingProd.length === 0;
        if (ok) {
          anyChannelOk = true;
          break;
        }

        const parts: string[] = [];
        if (missingIng.length > 0) {
          const allMissing = new Set<ItemDomain>();
          for (const s of missingIng) {
            for (const d of s) allMissing.add(d);
          }
          parts.push(
            `原料缺域 [{${[...allMissing].join(", ")}}] (槽位可容 {${[...ingUnion].join(", ")}}))`,
          );
        }
        if (missingProd.length > 0) {
          const allMissing = new Set<ItemDomain>();
          for (const s of missingProd) {
            for (const d of s) allMissing.add(d);
          }
          parts.push(
            `产物缺域 [{${[...allMissing].join(", ")}}] (槽位可容 {${[...prodUnion].join(", ")}}))`,
          );
        }
        channelResults.push(`  channel "${channel.id}": ${parts.join("; ")}`);
      }

      if (!anyChannelOk) {
        failures.push({
          recipeId: recipe.id,
          machineId: recipe.machineId,
          channelResults: channelResults.join("\n"),
        });
      }
    }

    if (failures.length > 0) {
      console.error(
        "配方物品域不被 channel 槽位覆盖:\n" +
          failures
            .map(
              (f) =>
                `  ${f.recipeId} (machine: ${f.machineId}):\n${f.channelResults}`,
            )
            .join("\n"),
      );
    }

    expect(failures).toEqual([]);
  });
});
