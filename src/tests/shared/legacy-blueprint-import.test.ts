import { describe, expect, it } from "vitest";

import {
  convertLegacyBlueprintJson,
  normalizeLegacyBlueprintJson,
} from "@/shared/storage/legacy-blueprint-import";

describe("legacy-blueprint-import", () => {
  it("converts a legacy blueprint payload into the current blueprint document shape", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      id: "PublicBluePrint-HSY-c96944de-0608-4abf-901a-8b3d27a476d1",
      version: "1.0",
      name: "双烘炉息壤产线",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [
        {
          typeId: "item_port_power_diffuser_1",
          rotation: 180,
          origin: { x: 0, y: 0 },
          config: {},
        },
        {
          typeId: "item_port_furnance_1",
          rotation: 0,
          origin: { x: 3, y: 4 },
          config: {
            preloadInputs: [{ slotIndex: 0, itemId: "item_plant_grass_2", amount: 50 }],
          },
        },
      ],
    });

    expect(converted).toMatchObject({
      blueprintId: "c96944de-0608-4abf-901a-8b3d27a476d1",
      version: "v1.3.0",
      name: "双烘炉息壤产线",
      description: "",
      baseId: "wuling_tianwangping_aid",
      initialGridPoint: { x: 2, y: 3 },
      entityOrder: ["legacy_c96944de_0001", "legacy_c96944de_0002"],
      slotLinks: [],
      createdAt: "2026-03-04T15:00:38.701Z",
      updatedAt: "2026-03-04T15:00:38.701Z",
    });

    expect(converted?.entities).toEqual({
      legacy_c96944de_0001: {
        id: "legacy_c96944de_0001",
        definitionId: "item_port_power_diffuser_1",
        position: { x: 0, y: 0 },
        rotation: 180,
        config: {},
        tags: [],
      },
      legacy_c96944de_0002: {
        id: "legacy_c96944de_0002",
        definitionId: "item_port_furnance_1",
        position: { x: 3, y: 4 },
        rotation: 0,
        config: {
          "storageSlotGroups[0].slots[0].initialItemType": "item_plant_grass_2",
          "storageSlotGroups[0].slots[0].initialCount": 50,
        },
        tags: [],
      },
    });
  });

  it("remaps v2 turn devices to the current turn semantics", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "转向兼容测试",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [
        {
          typeId: "belt_turn_cw_1x1",
          rotation: 0,
          origin: { x: 0, y: 0 },
          config: {},
        },
        {
          typeId: "belt_turn_ccw_1x1",
          rotation: 270,
          origin: { x: 1, y: 0 },
          config: {},
        },
        {
          typeId: "pipe_turn_cw_1x1",
          rotation: 180,
          origin: { x: 2, y: 0 },
          config: {},
        },
        {
          typeId: "pipe_turn_ccw_1x1",
          rotation: 90,
          origin: { x: 3, y: 0 },
          config: {},
        },
      ],
    }, {
      entityIdPrefix: "turn_remap",
    });

    expect(converted?.entities).toMatchObject({
      turn_remap_0001: {
        definitionId: "belt_turn_ccw_1x1",
        rotation: 0,
      },
      turn_remap_0002: {
        definitionId: "belt_turn_cw_1x1",
        rotation: 180,
      },
      turn_remap_0003: {
        definitionId: "pipe_turn_ccw_1x1",
        rotation: 180,
      },
      turn_remap_0004: {
        definitionId: "pipe_turn_cw_1x1",
        rotation: 0,
      },
    });
  });

  // AI-REMOVED 2026-05-10:
  // Reason: The warehouse-unloader blanket remap assertion was based on a false
  //   hypothesis and would force the current system blueprints to migrate into an
  //   incorrect direction.
  // Trigger: The premium capsule legacy source already stores its top-row unloaders
  //   at rotation=180, and the current migrated system blueprint preserves those
  //   rotations to feed the belts below.
  // Evidence: Legacy source and migrated public asset agree on the unloader line;
  //   the added assertion contradicted that corpus.
  // Replacement: The existing import tests remain the active coverage until a
  //   version-gated warehouse-port migration rule is identified.
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // it("remaps legacy warehouse unloader rotation to the current port basis", () => {
  //   const converted = convertLegacyBlueprintJson({
  //     schema: "industrial-planner-blueprint",
  //     name: "仓库取货口朝向兼容测试",
  //     createdAt: "2026-03-04T15:00:38.701Z",
  //     baseId: "wuling_tianwangping_aid",
  //     devices: [
  //       {
  //         typeId: "item_port_unloader_1",
  //         rotation: 0,
  //         origin: { x: 6, y: 4 },
  //         config: {},
  //       },
  //       {
  //         typeId: "item_port_unloader_1",
  //         rotation: 90,
  //         origin: { x: 9, y: 4 },
  //         config: {},
  //       },
  //     ],
  //   }, {
  //     entityIdPrefix: "warehouse_unloader_remap",
  //   });
  //
  //   expect(converted?.entities).toMatchObject({
  //     warehouse_unloader_remap_0001: {
  //       definitionId: "item_port_unloader_1",
  //       rotation: 180,
  //     },
  //     warehouse_unloader_remap_0002: {
  //       definitionId: "item_port_unloader_1",
  //       rotation: 270,
  //     },
  //   });
  // });

  // AI-CORRECTION 2026-05-10: item_port_unloader_1 的 registry 基准已改为
  //   rotation=0 时端口朝南，因此旧版蓝图迁移重新需要 +180 度补偿。
  it("remaps legacy warehouse unloader rotation to the current port basis", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "仓库取货口朝向兼容测试",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [
        {
          typeId: "item_port_unloader_1",
          rotation: 0,
          origin: { x: 6, y: 4 },
          config: {},
        },
        {
          typeId: "item_port_unloader_1",
          rotation: 90,
          origin: { x: 9, y: 4 },
          config: {},
        },
      ],
    }, {
      entityIdPrefix: "warehouse_unloader_remap",
    });

    expect(converted?.entities).toMatchObject({
      warehouse_unloader_remap_0001: {
        definitionId: "item_port_unloader_1",
        rotation: 180,
      },
      warehouse_unloader_remap_0002: {
        definitionId: "item_port_unloader_1",
        rotation: 270,
      },
    });
  });

  it("migrates legacy storage submit flag to warehouse submit recipe", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "协议存储箱提交迁移测试",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "item_port_storager_1",
        rotation: 0,
        origin: { x: 0, y: 0 },
        config: {
          submitToWarehouse: true,
        },
      }],
    }, {
      entityIdPrefix: "storager_submit",
    });

    expect(converted?.entities.storager_submit_0001?.config).toEqual({
      channelRecipes: {
        warehouse_submit: "r_warehouse_submit",
      },
    });
  });

  it("migrates legacy protocol core output configs to warehouse links", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "协议核心输出迁移测试",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "item_port_sp_hub_1",
        rotation: 0,
        origin: { x: 0, y: 0 },
        config: {
          protocolHubOutputs: [
            { portId: "out_w_2", itemId: "item_copper_ore", ignoreInventory: true },
            { portId: "out_e_8", itemId: "item_iron_ore", ignoreInventory: false },
            { portId: "in_n_2", itemId: "item_originium_ore", ignoreInventory: true },
          ],
        },
      }],
    }, {
      entityIdPrefix: "protocol_core",
    });

    expect(converted?.entities.protocol_core_0001?.config).toEqual({
      "links[0].id": "",
      "links[0].linkType": "share-all",
      "links[0].source.entityId": "",
      "links[0].source.storageSlotGroupId": "unbuffer_w2",
      "links[0].source.slotId": "slot_1",
      "links[0].target.entityId": "warehouse",
      "links[0].target.storageSlotGroupId": "warehouse",
      "links[0].target.slotId": "item_copper_ore",
      "storageSlotGroups[0].slots[0].ignoreStock": true,
      "links[5].id": "",
      "links[5].linkType": "share-all",
      "links[5].source.entityId": "",
      "links[5].source.storageSlotGroupId": "unbuffer_e8",
      "links[5].source.slotId": "slot_1",
      "links[5].target.entityId": "warehouse",
      "links[5].target.storageSlotGroupId": "warehouse",
      "links[5].target.slotId": "item_iron_ore",
      "storageSlotGroups[5].slots[0].ignoreStock": false,
    });
  });

  it("migrates legacy storager default submit and storage preloads", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "协议存储箱默认交货迁移测试",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "item_port_storager_1",
        rotation: 0,
        origin: { x: 0, y: 0 },
        config: {
          storagePreloadInputs: [{ slotIndex: 2, itemId: "item_copper_ore", amount: 7 }],
        },
      }],
    }, {
      entityIdPrefix: "storager_default_submit",
    });

    expect(converted?.entities.storager_default_submit_0001?.config).toEqual({
      "storageSlotGroups[2].slots[0].initialItemType": "item_copper_ore",
      "storageSlotGroups[2].slots[0].initialCount": 7,
      channelRecipes: {
        warehouse_submit: "r_warehouse_submit",
      },
    });
  });

  it("keeps legacy storager submit disabled and migrates storage slot config", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "协议存储箱关闭交货迁移测试",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "item_port_storager_1",
        rotation: 0,
        origin: { x: 0, y: 0 },
        config: {
          submitToWarehouse: false,
          storagePreloadInputs: [{ slotIndex: 3, itemId: "item_copper_ore", amount: 7 }],
          storageSlots: [{
            slotIndex: 1,
            mode: "pinned",
            pinnedItemId: "item_iron_ore",
            preloadItemId: "item_iron_ore",
            preloadAmount: 12,
          }],
        },
      }],
    }, {
      entityIdPrefix: "storager_no_submit",
    });

    expect(converted?.entities.storager_no_submit_0001?.config).toEqual({
      "storageSlotGroups[1].slots[0].lock": "item_iron_ore",
      "storageSlotGroups[1].slots[0].initialItemType": "item_iron_ore",
      "storageSlotGroups[1].slots[0].initialCount": 12,
    });
  });

  it("cleans legacy warehouse loader delivery config while preserving rotation migration", () => {
    const converted = convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "仓库存货口迁移测试",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "item_port_loader_1",
        rotation: 270,
        origin: { x: 0, y: 0 },
        config: {
          submitToWarehouse: true,
          channelRecipes: { warehouse_submit: "r_warehouse_submit" },
          "links[0].source.entityId": "legacy-loader",
          "storageSlotGroups[0].slots[0].submitMode": "every-tick",
          protocolHubOutputs: [{ portId: "out_w_2", itemId: "item_copper_ore" }],
        },
      }],
    }, {
      entityIdPrefix: "warehouse_loader",
    });

    expect(converted?.entities.warehouse_loader_0001).toMatchObject({
      definitionId: "item_port_loader_1",
      rotation: 270,
      config: {},
    });
  });

  it("rejects legacy blueprints that contain unsupported dark-pipe links", () => {
    expect(convertLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      name: "暗管蓝图",
      createdAt: "2026-03-04T15:00:38.701Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "item_port_udpipe_loader_1",
        rotation: 0,
        origin: { x: 0, y: 0 },
        config: {},
      }],
      links: [{
        kind: "dark_pipe",
        sourceBlueprintInstanceId: "source",
        targetBlueprintInstanceId: "target",
      }],
    })).toBeNull();
  });

  it("normalizes a valid legacy payload and preserves optional fields", () => {
    expect(normalizeLegacyBlueprintJson({
      schema: "industrial-planner-blueprint",
      id: "legacy-id",
      version: 1,
      blueprintVersion: "3",
      name: " 样例蓝图 ",
      description: " 说明 ",
      createdAt: "2026-03-04T15:00:38.701Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "belt_straight_1x1",
        rotation: 90,
        origin: { x: 10, y: 12 },
        config: {},
      }],
    })).toEqual({
      schema: "industrial-planner-blueprint",
      id: "legacy-id",
      version: 1,
      blueprintVersion: "3",
      name: "样例蓝图",
      description: "说明",
      createdAt: "2026-03-04T15:00:38.701Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
      baseId: "wuling_tianwangping_aid",
      devices: [{
        typeId: "belt_straight_1x1",
        rotation: 90,
        origin: { x: 10, y: 12 },
        config: {},
      }],
      links: [],
    });
  });
});
