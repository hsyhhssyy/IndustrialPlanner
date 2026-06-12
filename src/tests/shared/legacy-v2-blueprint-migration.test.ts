import { describe, expect, it } from "vitest";

import { convertLegacyBlueprintJson } from "@/shared/storage/legacy-blueprint-import";
import {
  createLegacyBlueprintJsonFromV2BlueprintSnapshot,
  normalizeLegacyV2BlueprintSnapshotsStorage,
} from "@/shared/storage/legacy-v2-blueprint-migration";

describe("legacy-v2-blueprint-migration", () => {
  it("wraps v2 user blueprint snapshots so the shared legacy blueprint importer accepts them", () => {
    const snapshots = normalizeLegacyV2BlueprintSnapshotsStorage([{
      id: "BluePrint-HSY-00000000-0000-4000-8000-000000000001",
      name: "迁移蓝图",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      version: "1.2.0.4",
      blueprintVersion: "1",
      baseId: "wuling_protocol_core",
      source: "user",
      devices: [{
        blueprintInstanceId: "bp-storager",
        typeId: "item_port_storager_1",
        rotation: 0,
        origin: { x: 0, y: 0 },
        config: {
          storageSlots: [{
            slotIndex: 1,
            mode: "pinned",
            pinnedItemId: "item_iron_ore",
            preloadItemId: "item_iron_ore",
            preloadAmount: 12,
          }],
        },
      }],
      links: [],
    }]);

    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) {
      throw new Error("expected normalized v2 blueprint snapshot");
    }

    const legacyBlueprint = createLegacyBlueprintJsonFromV2BlueprintSnapshot(snapshot);
    const converted = convertLegacyBlueprintJson(legacyBlueprint, {
      blueprintId: "v2-migration:blueprint:test",
      entityIdPrefix: "v2bp_test",
    });

    expect(legacyBlueprint.schema).toBe("industrial-planner-blueprint");
    expect(converted).toMatchObject({
      blueprintId: "v2-migration:blueprint:test",
      name: "迁移蓝图",
      baseId: "wuling_protocol_core",
      entityOrder: ["v2bp_test_0001"],
    });
    expect(converted?.entities.v2bp_test_0001?.config).toEqual({
      "storageSlotGroups[1].slots[0].initialItemType": "item_iron_ore",
      "storageSlotGroups[1].slots[0].initialCount": 12,
      channelRecipes: {
        warehouse_submit: "r_warehouse_submit",
      },
    });
  });
});
