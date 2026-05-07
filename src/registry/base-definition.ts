import type { BaseDefinition } from "@/domain/registry/types/base-definition";

export const BASE_DEFINITIONS: BaseDefinition[] = [
  {
    id: "wuling_protocol_core",
    placeableArea: {
      width: 80,
      height: 80,
    },
    outerRing: {
      top: 4,
      right: 4,
      bottom: 4,
      left: 4,
    },
    tag: "武陵",
  },
  {
    id: "wuling_tianwangping_aid",
    placeableArea: {
      width: 50,
      height: 50,
    },
    outerRing: {
      top: 4,
      right: 4,
      bottom: 4,
      left: 4,
    },
    tag: "武陵",
  },
  {
    id: "valley4_protocol_core",
    placeableArea: {
      width: 70,
      height: 70,
    },
    outerRing: {
      top: 4,
      right: 2,
      bottom: 2,
      left: 4,
    },
    tag: "四号谷地",
  },
  {
    id: "valley4_refugee_shelter",
    placeableArea: {
      width: 40,
      height: 40,
    },
    outerRing: {
      top: 4,
      right: 0,
      bottom: 0,
      left: 0,
    },
    tag: "四号谷地",
  },
  {
    id: "valley4_infra_outpost",
    placeableArea: {
      width: 40,
      height: 40,
    },
    outerRing: {
      top: 4,
      right: 0,
      bottom: 0,
      left: 0,
    },
    tag: "四号谷地",
  },
  {
    id: "valley4_rebuilt_command",
    placeableArea: {
      width: 40,
      height: 40,
    },
    outerRing: {
      top: 4,
      right: 0,
      bottom: 0,
      left: 0,
    },
    tag: "四号谷地",
  },
];