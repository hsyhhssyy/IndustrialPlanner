import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";

export const PERIODIC_FIXTURE_RAW_ITEM = "item_copper_ore";
export const PERIODIC_FIXTURE_PRODUCT_ITEM = "item_copper_nugget";

export function loadPeriodicRangeConversionFixture(periodSeconds = 1.25) {
  const baseRegistry = createRegistryContract();
  const effect = {
    probabilityByLayer: [1],
    outputItemByInputId: { [PERIODIC_FIXTURE_RAW_ITEM]: PERIODIC_FIXTURE_PRODUCT_ITEM },
  };
  const program: PeriodicRangeConversionProgram = {
    id: "fixture:periodic-range-conversion",
    periodSeconds,
    effects: [effect, effect, effect],
  };
  const entityDefinitions = baseRegistry.entityDefinitions.map(definition =>
    definition.id === "vaporizer_1" ? {
      ...definition,
      recipeChannels: definition.recipeChannels.slice(0, 1),
      ranges: [...(definition.ranges ?? []), {
        id: "fixture-conversion-range",
        localRect: { x: -4, y: 0, width: 1, height: 1 },
        coverage: "contains" as const,
        visualId: "fixture-conversion-range",
      }],
    } : definition);
  const recipeDefinitions = baseRegistry.recipeDefinitions.map(recipe =>
    recipe.id === "r_gas_diffuser_xiranite_gas_environment_basic" ? {
      ...recipe,
      periodicRangeConversion: { rangeIds: ["fixture-conversion-range"], side: 0 as const, program },
    } : recipe);
  const registry = {
    ...baseRegistry,
    entityDefinitions,
    recipeDefinitions,
    queries: createRegistryQuery({ entityDefinitions, itemDefinitions: baseRegistry.itemDefinitions, recipeDefinitions }),
  };
  const blueprint = loadBlueprintFromFile(
    "src/tests/fixtures/blueprints/simulation/periodic-range-conversion/legacy-reservation.schema7.json",
  );
  return { document: createWorldDocumentFromBlueprint(blueprint), registry };
}
