import type { BaseDefinition } from "@/domain/registry/types/base-definition";
import type { BaseBuiltinEntityDefinition } from "@/domain/registry/types/base-definition";
import { WULING_FENCE_BUILTIN_ENTITIES } from "./wuling-fence-definition";
// AI-REMOVED 2026-10-12:
// Reason: 跨地区设备权限由设备白名单承担。
// Trigger: 用户确认设备地图与区域白名单重构。
// Evidence: allRegionEntities 已退出资格计算。
// Replacement: DRAFT_BOX_BASE_TAG 保留协议核心生命周期用途
// Risk: 旧标签不再提供放置资格；现有设备权限已迁入白名单。
// Human Review: Required
//
// Original code:
// import { ALL_REGION_ENTITIES_BASE_TAG, DRAFT_BOX_BASE_TAG } from "@/shared/base-tags";
import { DRAFT_BOX_BASE_TAG } from "@/shared/base-tags";

const VALLEY4_BUILTIN_BUS_SOURCE_ID = "valley4_bus_source";
const WAREHOUSE_BUS_SEED_CONFIG_KEY = "warehouseBusSeed";

/** 四号谷地小基地（难民前哨处、基建前站、重建指挥部）共用：X 方向 5 个基段，从 (0,-4) 向右排布。 */
function createValley4SmallBaseBuiltinEntities(): readonly BaseBuiltinEntityDefinition[] {
  const entities: BaseBuiltinEntityDefinition[] = [];

  for (let index = 0; index < 5; index += 1) {
    entities.push({
      id: `valley4_bus_seg_x_${index}`,
      definitionId: "log_hongs_bus",
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
      definitionId: "log_hongs_bus_source",
      position: { x: -4, y: -4 },
      rotation: 0,
    },
  ];

  for (let index = 0; index < 9; index += 1) {
    entities.push({
      id: `valley4_bus_seg_x_${index}`,
      definitionId: "log_hongs_bus",
      position: { x: index * 8, y: -4 },
      rotation: 90,
    });
  }

  for (let index = 0; index < 9; index += 1) {
    entities.push({
      id: `valley4_bus_seg_y_${index}`,
      definitionId: "log_hongs_bus",
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
    tags: ["maxPipeLogistics=128"],
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
    tags: ["maxPipeLogistics=64"],
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
    tags: ["maxPipeLogistics=64"],
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
    tags: ["maxPipeLogistics=64"],
  },
  {
    id: "wuling_agricultural_land",
    name: "农牧用地",
    nameplate: "武陵农用地",
    placeableArea: { width: 44, height: 44 },
    builtinEntities: WULING_FENCE_BUILTIN_ENTITIES,
    outerRing: { top: 20, right: 20, bottom: 20, left: 20 },
    subAreas: [{
      id: "wuling_yuanyuan_zhuang",
      nameplate: "缘缘庄",
      // 两块外围区域各宽 40 格，外围之间再留 10 格。
      // AI-CORRECTION 2026-10-11: 两区域改为 44×44 与 38×38、各向外扩 20 格，外扩边界间隔 20 格。
      position: { x: 104, y: 0 },
      placeableArea: { width: 38, height: 38 },
      outerRing: { top: 20, right: 20, bottom: 20, left: 20 },
    }],
    tag: "武陵",
    tags: [],
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
    tags: [],
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
    tags: [],
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
    tags: [],
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
    tags: [],
    builtinEntities: createValley4SmallBaseBuiltinEntities(),
  },
  {
    id: "draft_box",
    name: "草稿箱",
    placeableArea: { width: 320, height: 320 },
    outerRing: { top: 20, right: 20, bottom: 20, left: 20 },
    // AI-REMOVED 2026-09-28:
    // Reason: 草稿箱取消左上角独立外环区。
    // Trigger: 用户要求删除该区域并更新对应测试。
    // Evidence: draft_box 改为仅保留主区域。
    // Replacement: 本对象的 placeableArea 与 outerRing。
    // Risk: 原独立区域内已有设备将判定为越界。
    // Human Review: Required
    // Original code:
    // subAreas: [{
    //   id: "draft_box_upper_left",
    //   position: { x: -60, y: -60 },
    //   placeableArea: { width: 0, height: 0 },
    //   outerRing: { top: 20, right: 20, bottom: 20, left: 20 },
    // }],
    tag: "草稿箱",
// AI-REMOVED 2026-10-12:
// Reason: 草稿箱不再通过标签放宽设备地理资格。
// Trigger: 用户确认设备地图与区域白名单重构。
// Evidence: 保留原有地区设备的草稿箱资格。
// Replacement: 设备 placementWhitelist 中的 draft_box 条目
// Risk: 旧标签不再提供放置资格；现有设备权限已迁入白名单。
// Human Review: Required
//
// Original code:
//     tags: [ALL_REGION_ENTITIES_BASE_TAG, DRAFT_BOX_BASE_TAG],
    tags: [DRAFT_BOX_BASE_TAG],
  },
];
