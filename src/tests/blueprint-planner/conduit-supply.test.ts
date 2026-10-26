// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import { PlannerPlacement, placeProduction } from "@/blueprint-planner/placement";
import { addTerminals } from "@/blueprint-planner/terminals";
import { wireProductionNetwork } from "@/blueprint-planner/wiring";
import input from "./fixtures/environment-supply.json";

describe("EDA 暗管仓库无限供料", () => {
  it("beta1 六路供水保留双出口运力及六路实际需求", async () => {
    const registry = createRegistryContract(), base = structuredClone(input) as BlueprintPlannerRequest;
    const request: BlueprintPlannerRequest = { ...base, options: { ...base.options, itemPolicies: undefined, solidOutput: "stash" },
      plan: { ...base.plan, targets: [{ itemId: "item_plant_grass_2", perMinute: 360 }],
        externalSupplies: [{ itemId: "item_plant_grass_seed_2", perMinute: 180 }, { itemId: "item_liquid_water", perMinute: 180 }],
        recipes: [{ recipeId: "r_hydro_planter_grass_2_from_seed_2_and_water_basic", deviceCount: 6, cyclesPerMinute: 180,
          inputs: [{ itemId: "item_plant_grass_seed_2", perMinute: 180 }, { itemId: "item_liquid_water", perMinute: 180 }],
          outputs: [{ itemId: "item_plant_grass_2", perMinute: 360 }], runningInputs: [] }], supplyPolicies: [] } };
    const network = createProductionNetwork(registry, request), placement = new PlannerPlacement(registry, 70, 1, 1, 0);
    await placeProduction(registry, network, placement, 0);
    addTerminals(registry, network, placement, true, 6, true, 0, "local");
    const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
    const source = network.nodes.find(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === "item_liquid_water"))!;
    expect(source.definition.id).toBe("udpipe_unloader_2");
    expect(wires.filter(wire => wire.source.entityId === source.entity.id).map(wire => wire.perMinute).sort()).toEqual([120, 60]);
    // AI-CORRECTION 2026-10-26：beta1 顺序分配 120+60，保留其四节点拆分树；总流量及每路实际需求继续核验。
    const splitters = network.nodes.filter(node => node.definition.id === "pipe_splitter");
    expect(splitters).toHaveLength(4);
    for (const node of splitters) {
      expect(wires.filter(wire => wire.target.entityId === node.entity.id).reduce((sum, wire) => sum + wire.perMinute, 0))
        .toBeCloseTo(wires.filter(wire => wire.source.entityId === node.entity.id).reduce((sum, wire) => sum + wire.perMinute, 0), 8);
    }
    const consumers = new Set(network.nodes.filter(node => node.purpose === "production").map(node => node.entity.id));
    expect(wires.filter(wire => consumers.has(wire.target.entityId) && wire.itemIds.includes("item_liquid_water"))
      .map(wire => wire.perMinute)).toEqual(Array(6).fill(30));
  });

  it.each([
    { perMinute: 60, definitionId: "udpipe_unloader_1" },
    { perMinute: 240, definitionId: "udpipe_unloader_2" },
  ])("$definitionId：液体、气体均通过仓库链接供料，无本地库存或场景覆盖", ({ perMinute, definitionId }) => {
    const registry = createRegistryContract();
    const flows = ["item_liquid_acid", "item_gas_copper_enr"].map(itemId => ({ itemId, perMinute }));
    const base = structuredClone(input) as BlueprintPlannerRequest;
    const request: BlueprintPlannerRequest = { ...base, plan: { ...base.plan,
      recipes: [], targets: flows, externalSupplies: flows, supplyPolicies: [] } };
    const network = createProductionNetwork(registry, request);
    addTerminals(registry, network, new PlannerPlacement(registry, 80, 8, 2));
    const sources = network.nodes.filter(node => node.purpose === "supply");
    expect(sources).toHaveLength(2);
    expect(new Set(network.slotLinks.map(link => link.id)).size).toBe(2);
    for (const source of sources) {
      expect(source.definition.id).toBe(definitionId);
      expect(source.entity.config).toEqual({ "storageSlotGroups[0].slots[0].ignoreStock": true });
      expect(network.slotLinks.filter(link => link.source.entityId === source.entity.id)).toEqual([{
        id: expect.any(String), linkType: "share-all",
        source: { entityId: source.entity.id, storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
        target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: source.outputs[0]!.itemId },
      }]);
      expect(network.initialSlots.filter(slot => slot.entityId === source.entity.id)).toEqual([]);
    }
  });
});

