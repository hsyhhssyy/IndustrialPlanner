import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { createWorldDocument } from "@/domain/document/world-document";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { buildRegionalWarehouseOutletTable } from "@/simulation/regional/warehouse-outlet-table";
import {
  LocalRegionalBasePort,
  RegionalSimulationSession,
  type RegionalBaseTopologyInput,
} from "@/simulation/regional/session";

const TEN_MINUTE_EPOCHS = 1200;

describe("武陵四基地区域会话 10 分钟长跑", () => {
  it("四个武陵基地连续 1200 Epoch 同步提交", { timeout: 120_000 }, async () => {
    const registry = createRegistryContract();
    const wulingBaseIds = registry.baseDefinitions
      .filter((definition) => definition.tag === "武陵")
      .map((definition) => definition.id);
    expect(wulingBaseIds).toHaveLength(4);

    const topologies: RegionalBaseTopologyInput[] = wulingBaseIds.map((baseId, index) => ({
      baseId,
      regionBaseOrderIndex: index,
      topology: compileSimulationTopology({
        document: createWorldDocument({ baseId }),
        registry,
        simulationMode: "regional-multi-base",
        poweredEntityIds: new Set(),
        activeActivityIds: [],
      }),
    }));
    const admission = buildRegionalWarehouseOutletTable({ registry, topologies });
    expect(admission.ok).toBe(true);

    const initialWarehouseCounts: Record<string, number> = {};
    const session = new RegionalSimulationSession({
      sessionId: "wuling-four-base-long-run",
      registry,
      topologies,
      table: admission.table!,
      currentBaseId: wulingBaseIds[0]!,
      expectedBaseIds: wulingBaseIds,
      initialWarehouseCounts,
      simulationSpeed: 1,
      currentBaseDynamicTickRate: 20,
      backgroundDynamicTickRate: 2,
    }, wulingBaseIds.map((baseId, index) => new LocalRegionalBasePort({
      registry,
      baseId,
      regionBaseOrderIndex: index,
      topology: topologies[index]!.topology,
      table: admission.table!,
      initialWarehouseCounts,
      isCurrentBase: index === 0,
      simulationSpeed: 1,
      fixedDynamicTickRate: index === 0 ? 20 : 2,
      advanceMode: index === 0 ? "per-tick" : "coarse",
    })), null);

    try {
      for (let epoch = 0; epoch < TEN_MINUTE_EPOCHS; epoch += 1) {
        const committed = await session.runEpoch(epoch);
        expect(committed.epochNumber).toBe(epoch);
        expect(committed.warehouseVersion).toBe(epoch + 1);
        expect(committed.snapshotsByBaseId[wulingBaseIds[0]!]).not.toBeNull();
      }
      // AI-REMOVED 2026-08-21:
      // Reason: 区域会话不再保留完整 Epoch 快照历史。
      // Trigger: 真实四基地持续运行出现无界内存增长。
      // Evidence: 会话顺序现在由 nextEpochNumber 标量维护。
      // Replacement: 断言最终 nextEpochNumber。
      // Risk: Low。
      // Human Review: Required
      //
      // Original code:
      // expect(session.committedEpochs).toHaveLength(TEN_MINUTE_EPOCHS);
      expect(session.nextEpochNumber).toBe(TEN_MINUTE_EPOCHS);
    } finally {
      session.dispose();
    }
  });
});
