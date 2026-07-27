import { describe, expect, it } from "vitest";

import {
  isLogisticsDefinitionSuppressed,
  resolveLogisticsEquipmentSuppressionKind,
  resolveLogisticsSuppressionKind,
} from "@/shared/logistics-suppression";
import { createRegistryContract } from "@/registry";

const queries = createRegistryContract().queries;

describe("logistics suppression families", () => {
  it.each([
    ["belt_straight_1x1", "belt"],
    ["belt_turn_cw_1x1", "belt"],
    ["belt_turn_ccw_1x1", "belt"],
    ["log_connector", "belt"],
    ["log_converger", "belt"],
    ["log_splitter", "belt"],
    ["log_admission", "belt"],
    ["pipe_straight_1x1", "pipe"],
    ["pipe_turn_cw_1x1", "pipe"],
    ["pipe_turn_ccw_1x1", "pipe"],
    ["pipe_connector", "pipe"],
    ["pipe_converger", "pipe"],
    ["pipe_splitter", "pipe"],
    ["pipe_admission", "pipe"],
  ] as const)("classifies %s as %s suppression", (definitionId, family) => {
    expect(resolveLogisticsSuppressionKind(definitionId, queries)).toBe(family);
  });

  it.each([
    ["log_connector", "belt"],
    ["log_converger", "belt"],
    ["log_splitter", "belt"],
    ["log_admission", "belt"],
    ["pipe_connector", "pipe"],
    ["pipe_converger", "pipe"],
    ["pipe_splitter", "pipe"],
    ["pipe_admission", "pipe"],
  ] as const)("classifies %s as a %s accessory", (definitionId, family) => {
    expect(resolveLogisticsEquipmentSuppressionKind(definitionId, queries)).toBe(family);
  });

  it("keeps ordinary logistics segments out of the accessory visual family", () => {
    expect(resolveLogisticsEquipmentSuppressionKind("belt_straight_1x1", queries)).toBeNull();
    expect(resolveLogisticsEquipmentSuppressionKind("pipe_turn_ccw_1x1", queries)).toBeNull();
  });

  it("applies only the matching family suppression switch", () => {
    expect(isLogisticsDefinitionSuppressed({
      definitionId: "log_admission",
      suppressBelts: true,
      suppressPipes: false,
      queries,
    })).toBe(true);
    expect(isLogisticsDefinitionSuppressed({
      definitionId: "pipe_admission",
      suppressBelts: true,
      suppressPipes: false,
      queries,
    })).toBe(false);
  });
});
