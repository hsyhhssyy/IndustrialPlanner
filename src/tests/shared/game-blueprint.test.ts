import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { MAX_BLUEPRINT_ENTITIES } from "@/shared/blueprints/blueprint-input-limits";
import { convertGameBlueprint, isGameBlueprint } from "@/shared/game-blueprint";
import { rotateGridEdge } from "@/shared/geometry/port";

const registry = createRegistryContract();

function blueprint(nodes: unknown[], width = 20, depth = 20) {
  return { name: "游戏蓝图", bp_size: { x_len: width, z_len: depth }, nodes };
}

function device(
  node_id: number,
  template_id: string,
  coms: unknown[],
  options: { x?: number; z?: number; yaw?: number; product_icon?: string } = {},
) {
  return {
    node_id, template_id, coms, product_icon: options.product_icon,
    transform: {
      interactive_param: {
        position: { x: options.x ?? 2.5, z: options.z ?? 2.5 },
        rotation: { y: options.yaw },
      },
    },
  };
}

function line(
  node_id: number,
  template_id: "grid_belt_01" | "log_pipe_01",
  points: readonly object[],
  enter = 90,
  exit = 90,
) {
  return { node_id, template_id, transform: { points, direction_in: { y: enter }, direction_out: { y: exit } } };
}

