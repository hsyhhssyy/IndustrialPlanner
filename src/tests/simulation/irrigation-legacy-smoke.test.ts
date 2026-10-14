import { describe, expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { runBlueprintSimulation } from "./blueprint-runner";

describe("Legacy 田块循环基本接入", () => {
  it("自动育苗、浇水、生长、收获入仓后开始下一轮", async () => {
    const report = await runBlueprintSimulation({
      blueprint: loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dense-irrigation/harvest.schema7.json"),
      registry: createRegistryContract(), engineKind: "legacy", maxDurationSeconds: 335,
    });
    const last = report.ticks.at(-1)!;
    expect(Object.values(last.devices).some(device => device.deviceState?.stateId === "seedling" && device.deviceState.enteredAtSeconds === 334)).toBe(true);
    expect(last.warehouseStats?.items.item_plant_moss_3?.warehouseCount).toBe(10);
    const water = Object.values(last.devices).flatMap(device => device.slotItems).filter(slot => slot.storageGroupId === "liquid");
    expect(water).toHaveLength(1);
    expect(water[0]!.count).toBe(20);
    expect(water[0]!.reserved).toBe(0);
  });
});
