import { expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { loadBlueprintFromFile, loadBlueprintVariantFromFile } from "./blueprint-test-helpers";
import { runBlueprintSimulation } from "./blueprint-runner";
import { loadPeriodicRangeConversionFixture } from "./periodic-range-conversion-fixture";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

const WAREHOUSE_STATS_WINDOW_SECONDS = 61;
const PUMP_CATALOG = "src/tests/fixtures/blueprints/simulation/resource-pump-production/index.json";
const BALANCER_CATALOG = "src/tests/fixtures/blueprints/simulation/magic-balancer-warehouse-stats/index.json";

const PUMP_STATISTICS_CASES = [
  {
    definitionId: "water_pump_1",
    recipeId: "r_pump_water_basic",
    itemId: "item_liquid_water",
    storageGroupId: "fluid_output_buffer",
    slotId: "output_fluid_slot_1",
    durationSeconds: 1,
    requiresPower: true,
  },
  {
    definitionId: "gas_pump_1",
    recipeId: "r_gas_collector_xiranite_basic",
    itemId: "item_gas_xiranite",
    storageGroupId: "gas_output_buffer",
    slotId: "output_gas_slot_1",
    durationSeconds: 3,
    requiresPower: false,
  },
] as const;

describeSimulationEngineMatrix("非配方与生产通道写入仓库统计", (engineKind) => {
  it("区域概率转化按实际替换记录产出与消耗", { timeout: 120_000 }, async () => {
    const fixture = loadPeriodicRangeConversionFixture(1.25);
    const blueprint = loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/simulation/periodic-range-conversion/legacy-reservation.schema7.json",
    );
    const report = await runBlueprintSimulation({
      blueprint,
      registry: fixture.registry,
      maxDurationSeconds: WAREHOUSE_STATS_WINDOW_SECONDS,
      engineKind,
    });
    const lastTick = report.ticks[report.ticks.length - 1]!;
    const stats = lastTick.warehouseStats;
    expect(stats?.statsWindowReady).toBe(true);

    const produced = stats?.items.item_copper_nugget?.producedPerMinute ?? 0;
    const consumed = stats?.items.item_copper_ore?.consumedPerMinute ?? 0;
    expect(produced).toBeGreaterThan(0);
    expect(consumed).toBeGreaterThan(0);
    // 每件物品都是 1:1 替换，区域转化的产出与消耗必须同量。
    expect(produced).toBe(consumed);
  });

  it("平衡炉配方产出与消耗写入统计", { timeout: 120_000 }, async () => {
    const blueprint = loadBlueprintVariantFromFile(BALANCER_CATALOG, "scene-01", {});
    const report = await runBlueprintSimulation({
      blueprint,
      registry: createRegistryContract(),
      maxDurationSeconds: WAREHOUSE_STATS_WINDOW_SECONDS,
      engineKind,
    });
    const lastTick = report.ticks[report.ticks.length - 1]!;
    const stats = lastTick.warehouseStats;
    expect(stats?.statsWindowReady).toBe(true);
    expect(stats?.items.item_copper_enr?.producedPerMinute ?? 0).toBeGreaterThan(0);
    expect(stats?.items.item_copper_ming?.consumedPerMinute ?? 0).toBeGreaterThan(0);
    expect(stats?.items.item_copper_hui?.consumedPerMinute ?? 0).toBeGreaterThan(0);
  });

  it.each(PUMP_STATISTICS_CASES)(
    "$definitionId 的 $recipeId 采集产出写入统计",
    { timeout: 120_000 },
    async (deviceCase) => {
      const blueprint = loadBlueprintVariantFromFile(PUMP_CATALOG, "scene-01", { deviceCase });
      const report = await runBlueprintSimulation({
        blueprint,
        registry: createRegistryContract(),
        maxDurationSeconds: WAREHOUSE_STATS_WINDOW_SECONDS,
        engineKind,
      });
      const lastTick = report.ticks[report.ticks.length - 1]!;
      const stats = lastTick.warehouseStats;
      expect(stats?.statsWindowReady).toBe(true);
      expect(stats?.items[deviceCase.itemId]?.producedPerMinute ?? 0).toBeGreaterThan(0);
    },
  );
});
