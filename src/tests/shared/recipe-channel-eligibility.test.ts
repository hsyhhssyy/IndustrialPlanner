import { describe, expect, it } from "vitest";

import type { PeriodicRangeConversionSource } from "@/domain/registry/types/periodic-range-conversion";
import { CUSTOM_PERIODIC_PHASE_CHANNEL_ID, isManualRecipeChannel, isRecipeAvailableInChannel } from "@/shared/registry/recipe-channel-eligibility";

const source: PeriodicRangeConversionSource = {
  rangeIds: ["fixture-range"],
  side: 0,
  programId: "fixture-program",
};
const phase = { machineId: "fixture", periodicRangeConversion: source };

describe("自定义周期配方频道", () => {
  it("同一设备中的自定义相位配方和普通配方只能在各自的频道执行", () => {
    const channels = [{ id: "fixture-automatic" }, { id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID, projectionRangeIds: ["fixture-range"] }];
    expect(isRecipeAvailableInChannel(phase, CUSTOM_PERIODIC_PHASE_CHANNEL_ID, channels, "fixture")).toBe(true);
    expect(isRecipeAvailableInChannel(phase, "fixture-automatic", channels, "fixture")).toBe(false);
    expect(isRecipeAvailableInChannel({ machineId: "fixture" }, CUSTOM_PERIODIC_PHASE_CHANNEL_ID, channels, "fixture")).toBe(false);
    expect(isRecipeAvailableInChannel({ machineId: "fixture" }, "fixture-automatic", channels, "fixture")).toBe(true);
  });

  it("在设备全局切换为自动模式时仍须手动选择周期相位", () => {
    expect(isManualRecipeChannel({ id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID, projectionRangeIds: ["fixture-range"], manualRecipeOnly: true }, true)).toBe(true);
    expect(isManualRecipeChannel({ id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID }, true)).toBe(false);
    expect(isManualRecipeChannel({ id: "fixture-existing", manualRecipeOnly: true }, true)).toBe(false);
  });

  it("保留未声明自定义周期频道时的既有周期配方", () => {
    expect(isRecipeAvailableInChannel(phase, "fixture-existing", [{ id: "fixture-existing" }], "fixture")).toBe(true);
  });
});

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 测试夹具及断言改为读取配方行为、独立投影口和真实工序维度。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: 本文件中对应测试及 src/tests/simulation/formation-projections.test.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
// const effect = { probabilityByLayer: [1], outputItemByInputId: { "fixture-input": "fixture-output" } };
//
//   program: { id: "fixture-program", periodSeconds: 2, effects: [effect, effect, effect] },
//
//     const channels = [{ id: "fixture-automatic" }, { id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID }];
//
//     expect(isManualRecipeChannel({ id: CUSTOM_PERIODIC_PHASE_CHANNEL_ID, manualRecipeOnly: true }, true)).toBe(true);
