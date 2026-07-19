// =========================================================================
// 用户手动创建的测试
// 验证：每个配方中的原料和产物可以放入其设备至少一个 recipe channel
// 对应的原料/产物槽位中。
//
// 规则：
//   对每个 RECIPE，找到其 machineId 对应的设备，遍历设备的 recipeChannels：
//   - 将 channel.ingredientStorageGroupIds 下所有槽位展开为独立槽位列表。
//   - 将 recipe.inputs 展开为独立物品域列表（每个 input 一个物品域集合）。
//   - 通过回溯排列组合检查：是否存在一种分配方式，将每个 input
//     一对一分配到某个槽位，且该槽位的 itemFilterType 能容纳该物品域。
//   - 对 outputs / productStorageGroupIds 同理。
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
 * 收集 channel 对应方向（ingredient 或 product）所有独立槽位的 itemFilterType。
 * 不做去重——每个槽位是独立的分配单元（如 ["gas", "gas"] 表示 2 个 gas 槽位）。
 */
function collectSlotFilterTypes(
  groupIds: string[],
  storageSlotGroups: typeof ENTITY_DEFINITIONS[number]["storageSlotGroups"],
): string[] {
  const filterTypes: string[] = [];
  for (const gid of groupIds) {
    const group = storageSlotGroups.find((g) => g.id === gid);
    if (!group) continue;
    for (const slot of group.slots) {
      filterTypes.push(slot.itemFilterType ?? "solid");
    }
  }
  return filterTypes;
}

/**
 * 检查单个槽位能否容纳某个配方物品的域集合。
 */
function slotCanHoldItem(filterType: string, itemDomains: Set<ItemDomain>): boolean {
  return isSuperset(slotDomains(filterType), itemDomains);
}

/**
 * 回溯匹配：inputs 是否能一对一分配到 slots 上（每个 slot 最多一个 input）。
 * 调用方保证 inputs 去重（每个 input 是独立分配单元）。
 */
function canMatchAll(
  inputDomainSets: Set<ItemDomain>[],
  slotFilterTypes: string[],
): boolean {
  if (inputDomainSets.length === 0) return true;
  if (slotFilterTypes.length < inputDomainSets.length) return false;

  const used = new Array(slotFilterTypes.length).fill(false);

  function backtrack(inputIdx: number): boolean {
    if (inputIdx >= inputDomainSets.length) return true;
    const inputDomains = inputDomainSets[inputIdx]!;
    for (let slotIdx = 0; slotIdx < slotFilterTypes.length; slotIdx++) {
      if (used[slotIdx]) continue;
      if (slotCanHoldItem(slotFilterTypes[slotIdx]!, inputDomains)) {
        used[slotIdx] = true;
        if (backtrack(inputIdx + 1)) return true;
        used[slotIdx] = false;
      }
    }
    return false;
  }

  return backtrack(0);
}

// AI-REMOVED 2026-07-19:
// Reason: 槽位匹配从域并集升级为排列组合匹配，这两个函数不再需要。
// Trigger: 气体反应炉单 gas 槽位但配方有 2 个 gas 输入 → 并集检测漏检。
// Evidence: 并集 {gas} ⊇ {gas},{gas} 为 true，但 1 个 gas 槽位无法同时装两种不同气体。
// Replacement: collectSlotFilterTypes + canMatchAll（回溯排列组合匹配）。
// Risk: Low — 已有调用方已全部替换。
// Human Review: Required
//
// Original code:
// function slotGroupUnion(filterType: string): Set<ItemDomain> {
//   return slotDomains(filterType);
// }
//
// function storageGroupsDomainUnion(
//   groupIds: string[],
//   storageSlotGroups: typeof ENTITY_DEFINITIONS[number]["storageSlotGroups"],
// ): Set<ItemDomain> {
//   const union = new Set<ItemDomain>();
//   for (const gid of groupIds) {
//     const group = storageSlotGroups.find((g) => g.id === gid);
//     if (!group || group.slots.length === 0) continue;
//     const filterType = group.slots[0]!.itemFilterType ?? "solid";
//     for (const d of slotGroupUnion(filterType)) {
//       union.add(d);
//     }
//   }
//   return union;
// }

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
        const ingSlotFilterTypes = collectSlotFilterTypes(
          channel.ingredientStorageGroupIds as string[],
          def.storageSlotGroups,
        );
        const prodSlotFilterTypes = collectSlotFilterTypes(
          channel.productStorageGroupIds as string[],
          def.storageSlotGroups,
        );

        const ingOk = canMatchAll(inputDomainSets, ingSlotFilterTypes);
        const prodOk = canMatchAll(outputDomainSets, prodSlotFilterTypes);
        const ok = ingOk && prodOk;
        if (ok) {
          anyChannelOk = true;
          break;
        }

        const parts: string[] = [];
        if (!ingOk && inputDomainSets.length > 0) {
          parts.push(
            `原料 [${inputDomainSets.map((d) => `{${[...d].join(",")}}`).join(", ")}] ` +
            `无法匹配槽位 [${ingSlotFilterTypes.join(", ")}]`,
          );
        }
        if (!prodOk && outputDomainSets.length > 0) {
          parts.push(
            `产物 [${outputDomainSets.map((d) => `{${[...d].join(",")}}`).join(", ")}] ` +
            `无法匹配槽位 [${prodSlotFilterTypes.join(", ")}]`,
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
