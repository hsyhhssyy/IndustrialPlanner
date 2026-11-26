import type { RegistryContract } from "@/domain/registry/registry-contract";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { FORMATION_EFFECTS } from "@/shared/formation-recipes";

/** 在内置、网络及快照共用的装配边界验证规则，保留出错的配方身份。 */
export function validateFormations(registry: RegistryContract): void {
  const groups = new Set<string>();
  const machines = new Map<string, number>();
  for (const formation of registry.formationDefinitions) {
    if (groups.has(formation.id) || !Number.isSafeInteger(formation.periodSeconds * 3000) || formation.periodSeconds <= 0) {
      throw new Error("Invalid or duplicate formation: " + formation.id);
    }
    groups.add(formation.id);
    for (const effect of FORMATION_EFFECTS) {
      const machine = formation.machines[effect];
      if (!registry.queries.findEntityDefinition(machine) || machines.has(machine)) {
        throw new Error("Invalid or ambiguous formation machine: " + machine);
      }
      machines.set(machine, formation.periodSeconds);
    }
  }
  for (const entity of registry.entityDefinitions) {
    const projections = new Set<string>();
    for (const channel of entity.recipeChannels) {
      if (!channel.projectionRangeIds) continue;
      if (!channel.projectionRangeIds.length) throw new Error("Empty projection channel: " + entity.id + "/" + channel.id);
      for (const range of channel.projectionRangeIds) {
        if (projections.has(range) || !entity.ranges?.some(entry => entry.id === range)) {
          throw new Error("Unknown or duplicate projection: " + entity.id + "/" + channel.id + "/" + range);
        }
        projections.add(range);
      }
    }
  }
  const routes = new Map<string, string>();
  for (const recipe of registry.recipeDefinitions) {
    const source = recipe.periodicRangeConversion;
    if (source) {
      const owner = registry.queries.findEntityDefinition(recipe.ownerDeviceId ?? recipe.machineId);
      if (!groups.has(source.programId) || !source.rangeIds.length || (source.side !== 0 && source.side !== 1)
        || source.rangeIds.some(id => !owner?.ranges?.some(range => range.id === id))) {
        throw new Error("Invalid formation source: " + recipe.id);
      }
    }
    if (!recipe.behavior) continue;
    const chances = recipe.behavior.params?.chanceByLayer;
    const input = recipe.inputs[0];
    const output = recipe.outputs[0];
    if (recipe.behavior.behaviorId !== "formation-transfer" || machines.get(recipe.machineId) !== recipe.durationSeconds
      || recipe.inputs.length !== 1 || recipe.outputs.length !== 1 || input?.amount !== 1 || output?.amount !== 1
      || registry.queries.resolveItemDomain(input.itemId) !== ItemDomainFlag.Solid
      || registry.queries.resolveItemDomain(output.itemId) !== ItemDomainFlag.Solid
      || recipe.probability !== undefined || recipe.environmentOutput !== undefined || recipe.requiredEnvironmentAnyOf !== undefined
      || !Array.isArray(chances) || !chances.length || chances.some(p => !Number.isFinite(p) || p < 0 || p > 1)) {
      throw new Error("Invalid formation-transfer recipe: " + recipe.id);
    }
    const key = JSON.stringify([recipe.machineId, input.itemId]);
    const previous = routes.get(key);
    if (previous !== undefined) throw new Error("Conflicting formation recipes: " + previous + ", " + recipe.id);
    routes.set(key, recipe.id);
  }
}
