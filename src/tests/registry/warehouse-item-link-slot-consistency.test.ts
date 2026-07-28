// =========================================================================
// 用户手动创建的测试
// 验证：对于所有声明了 warehouseItemLink inspector 的设备，其关联的
// storageSlotGroup.kind 与每个 slot.itemFilterType 必须语义一致。
//
// 映射规则：
//   storageSlotGroup.kind   →  slot.itemFilterType
//   "item"                  →  "solid"
//   "fluid"                 →  "fluid"
//   "liquid"                →  "liquid"
//   "gas"                   →  "gas"
//
// 不一致例子：
//   kind="fluid" 但 itemFilterType="liquid" → 组声明接受气体，槽位滤掉了气体
//   kind="item"  但 itemFilterType="fluid"  → 组声明固体物品，槽位却接受流体
// =========================================================================

import { describe, expect, it } from "vitest";

import {
  domainFlagsToLabel,
  type ItemDomainFlag,
} from "@/domain/shared/item-domain-flags";
import { ENTITY_DEFINITIONS } from "@/registry/entity-definition";

type SlotConsistencyFailure = {
  entityId: string;
  nameKey: string;
  storageGroupId: string;
  groupKind: ItemDomainFlag;
  slotId: string;
  itemFilterType: ItemDomainFlag | undefined | string;
  expected: ItemDomainFlag | string;
};

describe("warehouse-item-link slot kind / itemFilterType consistency", () => {
  it("所有 warehouseItemLink 槽位的 itemFilterType 与父 storageSlotGroup.kind 一致", () => {
    const failures: SlotConsistencyFailure[] = [];

    for (const def of ENTITY_DEFINITIONS) {
      // 收集该实体所有 warehouseItemLink 声明涉及的 slotGroupIds
      const warehouseGroupIds = new Set<string>();
      for (const inspector of def.inspectors) {
        if (inspector.type !== "warehouse-item-link") {
          continue;
        }
        for (const gid of inspector.slotGroupIds) {
          warehouseGroupIds.add(gid);
        }
      }

      if (warehouseGroupIds.size === 0) {
        continue;
      }

      // 检查这些组中的每个槽位
      for (const slotGroup of def.storageSlotGroups) {
        if (!warehouseGroupIds.has(slotGroup.id)) {
          continue;
        }

        // AI-CORRECTION 2026-07-28: 槽组与槽位均使用同一域位标志，不再需要字符串映射表。
        const expected = slotGroup.kind;

        for (const slot of slotGroup.slots) {
          if (slot.itemFilterType !== expected) {
            failures.push({
              entityId: def.id,
              nameKey: def.nameKey,
              storageGroupId: slotGroup.id,
              groupKind: slotGroup.kind,
              slotId: slot.id,
              itemFilterType: slot.itemFilterType,
              expected,
            });
          }
        }
      }
    }

    if (failures.length > 0) {
      const summary = failures
        .map(
          (f) =>
            `${f.entityId} (${f.nameKey}): ${f.storageGroupId}.${f.slotId} — ` +
            `kind="${domainFlagsToLabel(f.groupKind)}" ` +
            `期望 itemFilterType="${typeof f.expected === "number" ? domainFlagsToLabel(f.expected) : f.expected}"，` +
            `实际="${typeof f.itemFilterType === "number" ? domainFlagsToLabel(f.itemFilterType) : f.itemFilterType}"`,
        )
        .join("\n");

      expect.fail(`发现 ${failures.length} 处不一致:\n${summary}`);
    }
  });
});
