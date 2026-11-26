import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { FormationDefinition, FormationEffect } from "@/domain/registry/types/periodic-range-conversion";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

export const FORMATION_EFFECTS: readonly FormationEffect[] = ["ming", "hui", "heng"];

export function findFormation(registry: Pick<RegistryContract, "formationDefinitions">, id: string): FormationDefinition {
  const formation = registry.formationDefinitions.find(definition => definition.id === id);
  if (!formation) throw new Error("Unknown formation: " + id);
  return formation;
}

export function formationRecipes(
  registry: Pick<RegistryContract, "queries">,
  formation: FormationDefinition,
  effect: FormationEffect,
): readonly RecipeDefinition[] {
  return registry.queries.findRecipeDefinitionsByMachine(formation.effects[effect].machineId).filter(recipe => recipe.periodicRangeConversion === undefined);
}

/** 一层对应首项，自定义短表向上延续末项。 */
export function formationSelectionRatio(ratios: readonly number[], layers: number): number {
  return ratios[Math.min(layers, ratios.length) - 1]!;
}
