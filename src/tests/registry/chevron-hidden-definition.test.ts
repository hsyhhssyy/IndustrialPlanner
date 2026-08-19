import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";

const CHEVRON_HIDDEN_DEFINITION_IDS = [
  "belt_straight_1x1",
  "belt_turn_cw_1x1",
  "belt_turn_ccw_1x1",
  "pipe_straight_1x1",
  "pipe_turn_cw_1x1",
  "pipe_turn_ccw_1x1",
  "log_connector",
  "pipe_connector",
  "cheat_infinite_solid",
  "cheat_infinite_liquid",
  "cheat_infinite_gas",
] as const;

describe("ChevronHidden entity definitions", () => {
  it("由十一种已确认定义统一声明模式化端口提示语义", () => {
    const registry = createRegistryContract();
    const actualIds = registry.entityDefinitions
      .filter((definition) => definition.tags.includes("ChevronHidden"))
      .map((definition) => definition.id)
      .sort();

    expect(actualIds).toEqual([...CHEVRON_HIDDEN_DEFINITION_IDS].sort());
  });
});
