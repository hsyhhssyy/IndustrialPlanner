import { describe, expect, it } from "vitest";

import { requirePerformanceEngineKind } from "../../../scripts/perf/sim-perf-engine";

describe("仿真性能测试引擎选择", () => {
  it("保留显式指定的 Dense 引擎，避免落入测试工具的 Legacy 默认值", () => {
    expect(requirePerformanceEngineKind("dense-v2")).toBe("dense-v2");
  });

  it("允许明确选择已注册的 Legacy 引擎", () => {
    expect(requirePerformanceEngineKind("legacy")).toBe("legacy");
  });

  it.each([undefined, "", "dense", "unknown"])("拒绝缺失或无效的引擎 %s，不静默回退", (configured) => {
    expect(() => requirePerformanceEngineKind(configured)).toThrow("SIMULATION_TEST_ENGINE");
  });
});
