import { describe, expect, it } from "vitest";

import type { PeriodicRangeConversionSource } from "@/domain/registry/types/periodic-range-conversion";
import { CUSTOM_PERIODIC_PHASE_CHANNEL_ID, isManualRecipeChannel, isRecipeAvailableInChannel } from "@/shared/registry/recipe-channel-eligibility";

const effect = { probabilityByLayer: [1], outputItemByInputId: { "fixture-input": "fixture-output" } };
const source: PeriodicRangeConversionSource = {
  rangeIds: ["fixture-range"],
  side: 0,
  program: { id: "fixture-program", periodSeconds: 2, effects: [effect, effect, effect] },
};
const phase = { periodicRangeConversion: source };

describe("自定义周期配方频道", () => {
  it("同一设备中的自定义相位配方和普通配方只能在各自的频道执行", () => {
    const channels = [{ id: "fixture-automatic" }, { id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID }];
    expect(isRecipeAvailableInChannel(phase, CUSTOM_PERIODIC_PHASE_CHANNEL_ID, channels)).toBe(true);
    expect(isRecipeAvailableInChannel(phase, "fixture-automatic", channels)).toBe(false);
    expect(isRecipeAvailableInChannel({}, CUSTOM_PERIODIC_PHASE_CHANNEL_ID, channels)).toBe(false);
    expect(isRecipeAvailableInChannel({}, "fixture-automatic", channels)).toBe(true);
  });

  it("在设备全局切换为自动模式时仍须手动选择周期相位", () => {
    expect(isManualRecipeChannel({ id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID, manualRecipeOnly: true }, true)).toBe(true);
    expect(isManualRecipeChannel({ id: "fixture-existing", manualRecipeOnly: true }, true)).toBe(false);
  });

  it("保留未声明自定义周期频道时的既有周期配方", () => {
    expect(isRecipeAvailableInChannel(phase, "fixture-existing", [{ id: "fixture-existing" }])).toBe(true);
  });
});
