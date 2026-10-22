// @vitest-environment node
// 2026-10-21：固定瓶装代表输入；仅执行正式设备准备，不运行 EDA 搜索或浏览器专项。
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { EDA_REGRESSION_CASES, loadEdaRegressionInput } from "@/shared/eda-regression";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { prepareProductionDevices } from "@/blueprint-planner/production-preparation";
import { PlannerPlacement } from "@/blueprint-planner/placement";
import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
import { plannerDeviceArea } from "@/blueprint-planner/search-outline";
import { materialBalance } from "@/blueprint-planner/terminals";

const registry = createRegistryContract();
it.each(["cuprium-canister-30-2s", "pyrrolite-canister-30-2s", "amethyst-cuprium-solution-30-2s"])(
  "%s 保留完整生产链，正式准备后物料守恒且固定面积为 2S", async id => {
    const scenario = EDA_REGRESSION_CASES.find(test => test.id === id)!;
    const request = await loadEdaRegressionInput(id), before = structuredClone(request);
    expect(request.plan.targets).toEqual([{ itemId: scenario.targets[0]!.itemId, perMinute: 30 }]);
    expect(request.plan.infiniteItemIds).not.toContain(scenario.targets[0]!.itemId);
    expect(request.options).toMatchObject({ warehouseBus: "straight", warehousePortPlacement: "continuous",
      solidSupply: "warehouse", fluidSupply: "conduit", solidOutput: "stash" });
    const network = createProductionNetwork(registry, request);
    const profile = resolveSearchProfile({ areaWeight: 0.4, congestionWeight: 2, fluidGroupSize: 2 });
    const placement = new PlannerPlacement(registry, 68, 1, 1, profile.initialClearance, 1);
    placement.maximumX = 70;
    await prepareProductionDevices(registry, network, placement, 0, profile,
      { strategy: "compact", stashPackingVariant: 0, conduitTopology: "shared" }, () => {});
    expect(plannerDeviceArea(registry, network.nodes) * 2).toBe(scenario.initialArea);
    const balance = materialBalance({ ...network, request: { ...network.request,
      plan: { ...network.request.plan, targets: [] } } });
    expect([...balance.values()].every(flow => Math.abs(flow) < 1e-6)).toBe(true);
    if (id === "pyrrolite-canister-30-2s") {
      expect(request.plan.infiniteItemIds).not.toContain("item_plant_grass_1");
      expect(request.plan.infiniteItemIds).not.toContain("item_gas_acid");
      expect(network.nodes.some(node => node.purpose === "auxiliary" && node.recipe?.id === "liquid_transmuter_1_gas_gas_acid_1")).toBe(true);
    }
    if (id === "amethyst-cuprium-solution-30-2s") {
      const converter = request.plan.recipes.find(recipe => recipe.recipeId === "liquid_transmuter_1_liquid_liquid_copper_1")!;
      expect(converter.runningInputs).toContainEqual({ itemId: "item_liquid_xiranite", perMinute: 6 });
    }
    expect(request).toEqual(before);
  });
