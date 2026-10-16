import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { BaseBuiltinEntityDefinition } from "@/domain/registry/types/base-definition";
import fenceLayouts from "./agricultural-fence-layouts.json";

/** 场景围栏只有静态外观与占地；长度规格沿用现有固定 footprint 模型。 */
export const WULING_FENCE_DEFINITIONS: EntityDefinition[] = [
  { id: "wuling_fence_rail_5", width: 5 },
  { id: "wuling_fence_rail_2", width: 2 },
  { id: "wuling_fence_rail_3", width: 3 },
  { id: "wuling_fence_post", width: 1 },
].map(({ id, width }): EntityDefinition => ({
  id,
  nameKey: `registry.entity.${id}.name`,
  spriteId: id,
  iconPath: `3d-top-view/sprites/${id}.webp`,
  footprint: { width, height: 1 },
  spriteOffset: {
    topView: { x: -1, y: -1, width: width + 2, height: 3 },
    blueprint: { x: -1, y: -1, width: width + 2, height: 3 },
  },
  uiGroup: "hidden",
  displayOrder: 100,
  tags: ["AvatarHidden"],
  placementWhitelist: [{ baseId: "wuling_agricultural_land" }],
  requiresPower: false,
  powerDemand: 0,
  inspectors: [],
  placementBehaviors: [],
  portGroups: [],
  storageSlotGroups: [],
  recipeChannels: [],
  portStorageBindings: [],
}));

/**
 * 来源：素材网站 wuling-agricultural-fields/layout.json；v1.5-20261014-irrigation。
 * 布局 SHA-256：2f0348cdf51ade9e4988aca1b6aa57e22aac9ceafcade6686d24cc29bab036f7。
 * 原布局 X 向东、Z 向北；转换为屏幕 Y 向下，并让内部净空对齐现有 (0,0)–(44,44)。
 * 2026-10-15 用户要求先按占地试摆，暂不应用 renderCenterGridXZ 的半格视觉偏移。
 * AI-CORRECTION 2026-10-17: 改用 fences 专题的 cell-center-v1，两地布局来自经过批次校验的 Registry 数据，均无视觉偏移。
 */