// AI-REMOVED 2026-10-26:
// Reason: 源汇分组及端口分配恢复 beta1/2；去掉后续独立工作消耗分组参数，仍严格核验总供需、每路30/min及仓库链接。
// Trigger: 用户确认恢复 beta1/2 搜索内核并保留业务修复、任务接口。
// Evidence: src/tests/blueprint-planner/conduit-supply.test.ts；原文件 SHA256 a0e638c692d16af5981cf7c65e91f1e2cecb888466d1aa183c91b161ad7a23ce。
// Replacement: 当前文件活动代码，或 beta1/2 对应执行路径。
// Risk: 仅撤下已移除的算法分支参数/覆盖；公开预算、产率和任务一致性断言保持。
// Human Review: Required
// Original code:
// // @vitest-environment node
// import { describe, expect, it } from "vitest";
// import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
// import { createRegistryContract } from "@/registry";
// import { createProductionNetwork } from "@/blueprint-planner/production-network";
// import { PlannerPlacement, placeProduction } from "@/blueprint-planner/placement";
// import { addTerminals } from "@/blueprint-planner/terminals";
// import { wireProductionNetwork } from "@/blueprint-planner/wiring";
// import { resolveSearchProfile } from "@/blueprint-planner/search-profile";
// import input from "./fixtures/environment-supply.json";
//
// describe("EDA 暗管仓库无限供料", () => {
//   it("六路等量供水均衡为两个 90/min 出口，只需两个并列分流器且供需不变", async () => {
//     const registry = createRegistryContract(), base = structuredClone(input) as BlueprintPlannerRequest;
//     const request: BlueprintPlannerRequest = { ...base, options: { ...base.options, itemPolicies: undefined, solidOutput: "stash" },
//       plan: { ...base.plan, targets: [{ itemId: "item_plant_grass_2", perMinute: 360 }],
//         externalSupplies: [{ itemId: "item_plant_grass_seed_2", perMinute: 180 }, { itemId: "item_liquid_water", perMinute: 180 }],
//         recipes: [{ recipeId: "r_hydro_planter_grass_2_from_seed_2_and_water_basic", deviceCount: 6, cyclesPerMinute: 180,
//           inputs: [{ itemId: "item_plant_grass_seed_2", perMinute: 180 }, { itemId: "item_liquid_water", perMinute: 180 }],
//           outputs: [{ itemId: "item_plant_grass_2", perMinute: 360 }], runningInputs: [] }], supplyPolicies: [] } };
//     const network = createProductionNetwork(registry, request), placement = new PlannerPlacement(registry, 70, 1, 1, 0);
//     await placeProduction(registry, network, placement, 0);
//     addTerminals(registry, network, placement, true, 6, true, 0, "local", 1);
//     const wires = await wireProductionNetwork(registry, network, placement, () => {}, true);
//     const source = network.nodes.find(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === "item_liquid_water"))!;
//     expect(source.definition.id).toBe("udpipe_unloader_2");
//     expect(wires.filter(wire => wire.source.entityId === source.entity.id).map(wire => wire.perMinute).sort()).toEqual([90, 90]);
//     expect(network.nodes.filter(node => node.definition.id === "pipe_splitter")).toHaveLength(2);
//     const consumers = new Set(network.nodes.filter(node => node.purpose === "production").map(node => node.entity.id));
//     expect(wires.filter(wire => consumers.has(wire.target.entityId) && wire.itemIds.includes("item_liquid_water"))
//       .map(wire => wire.perMinute)).toEqual(Array(6).fill(30));
//   });
//
//   it.each([0, 1])("加工供液共用多口设施，工作消耗按独立组大小 %i 分配且总需求不变", async operatingFluidGroupSize => {
//     const registry = createRegistryContract(), base = structuredClone(input) as BlueprintPlannerRequest;
//     const profile = resolveSearchProfile({ fluidGroupSize: 6, operatingFluidGroupSize });
//     const request: BlueprintPlannerRequest = { ...base, plan: { ...base.plan,
//       targets: [{ itemId: "item_gas_acid", perMinute: 36 }],
//       externalSupplies: [{ itemId: "item_liquid_acid", perMinute: 36 }, { itemId: "item_liquid_xiranite", perMinute: 18 }],
//       recipes: [{ recipeId: "liquid_transmuter_1_gas_gas_acid_1", deviceCount: 3, cyclesPerMinute: 36,
//         inputs: [{ itemId: "item_liquid_acid", perMinute: 36 }], outputs: [{ itemId: "item_gas_acid", perMinute: 36 }],
//         runningInputs: [{ itemId: "item_liquid_xiranite", perMinute: 18 }] }],
//     } };
//     const network = createProductionNetwork(registry, request), placement = new PlannerPlacement(registry, 70, 1, 1, 1);
//     await placeProduction(registry, network, placement, 0);
//     addTerminals(registry, network, placement, true, profile.fluidGroupSize, true, 0, "local", profile.operatingFluidGroupSize);
//     const supplies = (itemId: string) => network.nodes.filter(node => node.purpose === "supply" && node.outputs.some(flow => flow.itemId === itemId));
//     expect(supplies("item_liquid_acid").map(node => node.definition.id)).toEqual(["udpipe_unloader_2"]);
//     const operating = supplies("item_liquid_xiranite");
//     expect(operating.map(node => node.definition.id)).toEqual(operatingFluidGroupSize ? Array(3).fill("udpipe_unloader_1") : ["udpipe_unloader_2"]);
//     expect(operating.reduce((sum, node) => sum + node.outputs[0]!.perMinute, 0)).toBe(18);
//     expect(new Set(operating.flatMap(node => node.supplyTargets!.map(target => target.entityId))).size).toBe(3);
//     expect(() => resolveSearchProfile({ operatingFluidGroupSize: 1.5 })).toThrow("整数");
//   });
//
//   it.each([
//     { perMinute: 60, definitionId: "udpipe_unloader_1" },
//     { perMinute: 240, definitionId: "udpipe_unloader_2" },
//   ])("$definitionId：液体、气体均通过仓库链接供料，无本地库存或场景覆盖", ({ perMinute, definitionId }) => {
//     const registry = createRegistryContract();
//     const flows = ["item_liquid_acid", "item_gas_copper_enr"].map(itemId => ({ itemId, perMinute }));
//     const base = structuredClone(input) as BlueprintPlannerRequest;
//     const request: BlueprintPlannerRequest = { ...base, plan: { ...base.plan,
//       recipes: [], targets: flows, externalSupplies: flows, supplyPolicies: [] } };
//     const network = createProductionNetwork(registry, request);
//     addTerminals(registry, network, new PlannerPlacement(registry, 80, 8, 2));
//     const sources = network.nodes.filter(node => node.purpose === "supply");
//     expect(sources).toHaveLength(2);
//     expect(new Set(network.slotLinks.map(link => link.id)).size).toBe(2);
//     for (const source of sources) {
//       expect(source.definition.id).toBe(definitionId);
//       expect(source.entity.config).toEqual({ "storageSlotGroups[0].slots[0].ignoreStock": true });
//       expect(network.slotLinks.filter(link => link.source.entityId === source.entity.id)).toEqual([{
//         id: expect.any(String), linkType: "share-all",
//         source: { entityId: source.entity.id, storageSlotGroupId: "unloader_buffer", slotId: "slot_1" },
//         target: { entityId: "warehouse", storageSlotGroupId: "warehouse", slotId: source.outputs[0]!.itemId },
//       }]);
//       expect(network.initialSlots.filter(slot => slot.entityId === source.entity.id)).toEqual([]);
//     }
//   });
// });
//
