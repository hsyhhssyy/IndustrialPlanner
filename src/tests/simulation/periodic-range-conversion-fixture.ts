import { FORMATION_EFFECTS } from "@/shared/formation-recipes";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { FormationDefinition } from "@/domain/registry/types/periodic-range-conversion";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";

export const PERIODIC_FIXTURE_RAW_ITEM = "item_copper_ore";
export const PERIODIC_FIXTURE_PRODUCT_ITEM = "item_copper_nugget";

export function loadPeriodicRangeConversionFixture(periodSeconds = 1.25) {
  const baseRegistry = createRegistryContract();
  const formation: FormationDefinition = { id: "fixture:periodic-range-conversion", periodSeconds,
    machines: { ming: "fixture:ming", hui: "fixture:hui", heng: "fixture:heng" } };
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
  for (const side of FORMATION_EFFECTS) {
    entityDefinitions.push({ ...baseRegistry.queries.findEntityDefinition("magic_spawner_range_" + side)!, id: formation.machines[side] });
  }
  const recipeDefinitions: RecipeDefinition[] = baseRegistry.recipeDefinitions.map(recipe =>
    recipe.id === "r_gas_diffuser_xiranite_gas_environment_basic" ? {
      ...recipe,
      periodicRangeConversion: { rangeIds: ["fixture-conversion-range"], side: 0 as const, programId: formation.id },
    } : recipe);
  for (const effect of FORMATION_EFFECTS) {
    recipeDefinitions.push({
      id: "fixture:route:" + effect, nameKey: "fixture", machineId: formation.machines[effect],
      inputs: [{ itemId: PERIODIC_FIXTURE_RAW_ITEM, amount: 1 }], outputs: [{ itemId: PERIODIC_FIXTURE_PRODUCT_ITEM, amount: 1 }],
      recipeType: "immediate-consume", tags: [], durationSeconds: periodSeconds,
      behavior: { behaviorId: "formation-transfer", params: { chanceByLayer: [1] } },
    });
  }
  const registry = {
    ...baseRegistry,
    formationDefinitions: [...baseRegistry.formationDefinitions, formation],
    entityDefinitions,
    recipeDefinitions,
    queries: createRegistryQuery({ entityDefinitions, itemDefinitions: baseRegistry.itemDefinitions, recipeDefinitions }),
  };
  const blueprint = loadBlueprintFromFile(
    "src/tests/fixtures/blueprints/simulation/periodic-range-conversion/legacy-reservation.schema7.json",
  );
  return { document: createWorldDocumentFromBlueprint(blueprint), registry };
}

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 测试夹具及断言改为读取配方行为、独立投影口和真实工序维度。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: 本文件中对应测试及 src/tests/simulation/formation-projections.test.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
// import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
//
//   const effect = {
//     probabilityByLayer: [1],
//     outputItemByInputId: { [PERIODIC_FIXTURE_RAW_ITEM]: PERIODIC_FIXTURE_PRODUCT_ITEM },
//   };
//   const program: PeriodicRangeConversionProgram = {
//     id: "fixture:periodic-range-conversion",
//     periodSeconds,
//     effects: [effect, effect, effect],
//   };
//
//   const recipeDefinitions = baseRegistry.recipeDefinitions.map(recipe =>
//
//       periodicRangeConversion: { rangeIds: ["fixture-conversion-range"], side: 0 as const, program },