// AI-REMOVED 2026-10-17:
// Reason: 手写布局被同一来源批次生成的两地布局数据替代，避免重复维护坐标。
// Trigger: 用户要求按当前 cell-center-v1 数据导入武陵与缘缘庄围栏。
// Evidence: 38 件武陵布局与网站逐项一致；缘缘庄新增 36 件，均通过占地、中心和入口验收。
// Replacement: agricultural-fence-layouts.json 及下方两个导出。
// Risk: 低；武陵原坐标与朝向保持不变。
// Human Review: Required
//
// Original code:
// export const WULING_FENCE_BUILTIN_ENTITIES: readonly BaseBuiltinEntityDefinition[] = [
//   { id: "fence_R01", definitionId: "wuling_fence_rail_5", position: { x: -1, y: -1 }, rotation: 0 },
//   { id: "fence_R02", definitionId: "wuling_fence_rail_5", position: { x: 4, y: -1 }, rotation: 0 },
//   { id: "fence_R03", definitionId: "wuling_fence_rail_5", position: { x: 9, y: -1 }, rotation: 0 },
//   { id: "fence_R04", definitionId: "wuling_fence_rail_5", position: { x: 14, y: -1 }, rotation: 0 },
//   { id: "fence_R05", definitionId: "wuling_fence_rail_5", position: { x: 19, y: -1 }, rotation: 0 },
//   { id: "fence_R06", definitionId: "wuling_fence_rail_5", position: { x: 24, y: -1 }, rotation: 0 },
//   { id: "fence_R07", definitionId: "wuling_fence_rail_5", position: { x: 29, y: -1 }, rotation: 0 },
//   { id: "fence_R08", definitionId: "wuling_fence_rail_5", position: { x: 34, y: -1 }, rotation: 0 },
//   { id: "fence_R09", definitionId: "wuling_fence_rail_5", position: { x: 39, y: -1 }, rotation: 0 },
//   { id: "fence_R10", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 39 }, rotation: 90 },
//   { id: "fence_R11", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 34 }, rotation: 90 },
//   { id: "fence_R12", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 29 }, rotation: 90 },
//   { id: "fence_R13", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 24 }, rotation: 90 },
//   { id: "fence_R14", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 19 }, rotation: 90 },
//   { id: "fence_R15", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 14 }, rotation: 90 },
//   { id: "fence_R16", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 9 }, rotation: 90 },
//   { id: "fence_R17", definitionId: "wuling_fence_rail_5", position: { x: 44, y: 4 }, rotation: 90 },
//   { id: "fence_R18", definitionId: "wuling_fence_rail_5", position: { x: 44, y: -1 }, rotation: 90 },
//   { id: "fence_R19", definitionId: "wuling_fence_rail_5", position: { x: 0, y: 44 }, rotation: 0 },
//   { id: "fence_R20", definitionId: "wuling_fence_rail_2", position: { x: 5, y: 44 }, rotation: 180 },
//   { id: "fence_R21", definitionId: "wuling_fence_rail_3", position: { x: 7, y: 44 }, rotation: 180 },
//   { id: "fence_R22", definitionId: "wuling_fence_rail_5", position: { x: 10, y: 44 }, rotation: 0 },
//   { id: "fence_R23", definitionId: "wuling_fence_rail_5", position: { x: 25, y: 44 }, rotation: 0 },
//   { id: "fence_R24", definitionId: "wuling_fence_rail_5", position: { x: 30, y: 44 }, rotation: 0 },
//   { id: "fence_R25", definitionId: "wuling_fence_rail_5", position: { x: 35, y: 44 }, rotation: 0 },
//   { id: "fence_R26", definitionId: "wuling_fence_rail_5", position: { x: 40, y: 44 }, rotation: 0 },
//   { id: "fence_R27", definitionId: "wuling_fence_rail_5", position: { x: -1, y: 40 }, rotation: 90 },
//   { id: "fence_R28", definitionId: "wuling_fence_rail_5", position: { x: -1, y: 25 }, rotation: 90 },
//   { id: "fence_R29", definitionId: "wuling_fence_rail_5", position: { x: -1, y: 20 }, rotation: 90 },
//   { id: "fence_R30", definitionId: "wuling_fence_rail_5", position: { x: -1, y: 15 }, rotation: 90 },
//   { id: "fence_R31", definitionId: "wuling_fence_rail_5", position: { x: -1, y: 10 }, rotation: 90 },
//   { id: "fence_R32", definitionId: "wuling_fence_rail_5", position: { x: -1, y: 5 }, rotation: 90 },
//   { id: "fence_R33", definitionId: "wuling_fence_rail_2", position: { x: -1, y: 3 }, rotation: 90 },
//   { id: "fence_R34", definitionId: "wuling_fence_rail_3", position: { x: -1, y: 0 }, rotation: 90 },
//   { id: "fence_P01", definitionId: "wuling_fence_post", position: { x: 4, y: 44 }, rotation: 0 },
//   { id: "fence_P02", definitionId: "wuling_fence_post", position: { x: 14, y: 44 }, rotation: 0 },
//   { id: "fence_P03", definitionId: "wuling_fence_post", position: { x: 44, y: 44 }, rotation: 0 },
//   { id: "fence_P04", definitionId: "wuling_fence_post", position: { x: -1, y: 29 }, rotation: 0 },
// ];

export const WULING_FENCE_BUILTIN_ENTITIES =
  fenceLayouts.layouts.wuling.entities as readonly BaseBuiltinEntityDefinition[];

/** 缘缘庄与主地块共用围栏规格；位置已转换到农牧用地的统一世界坐标。 */
export const YUANYUAN_FENCE_BUILTIN_ENTITIES =
  fenceLayouts.layouts.yuanyuan.entities as readonly BaseBuiltinEntityDefinition[];
