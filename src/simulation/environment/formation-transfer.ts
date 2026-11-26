import type { FormationDefinition, FormationEffect } from "@/domain/registry/types/periodic-range-conversion";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { FORMATION_EFFECTS, formationRecipes, formationSelectionRatio } from "@/shared/formation-recipes";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import type { RecipeRandomSource } from "../recipe-selection";
import type { BeltCell, RegionSettlement } from "./periodic-transformation";

function selectCells(cells: readonly BeltCell[], ratio: number, random: RecipeRandomSource): readonly BeltCell[] {
  if (cells.length === 0 || ratio === 0) return [];
  // 比较比例避免把 25 × 0.28 的浮点尾差向上取整成 8。
  const lower = Math.floor(cells.length * ratio);
  let quota = lower / cells.length >= ratio ? lower : lower + 1;
  if (quota === cells.length) return cells;
  const selected: BeltCell[] = [];
  for (let i = 0; quota > 0; i++) {
    const remaining = cells.length - i;
    if (quota === remaining || random.next() < quota / remaining) {
      selected.push(cells[i]!);
      quota--;
    }
  }
  return selected;
}

/** 拓扑编译时绑定配方。运行时只访问到期区域的物理槽位。 */
export function compileFormationTransfer(
  registry: RegistryContract, formation: FormationDefinition, activeActivityIds: readonly string[],
): RegionSettlement {
  const routes: Record<FormationEffect, Map<string, string>> = { ming: new Map(), hui: new Map(), heng: new Map() };
  for (const effect of FORMATION_EFFECTS) {
    for (const recipe of formationRecipes(registry, formation, effect)) {
      if (isRecipeAvailableByActivity(recipe, activeActivityIds)) routes[effect].set(recipe.inputs[0]!.itemId, recipe.outputs[0]!.itemId);
    }
  }
  return (effect, layers, cells, random, transformSlot) => {
    const ratio = formationSelectionRatio(formation.effects[effect].selectionRatioByLayer, layers);
    const selected = selectCells(cells, ratio, random);
    const convert = (original: string) => routes[effect].get(original) ?? original;
    for (const cell of selected) {
      for (const slot of cell) {
        if (transformSlot(slot, convert)) break;
      }
    }
  };
}
