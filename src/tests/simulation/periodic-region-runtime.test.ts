import { describe, expect, it } from "vitest";

import { createSimulationHost } from "@/simulation/simulation-host";
import {
  collectPeriodicRangeRegions,
  resolvePeriodicRangeLayoutAggregate,
} from "@/shared/periodic-range-conversion";
import { createHeadlessWorkspace } from "./blueprint-runner";
import { loadPeriodicRangeConversionFixture } from "./periodic-range-conversion-fixture";
import { SIMULATION_ENGINE_MATRIX } from "./simulation-engine-matrix";

describe.each(SIMULATION_ENGINE_MATRIX)("REQ-054 周期区域运行态查询 [%s]", (engineKind) => {
  it("按共享区域身份返回阵型、层数与周期进度", async () => {
    const { document, registry } = loadPeriodicRangeConversionFixture(2.5);
    const layoutRegions = collectPeriodicRangeRegions({
      document,
      registry,
      activeActivityIds: [],
    });
    expect(layoutRegions).toHaveLength(1);
    const region = layoutRegions[0]!;
    expect(resolvePeriodicRangeLayoutAggregate(region)).toEqual({
      effect: "ming",
      layers: 1,
    });

    const host = createSimulationHost(createHeadlessWorkspace(document, registry), {
      engineKind,
      workerMode: "runtime",
    });
    try {
      expect(host.queries.getPeriodicRegionRuntime(region.regionId)).toBeNull();

      expect((await host.internalActions.refreshFromCurrentDocument()).status).toBe("started");
      const rate = host.topology.getSnapshot()!.standardTickRate;
      expect((await host.internalActions.syncToTick(1)).status).toBe("ready");

      expect(host.queries.getPeriodicRegionRuntime(region.regionId)).toEqual({
        regionId: region.regionId,
        effect: "ming",
        layers: 1,
        progressSeconds: 0,
        periodSeconds: 2.5,
      });

      expect((await host.internalActions.syncToTick(1 + rate)).status).toBe("ready");
      expect(host.queries.getPeriodicRegionRuntime(region.regionId)).toMatchObject({
        effect: "ming",
        layers: 1,
        progressSeconds: 1,
      });

      expect((await host.internalActions.syncToTick(1 + rate * 2)).status).toBe("ready");
      expect(host.queries.getPeriodicRegionRuntime(region.regionId)).toMatchObject({
        effect: "ming",
        layers: 1,
        progressSeconds: 2,
      });

      expect((await host.internalActions.syncToTick(1 + rate * 3)).status).toBe("ready");
      expect(host.queries.getPeriodicRegionRuntime(region.regionId)).toMatchObject({
        effect: "ming",
        layers: 1,
        progressSeconds: 0.5,
      });

      expect(host.queries.getPeriodicRegionRuntime("missing-region")).toBeNull();
    } finally {
      host.dispose();
    }
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
//   it("按共享区域身份返回类型、层数、概率与周期进度", async () => {
//
//       probability: 1,
//
//         probability: 1,
