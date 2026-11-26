import type { FormationDefinition, FormationEffect, FormationTransferBehavior } from "@/domain/registry/types/periodic-range-conversion";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { FORMATION_EFFECTS, formationChance, formationRecipes } from "@/shared/formation-recipes";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import type { RecipeRandomSource } from "../recipe-selection";
import type { RegionSettlement } from "./periodic-transformation";

type ItemBehavior = (layers: number, random: RecipeRandomSource) => string | undefined;

const localBehaviors = {
  "formation-transfer"(output: string, { chanceByLayer }: FormationTransferBehavior["params"]): ItemBehavior {
    return (layers, random) => {
      const chance = formationChance(chanceByLayer, layers);
      return chance === 1 || (chance > 0 && random.next() < chance) ? output : undefined;
    };
  },
};

/** 拓扑编译时绑定配方。运行时只访问到期区域的物理槽位。 */
export function compileFormationTransfer(
  registry: RegistryContract, formation: FormationDefinition, activeActivityIds: readonly string[],
): RegionSettlement<string, string> {
  const routes: Record<FormationEffect, Map<string, ItemBehavior>> = { ming: new Map(), hui: new Map(), heng: new Map() };
  for (const effect of FORMATION_EFFECTS) {
    for (const recipe of formationRecipes(registry, formation, effect)) {
      if (!isRecipeAvailableByActivity(recipe, activeActivityIds)) continue;
      const behavior = recipe.behavior!;
      routes[effect].set(recipe.inputs[0]!.itemId, localBehaviors[behavior.behaviorId](recipe.outputs[0]!.itemId, behavior.params));
    }
  }
  return (effect, layers, slots, random, transformSlot) => {
    const rules = routes[effect];
    if (!rules.size) return;
    const convert = (original: string) => rules.get(original)?.(layers, random) ?? original;
    for (const slot of slots) transformSlot(slot, convert);
  };
}
