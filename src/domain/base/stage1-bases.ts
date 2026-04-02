import type { GridPoint } from "@/shared/geometry/grid";

export type Stage1BaseId =
  | "wuling_protocol_core"
  | "wuling_tianwangping_aid"
  | "valley4_protocol_core"
  | "valley4_refugee_shelter"
  | "valley4_infra_outpost"
  | "valley4_rebuilt_command";

export interface Stage1LocalizedText {
  "zh-CN": string;
  "en-US": string;
}

export interface Stage1BaseDefinition {
  id: Stage1BaseId;
  groupId: "wuling" | "valley4";
  groupLabel: Stage1LocalizedText;
  name: Stage1LocalizedText;
  placeableSize: number;
  outerRing: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export const DEFAULT_STAGE1_BASE_ID: Stage1BaseId = "wuling_protocol_core";

export const STAGE1_BASE_DEFINITIONS: Stage1BaseDefinition[] = [
  {
    id: "wuling_protocol_core",
    groupId: "wuling",
    groupLabel: {
      "zh-CN": "武陵",
      "en-US": "Wuling",
    },
    name: {
      "zh-CN": "协议核心区",
      "en-US": "Protocol Core",
    },
    placeableSize: 80,
    outerRing: { top: 4, right: 4, bottom: 4, left: 4 },
  },
  {
    id: "wuling_tianwangping_aid",
    groupId: "wuling",
    groupLabel: {
      "zh-CN": "武陵",
      "en-US": "Wuling",
    },
    name: {
      "zh-CN": "天王坪援建点",
      "en-US": "Tianwangping Aid Site",
    },
    placeableSize: 50,
    outerRing: { top: 4, right: 4, bottom: 4, left: 4 },
  },
  {
    id: "valley4_protocol_core",
    groupId: "valley4",
    groupLabel: {
      "zh-CN": "四号谷地",
      "en-US": "Valley 4",
    },
    name: {
      "zh-CN": "协议核心区",
      "en-US": "Protocol Core",
    },
    placeableSize: 70,
    outerRing: { top: 4, right: 2, bottom: 2, left: 4 },
  },
  {
    id: "valley4_refugee_shelter",
    groupId: "valley4",
    groupLabel: {
      "zh-CN": "四号谷地",
      "en-US": "Valley 4",
    },
    name: {
      "zh-CN": "难民暂居处",
      "en-US": "Refugee Shelter",
    },
    placeableSize: 40,
    outerRing: { top: 4, right: 0, bottom: 0, left: 0 },
  },
  {
    id: "valley4_infra_outpost",
    groupId: "valley4",
    groupLabel: {
      "zh-CN": "四号谷地",
      "en-US": "Valley 4",
    },
    name: {
      "zh-CN": "基建前站",
      "en-US": "Infra Outpost",
    },
    placeableSize: 40,
    outerRing: { top: 4, right: 0, bottom: 0, left: 0 },
  },
  {
    id: "valley4_rebuilt_command",
    groupId: "valley4",
    groupLabel: {
      "zh-CN": "四号谷地",
      "en-US": "Valley 4",
    },
    name: {
      "zh-CN": "重建指挥部",
      "en-US": "Rebuild Command",
    },
    placeableSize: 40,
    outerRing: { top: 4, right: 0, bottom: 0, left: 0 },
  },
];

export const STAGE1_BASE_DEFINITION_BY_ID: Record<Stage1BaseId, Stage1BaseDefinition> =
  Object.fromEntries(
    STAGE1_BASE_DEFINITIONS.map((base) => [base.id, base]),
  ) as Record<Stage1BaseId, Stage1BaseDefinition>;

export function getStage1BaseDefinition(
  baseId: Stage1BaseId,
): Stage1BaseDefinition {
  return STAGE1_BASE_DEFINITION_BY_ID[baseId];
}

export function getStage1BaseGroupOrder(): Array<Stage1BaseDefinition["groupId"]> {
  return ["valley4", "wuling"];
}

export function formatStage1BaseArea(base: Stage1BaseDefinition): string {
  return `${base.placeableSize}x${base.placeableSize}`;
}

export function formatStage1BaseExpansion(base: Stage1BaseDefinition): string {
  return `T${base.outerRing.top} R${base.outerRing.right} B${base.outerRing.bottom} L${base.outerRing.left}`;
}

export function isStage1FootprintWithinBase(options: {
  base: Stage1BaseDefinition;
  position: GridPoint;
  footprint: {
    width: number;
    height: number;
  };
}): boolean {
  const { base, position, footprint } = options;

  return (
    position.x >= 0 &&
    position.y >= 0 &&
    position.x + footprint.width <= base.placeableSize &&
    position.y + footprint.height <= base.placeableSize
  );
}