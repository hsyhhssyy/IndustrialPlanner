import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { PlannerNetwork } from "./model";
import { placeProduction, redundantEnvironmentStations, type PlannerPlacement } from "./placement";
import { supplyAuxiliaryDemand } from "./production-network";
import { addTerminals, materialBalance } from "./terminals";
import { preparePlantStartups, prepareConverterStartups } from "./support";
import { planConverterSupply } from "./converter-supply";
import type { PlannerSearchProfile } from "./search-profile";
import type { PlannerSearchOptions } from "./search-types";

/** 调度初始设备清单与 Worker 共用准备过程，包含环境、辅助生产、启动和源汇设施。 */
export async function prepareProductionDevices(registry: RegistryContract, network: PlannerNetwork,
  placement: PlannerPlacement, variant: number, profile: PlannerSearchProfile, options: PlannerSearchOptions,
  checkBudget: () => void, environmentLimits?: ReadonlyMap<string, number>) {
  await placeProduction(registry, network, placement, variant, checkBudget, environmentLimits);
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
    await placeProduction(registry, network, placement, variant, checkBudget, environmentLimits);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const startups = preparePlantStartups(registry, network, placement);
  prepareConverterStartups(registry, network, placement, planConverterSupply(registry, network, variant));
  addTerminals(registry, network, placement, profile.separateOperatingSupply === 1, profile.fluidGroupSize,
    options.strategy !== "baseline", options.stashPackingVariant, options.conduitTopology);
  return startups;
}
