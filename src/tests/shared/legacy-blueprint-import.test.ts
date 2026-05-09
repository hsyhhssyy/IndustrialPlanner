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
          preloadInputs: [{ slotIndex: 0, itemId: "item_plant_grass_2", amount: 50 }],
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
        rotation: 90,
      },
      turn_remap_0002: {
        definitionId: "belt_turn_cw_1x1",
        rotation: 0,
      },
      turn_remap_0003: {
        definitionId: "pipe_turn_ccw_1x1",
        rotation: 270,
      },
      turn_remap_0004: {
        definitionId: "pipe_turn_cw_1x1",
        rotation: 180,
      },
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