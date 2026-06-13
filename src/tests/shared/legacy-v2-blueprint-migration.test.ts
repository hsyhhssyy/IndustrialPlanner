import { describe, expect, it } from "vitest";

import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import { convertLegacyBlueprintJson } from "@/shared/storage/legacy-blueprint-import";
import {
  createLegacyBlueprintJsonFromV2BlueprintSnapshot,
  createLegacyBlueprintJsonFromV2Layout,
  filterLegacyV2LayoutBaseBuiltinEntities,
  type LegacyV2LayoutSnapshot,
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

  it("filters v2 foundation devices that v3 already provides as base builtins", () => {
    const baseDefinitions: BaseDefinition[] = [{
      id: "valley4_protocol_core",
      name: "协议核心区",
      placeableArea: { width: 70, height: 70 },
      outerRing: { top: 5, right: 5, bottom: 5, left: 5 },
      tag: "四号谷地",
      builtinEntities: [
        {
          id: "valley4_bus_source",
          definitionId: "item_port_log_hongs_bus_source",
          position: { x: -4, y: -4 },
          rotation: 0,
        },
        {
          id: "valley4_bus_seg_x_0",
          definitionId: "item_port_log_hongs_bus",
          position: { x: 0, y: -4 },
          rotation: 90,
        },
      ],
    }];
    const layout: LegacyV2LayoutSnapshot = {
      baseId: "valley4_protocol_core",
      devices: [
        {
          instanceId: "base_bus_source",
          typeId: "item_port_log_hongs_bus_source",
          rotation: 0,
          origin: { x: -4, y: -4 },
          config: {},
        },
        {
          instanceId: "base_bus_seg",
          typeId: "item_port_log_hongs_bus",
          rotation: 90,
          origin: { x: 0, y: -4 },
          config: {},
        },
        {
          instanceId: "base_protocol_hub",
          typeId: "item_port_sp_hub_1",
          rotation: 0,
          origin: { x: 0, y: 0 },
          config: {},
        },
        {
          instanceId: "user_bus_seg",
          typeId: "item_port_log_hongs_bus",
          rotation: 90,
          origin: { x: 8, y: 8 },
          config: {},
        },
      ],
      links: [
        {
          kind: "dark_pipe",
          sourceInstanceId: "base_bus_source",
          targetInstanceId: "user_bus_seg",
        },
        {
          kind: "dark_pipe",
          sourceInstanceId: "base_protocol_hub",
          targetInstanceId: "user_bus_seg",
        },
      ],
    };

    const filteredLayout = filterLegacyV2LayoutBaseBuiltinEntities(
      layout,
      baseDefinitions,
    );
    const legacyBlueprint = createLegacyBlueprintJsonFromV2Layout(filteredLayout);

    expect(filteredLayout.devices.map((device) => device.instanceId)).toEqual([
      "base_protocol_hub",
      "user_bus_seg",
    ]);
    expect(filteredLayout.links).toEqual([{
      kind: "dark_pipe",
      sourceInstanceId: "base_protocol_hub",
      targetInstanceId: "user_bus_seg",
    }]);
    expect(legacyBlueprint.devices.map((device) => device.blueprintInstanceId)).toEqual([
      "base_protocol_hub",
      "user_bus_seg",
    ]);
  });
});