describe("游戏蓝图正向转换", () => {
  it("完整交换文件和裸正文产生等价的原生布局，并遵守显式基地", () => {
    const body = blueprint([
      device(1, "unloader_1", [{ selector: { selected_item_id: "item_copper_ore" } }], {
        x: 1.5, z: 2.5, yaw: 90,
      }),
    ]);
    const wrapped = { format: "akeblueprint/1", blue_print_data: body, share_code: "ignored" };
    expect(isGameBlueprint(wrapped)).toBe(true);
    expect(isGameBlueprint(body)).toBe(true);
    expect(isGameBlueprint({ blue_print_data: body })).toBe(false);
    const bare = convertGameBlueprint(body, registry);
    const alternate = convertGameBlueprint(wrapped, registry, { baseId: "wuling_old_dam_construction_site" });
    expect(bare.baseId).toBe("draft_box");
    expect(alternate.baseId).toBe("wuling_old_dam_construction_site");
    expect(normalizeBlueprintDocument(JSON.parse(JSON.stringify(alternate)))).toEqual(alternate);
    expect(alternate.entities).toEqual(bare.entities);
    expect(alternate.slotLinks).toEqual(bare.slotLinks);
    expect(bare.entities["game-node:1"]).toMatchObject({ position: { x: 1, y: 16 }, rotation: 90 });
    expect(bare.slotLinks).toEqual([expect.objectContaining({
      source: { entityId: "game-node:1", storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
      target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: "item_copper_ore" },
    })]);
  });

  it("将折线逐格还原并保留同点转角、首尾流向及带管重叠", () => {
    const { entities, entityOrder } = convertGameBlueprint(blueprint([
      line(1, "grid_belt_01", [{ x: 1, z: 1 }, { x: 3, z: 1 }, { x: 3, z: 2 }], 90, 0),
      line(2, "log_pipe_01", [{ x: 3, z: 1 }, { x: 3, z: 1 }], 0, 90),
      line(3, "grid_belt_01", [{ x: 8, z: 1 }], 270, 270),
    ]), registry);
    expect(entityOrder.map((id) => entities[id]!.position)).toEqual([
      { x: 1, y: 18 }, { x: 2, y: 18 }, { x: 3, y: 18 }, { x: 3, y: 17 },
      { x: 3, y: 18 }, { x: 8, y: 18 },
    ]);
    expect(entityOrder.map((id) => {
      const { definitionId, rotation } = entities[id]!;
      const definition = registry.queries.findEntityDefinition(definitionId)!;
      return definition.portGroups.map((group) => rotateGridEdge(group.ports[0]!.edge, rotation));
    })).toEqual([
      ["WEST", "EAST"], ["WEST", "EAST"], ["WEST", "NORTH"], ["SOUTH", "NORTH"],
      ["SOUTH", "EAST"], ["EAST", "WEST"],
    ]);
    expect(registry.queries.isBelt(entities["game-node:1:2"]!.definitionId)).toBe(true);
    expect(registry.queries.isPipe(entities["game-node:2:0"]!.definitionId)).toBe(true);
  });

  it("准入口原样写入每分钟限额，关闭限速仍保留选料", () => {
    const { entities } = convertGameBlueprint(blueprint([
      device(1, "log_pipe_conditioner", [{
        fluid_valve: { selected_item_id: "item_gas_xiranite", speed_limit_enable: true, speed_limit: 18 },
      }]),
      device(2, "log_pipe_conditioner", [{
        fluid_valve: { selected_item_id: "item_gas_xiranite", speed_limit: 6 },
      }]),
      device(3, "log_conditioner", [{ box_valve: { selected_item_id: "item_copper_hui" } }]),
    ]), registry);
    expect(entities["game-node:1"]!.config["portGroups[0].ports[0].admissionRule"])
      .toEqual({ itemId: "item_gas_xiranite", limit: null, perMinuteLimit: 18 });
    expect(entities["game-node:2"]!.config).toEqual({
      "portGroups[0].ports[0].admissionRule": { itemId: "item_gas_xiranite", limit: null, perMinuteLimit: null },
      "portGroups[0].ports[0].acceptRule": { base: { kind: "item", itemId: "item_gas_xiranite" }, exclude: [] },
    });
    expect(entities["game-node:3"]!.definitionId).toBe("log_admission");
  });

  it("保留工艺变体、唯一匹配的显式产物及投影通道顺序", () => {
    const { entities } = convertGameBlueprint(blueprint([
      device(1, "transmuter_2", [{ formula_man: { cur_mode: "gastrans" } }]),
      device(2, "transmuter_2", [{ formula_man: { cur_mode: "solidtrans" } }]),
      device(3, "furnance_1", [{ formula_man: { cur_mode: "liquid" } }], {
        product_icon: "item_copper_nugget",
      }),
      device(4, "component_mc_1", [{ formula_man: { cur_mode: "normal" } }], {
        product_icon: "item_copper_hui_cmpt",
      }),
      device(5, "component_mc_1", [{ formula_man: { cur_mode: "normal" } }]),
      device(6, "magic_spawner_2", [{ formation_stake: { selected_formation_ids: ["magic_hui", "magic_ming"] } }]),
      device(7, "magic_spawner_2", [{ formation_stake: {} }]),
    ]), registry);
    expect(entities["game-node:1"]).toMatchObject({ definitionId: "transmuter_2_gastrans" });
    expect(entities["game-node:2"]).toMatchObject({ definitionId: "transmuter_2_solidtrans" });
    expect(entities["game-node:3"]).toMatchObject({
      definitionId: "furnance_1_liquid",
      config: { channelRecipes: { default: "r_chrono_liquid_furnace_refined_copper_from_copper_ore_basic" } },
    });
    expect(entities["game-node:4"]).toMatchObject({
      definitionId: "cmpt_mc_1",
      config: { channelRecipes: { default: "component_copper_hui_cmpt_1" } },
    });
    expect(entities["game-node:5"]!.config).toEqual({});
    expect(entities["game-node:6"]!.config).toEqual({
      channelRecipes: { east: "r_bipolar_magic_spawner_hui", south: "r_bipolar_magic_spawner_ming" },
    });
    expect(entities["game-node:7"]!.config).toEqual({});
  });

  it("互指暗管生成一条出口指向入口的本地链接，未配对端保留设备", () => {
    const { slotLinks } = convertGameBlueprint(blueprint([
      device(1, "udpipe_loader_1", [{ fluid_ud_pipe: { peer_blueprint_node_id: 2 } }]),
      device(2, "udpipe_unloader_1", [{ fluid_ud_pipe: { peer_blueprint_node_id: 1 } }]),
      device(3, "udpipe_loader_1", [{ fluid_ud_pipe: {} }]),
    ]), registry);
    expect(slotLinks).toEqual([expect.objectContaining({
      source: { entityId: "game-node:2", storageSlotGroupId: "transport_input", slotId: "slot_1" },
      target: { entityId: "game-node:1", storageSlotGroupId: "loader_buffer", slotId: "slot_1" },
    })]);
    expect(() => convertGameBlueprint(blueprint([
      device(1, "udpipe_loader_1", [{ fluid_ud_pipe: { peer_blueprint_node_id: 2 } }]),
    ]), registry)).toThrow(/dark pipe pairing.*1.*2/);
  });

  it("允许恰好满额的线路，并在分配前拒绝超额的线路与坐标", () => {
    const full = line(1, "grid_belt_01", [{}, { x: MAX_BLUEPRINT_ENTITIES - 1 }]);
    const tooLong = line(1, "grid_belt_01", [{}, { x: MAX_BLUEPRINT_ENTITIES }]);
    expect(convertGameBlueprint(blueprint([full], MAX_BLUEPRINT_ENTITIES, 1), registry).entityOrder)
      .toHaveLength(MAX_BLUEPRINT_ENTITIES);
    expect(() => convertGameBlueprint(blueprint([tooLong], MAX_BLUEPRINT_ENTITIES + 1, 1), registry))
      .toThrow(/node 1.*20000 entities/);
    expect(() => convertGameBlueprint(blueprint([
      device(2, "log_conditioner", []), full,
    ], MAX_BLUEPRINT_ENTITIES, 20), registry)).toThrow(/node 1.*20000 entities/);
    expect(() => convertGameBlueprint(blueprint([
      line(1, "grid_belt_01", [{}, { x: 100_001 }]),
    ], 100_002, 1), registry)).toThrow(/node 1.*coordinate exceeds 100000/);
  });

  it("遇到无法识别的模板、产物或基地时给出具体错误", () => {
    expect(() => convertGameBlueprint(blueprint([device(1, "unknown_game_device", [])]), registry))
      .toThrow(/node 1.*unknown_game_device.*Unsupported device template/);
    expect(() => convertGameBlueprint(blueprint([
      device(1, "component_mc_1", [{ formula_man: { cur_mode: "normal" } }], { product_icon: "item_copper_ore" }),
    ]), registry)).toThrow(/node 1.*product_icon=item_copper_ore/);
    expect(() => convertGameBlueprint(blueprint([]), registry, { baseId: "missing_base" }))
      .toThrow(/baseId: missing_base/);
  });
});
