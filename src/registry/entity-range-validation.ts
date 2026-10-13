import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";

/** 错误范围在 Registry 构造时拒绝，避免静默漏画或扩大作用区。 */
export function validateEntityRanges(
  definitions: readonly EntityDefinition[], recipes: readonly RecipeDefinition[],
): void {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  for (const definition of definitions) {
    const ids = new Set<string>();
    let powerCount = 0;
    for (const range of definition.ranges ?? []) {
      if (!range.id || ids.has(range.id)) throw new Error(`Duplicate or empty range ID: ${definition.id}:${range.id}`);
      ids.add(range.id);
      const rect = range.localRect;
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0) throw new Error(`Invalid range rectangle: ${definition.id}:${range.id}`);
      if (!range.visualId || !["intersects", "contains"].includes(range.coverage)) {
        throw new Error(`Invalid range declaration: ${definition.id}:${range.id}`);
      }
      if (range.interactionKind === "power") powerCount++;
    }
    if (powerCount > 1) throw new Error(`Multiple power ranges: ${definition.id}`);
  }
  for (const recipe of recipes) {
    if (!recipe.gasDiffusionOutput) continue;
    const range = byId.get(recipe.machineId)?.ranges?.find((entry) => entry.id === recipe.gasDiffusionOutput!.rangeId);
    if (!range || range.interactionKind !== "gas" || range.coverage !== "contains") {
      throw new Error(`Invalid gas range reference: ${recipe.id}:${recipe.gasDiffusionOutput.rangeId}`);
    }
  }
}
