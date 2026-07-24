import { describe, expect, it } from "vitest";

import {
  isLogisticsDefinitionSuppressed,
  resolveAccessoryLogisticsSuppressionFamily,
  resolveLogisticsSuppressionFamily,
} from "@/shared/logistics-suppression";

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
    expect(resolveLogisticsSuppressionFamily(definitionId)).toBe(family);
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
    expect(resolveAccessoryLogisticsSuppressionFamily(definitionId)).toBe(family);
  });

  it("keeps ordinary logistics segments out of the accessory visual family", () => {
    expect(resolveAccessoryLogisticsSuppressionFamily("belt_straight_1x1")).toBeNull();
    expect(resolveAccessoryLogisticsSuppressionFamily("pipe_turn_ccw_1x1")).toBeNull();
  });

  it("applies only the matching family suppression switch", () => {
    expect(isLogisticsDefinitionSuppressed({
      definitionId: "log_admission",
      suppressBelts: true,
      suppressPipes: false,
    })).toBe(true);
    expect(isLogisticsDefinitionSuppressed({
      definitionId: "pipe_admission",
      suppressBelts: true,
      suppressPipes: false,
    })).toBe(false);
  });
});
