import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { PlannerNetwork } from "./model";
import { placeProduction, redundantEnvironmentStations, type PlannerPlacement } from "./placement";
import { supplyAuxiliaryDemand } from "./production-network";
import { addTerminals, materialBalance } from "./terminals";
import { preparePlantStartups, prepareConverterStartups } from "./support";
import { planConverterSupply } from "./converter-supply";
import type { PlannerSearchProfile } from "./search-profile";
import type { PlannerSearchOptions } from "./search-types";
import { plannerAttemptStrategy } from "./strategy-schedule";
import { PlannerRandom } from "./search-random";

/** 调度初始设备清单与 Worker 共用准备过程，包含环境、辅助生产、启动和源汇设施。 */
export async function prepareProductionDevices(registry: RegistryContract, network: PlannerNetwork,
  placement: PlannerPlacement, variant: number, profile: PlannerSearchProfile, options: PlannerSearchOptions,
  checkBudget: () => void, environmentLimits?: ReadonlyMap<string, number>) {
  const strategy = options.attemptStrategy ?? plannerAttemptStrategy(variant);
  await placeProduction(registry, network, placement, strategy.placementSeed, checkBudget, environmentLimits);
  const redundant = redundantEnvironmentStations(network);
  if (redundant.length) {
    placement.remove(redundant);
    network.nodes.splice(0, network.nodes.length, ...network.nodes.filter(node => !redundant.includes(node)));
  }
  const processedEnvironments = new Set<string>();
  for (;;) {
    checkBudget();
    const added = network.nodes.filter(node => node.purpose === "environment" && !processedEnvironments.has(node.entity.id));
    if (!added.length) break;
    for (const environment of added) {
      processedEnvironments.add(environment.entity.id);
      for (const input of environment.inputs) {
        const deficit = -(materialBalance(network).get(input.itemId) ?? 0);
        if (deficit > 1e-6) supplyAuxiliaryDemand(registry, network, input.itemId, deficit);
      }
    }
    await placeProduction(registry, network, placement, strategy.placementSeed, checkBudget, environmentLimits);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const startups = preparePlantStartups(registry, network, placement);
  prepareConverterStartups(registry, network, placement, planConverterSupply(registry, network, strategy.converterSeed));
  addTerminals(registry, network, placement, profile.separateOperatingSupply === 1, profile.fluidGroupSize,
    options.strategy !== "baseline", options.stashPackingVariant ?? (strategy.unitKey ? strategy.packingSeed : new PlannerRandom(strategy.packingSeed)), options.conduitTopology ?? strategy.conduitTopology);
  return startups;
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 f850639d1a8a01ee66acbe0fee4acec40f3f4944556bce8b2ac0498835a5f55e。
// Replacement: src/blueprint-planner/production-preparation.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/production-preparation.ts):
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import type { PlannerNetwork } from "./model";
// import { placeProduction, redundantEnvironmentStations, type PlannerPlacement } from "./placement";
// import { supplyAuxiliaryDemand } from "./production-network";
// import { addTerminals, materialBalance } from "./terminals";
// import { preparePlantStartups, prepareConverterStartups } from "./support";
// import { planConverterSupply } from "./converter-supply";
// import type { PlannerSearchProfile } from "./search-profile";
// import type { PlannerSearchOptions } from "./search-types";
// import { plannerAttemptStrategy, plannerConnectionChoices } from "./strategy-schedule";
// import { PlannerRandom } from "./search-random";
//
// /** 调度初始设备清单与 Worker 共用准备过程，包含环境、辅助生产、启动和源汇设施。 */
// export async function prepareProductionDevices(registry: RegistryContract, network: PlannerNetwork,
//   placement: PlannerPlacement, variant: number, profile: PlannerSearchProfile, options: PlannerSearchOptions,
//   checkBudget: () => void, environmentLimits?: ReadonlyMap<string, number>) {
//   const strategy = options.attemptStrategy ?? plannerAttemptStrategy(variant);
//   await placeProduction(registry, network, placement, strategy.placementSeed, checkBudget, environmentLimits);
//   const redundant = redundantEnvironmentStations(network);
//   if (redundant.length) {
//     placement.remove(redundant);
//     network.nodes.splice(0, network.nodes.length, ...network.nodes.filter(node => !redundant.includes(node)));
//   }
//   const processedEnvironments = new Set<string>();
//   for (;;) {
//     checkBudget();
//     const added = network.nodes.filter(node => node.purpose === "environment" && !processedEnvironments.has(node.entity.id));
//     if (!added.length) break;
//     for (const environment of added) {
//       processedEnvironments.add(environment.entity.id);
//       for (const input of environment.inputs) {
//         const deficit = -(materialBalance(network).get(input.itemId) ?? 0);
//         if (deficit > 1e-6) supplyAuxiliaryDemand(registry, network, input.itemId, deficit);
//       }
//     }
//     await placeProduction(registry, network, placement, strategy.placementSeed, checkBudget, environmentLimits);
//     await new Promise<void>(resolve => setTimeout(resolve, 0));
//   }
//   const startups = preparePlantStartups(registry, network, placement);
//   prepareConverterStartups(registry, network, placement, planConverterSupply(registry, network, strategy.converterSeed));
//   addTerminals(registry, network, placement, profile.separateOperatingSupply === 1, profile.fluidGroupSize,
//     options.strategy !== "baseline", options.stashPackingVariant ?? new PlannerRandom(strategy.packingSeed), options.conduitTopology ?? strategy.conduitTopology, profile.operatingFluidGroupSize,
//     plannerConnectionChoices(strategy.matchingSeed).spareSupplyPorts);
//   return startups;
// }
//
