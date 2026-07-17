import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { BaseBuiltinEntityDefinition } from "@/domain/registry/types/base-definition";

const VALLEY4_BUILTIN_BUS_SOURCE_ID = "valley4_bus_source";
const WAREHOUSE_BUS_SEED_CONFIG_KEY = "warehouseBusSeed";

/** 四号谷地小基地（难民前哨处、基建前站、重建指挥部）共用：X 方向 5 个基段，从 (0,-4) 向右排布。 */
function createValley4SmallBaseBuiltinEntities(): readonly BaseBuiltinEntityDefinition[] {
  const entities: BaseBuiltinEntityDefinition[] = [];

  for (let index = 0; index < 5; index += 1) {
    entities.push({
      id: `valley4_bus_seg_x_${index}`,
      definitionId: "item_port_log_hongs_bus",
      position: { x: index * 8, y: -4 },
      rotation: 90,
      config: index === 0 ? { [WAREHOUSE_BUS_SEED_CONFIG_KEY]: true } : undefined,
    });
  }

  return entities;
}

/**
 * 四号谷地协议核心区专用内置设备：源桩 + X/Y 各 9 个基段。
 *
 * 源桩 4×4 位于 (-4,-4)。
 * X 方向 9 个基段（4×8）从 (0,-4) 向右排布到 (32,-4)。
 * Y 方向 9 个基段（4×8）从 (-4,0) 向下排布到 (-4,64)。
 */
function createValley4ProtocolCoreBuiltinEntities(): readonly BaseBuiltinEntityDefinition[] {
  const entities: BaseBuiltinEntityDefinition[] = [
    {
      id: VALLEY4_BUILTIN_BUS_SOURCE_ID,
      definitionId: "item_port_log_hongs_bus_source",
      position: { x: -4, y: -4 },
      rotation: 0,
    },
  ];

  for (let index = 0; index < 9; index += 1) {
    entities.push({
      id: `valley4_bus_seg_x_${index}`,
      definitionId: "item_port_log_hongs_bus",
      position: { x: index * 8, y: -4 },
      rotation: 90,
    });
  }

  for (let index = 0; index < 9; index += 1) {
    entities.push({
      id: `valley4_bus_seg_y_${index}`,
      definitionId: "item_port_log_hongs_bus",
      position: { x: -4, y: index * 8 },
      rotation: 0,
    });
  }

  return entities;
}

export const BASE_DEFINITIONS: BaseDefinition[] = [
  {
    id: "wuling_protocol_core",
    name: "协议核心区",
    placeableArea: {
      width: 80,
      height: 80,
    },
    outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    tag: "武陵",
  },
  {
    id: "wuling_tianwangping_aid",
    name: "天王坪援建点",
    placeableArea: {
      width: 50,
      height: 50,
    },
    outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    tag: "武陵",
  },
  {
    id: "wuling_heart_repair_station",
    name: "心脏修缮站",
    placeableArea: {
      width: 50,
      height: 50,
    },
    outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    tag: "武陵",
  },
  {
    id: "stm_hongs_3",
    name: "盈天台建设站",
    placeableArea: {
      width: 50,
      height: 50,
    },
    outerRing: {
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    },
    tag: "武陵",
  },
  {
    id: "valley4_protocol_core",
    name: "协议核心区",
    placeableArea: {
      width: 70,
      height: 70,
    },
    outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    tag: "四号谷地",
    builtinEntities: createValley4ProtocolCoreBuiltinEntities(),
  },
  {
    id: "valley4_refugee_shelter",
    name: "难民暂居处",
    placeableArea: {
      width: 40,
      height: 40,
    },
    outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    tag: "四号谷地",
    builtinEntities: createValley4SmallBaseBuiltinEntities(),
  },
  {
    id: "valley4_infra_outpost",
    name: "基建前站",
    placeableArea: {
      width: 40,
      height: 40,
    },
    outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    tag: "四号谷地",
    builtinEntities: createValley4SmallBaseBuiltinEntities(),
  },
  {
    id: "valley4_rebuilt_command",
    name: "重建指挥部",
    placeableArea: {
      width: 40,
      height: 40,
    },
    outerRing: {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    },
    tag: "四号谷地",
    builtinEntities: createValley4SmallBaseBuiltinEntities(),
  },
];
