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
      const { machineId: machine, selectionRatioByLayer: ratios } = formation.effects[effect];
      if (!Array.isArray(ratios) || !ratios.length || ratios.some(p => !Number.isFinite(p) || p < 0 || p > 1)) {
        throw new Error("Invalid formation selection ratios: " + formation.id + "/" + effect);
      }
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
    if (source || !machines.has(recipe.machineId)) continue;
    const input = recipe.inputs[0];
    const output = recipe.outputs[0];
    if (machines.get(recipe.machineId) !== recipe.durationSeconds
      || recipe.inputs.length !== 1 || recipe.outputs.length !== 1 || input?.amount !== 1 || output?.amount !== 1
      || registry.queries.resolveItemDomain(input.itemId) !== ItemDomainFlag.Solid
      || registry.queries.resolveItemDomain(output.itemId) !== ItemDomainFlag.Solid
      || recipe.probability !== undefined || recipe.environmentOutput !== undefined || recipe.requiredEnvironmentAnyOf !== undefined) {
      throw new Error("Invalid formation-transfer recipe: " + recipe.id);
    }
    const key = JSON.stringify([recipe.machineId, input.itemId]);
    const previous = routes.get(key);
    if (previous !== undefined) throw new Error("Conflicting formation recipes: " + previous + ", " + recipe.id);
    routes.set(key, recipe.id);
  }
}

// AI-REMOVED 2026-11-27:
// Reason: Worker 使用同一构建的 Registry，阵型比例与配方关系已经在网络编译时确定。
// Trigger: ST3-RQ-002 移除旧逐配方 behavior 输入和旧 Registry 快照迁移。
// Evidence: snapshotRegistryForWorker 对内置库省略快照，对自定义库传本次编译结果。
// Replacement: registry/index.ts 直接装配当前快照；network-registry.ts 校验同 ID 的 v1 程序。
// Risk: 旧开发版的内存快照不再重建。
// Human Review: Required
//
// Original code:
// import type { CustomRecipeDefinitionInput, RegistrySnapshot } from "@/domain/registry/types/custom-registry";
// import type { FormationDefinition, FormationEffect, FormationEffectDefinition } from "@/domain/registry/types/periodic-range-conversion";
// import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
// import { MAGIC_SPAWNER_FORMATION } from "@/shared/magic-spawner-range";
//
// /** 旧表允许短表延续末项；只比较相同层数实际生效的比例。 */
// export function checkFormationRatios(expected: readonly number[], supplied: readonly number[], path: string, owner: string): void {
//   if (!Array.isArray(supplied) || !supplied.length) throw new Error(path + ": 缺少阵型选格比例 " + owner);
//   for (let layer = 0; layer < Math.max(expected.length, supplied.length); layer++) {
//     if (expected[Math.min(layer, expected.length - 1)] !== supplied[Math.min(layer, supplied.length - 1)]) {
//       throw new Error(path + ": " + owner + " 第 " + (layer + 1) + " 层选格比例冲突");
//     }
//   }
// }
//
// type PreviousFormation = Omit<FormationDefinition, "effects"> & { machines: Record<FormationEffect, string> };
//
// /** Worker 及保存的注册表快照在此一次性收敛到与网络编译相同的数据结构。 */
// export function normalizeFormationSnapshot(snapshot: RegistrySnapshot): RegistrySnapshot {
//   const recipes: readonly (RecipeDefinition & { behavior?: CustomRecipeDefinitionInput["behavior"] })[] = snapshot.recipeDefinitions;
//   let definitions: readonly (FormationDefinition | PreviousFormation)[] = snapshot.formationDefinitions;
//   if (!definitions) {
//     const unknown = recipes.find(recipe => recipe.periodicRangeConversion && recipe.periodicRangeConversion.programId !== MAGIC_SPAWNER_FORMATION.id);
//     if (unknown) throw new Error("旧快照缺少阵列声明，请从网络配置重新装配 " + unknown.id);
//     definitions = recipes.some(recipe => recipe.machineId === MAGIC_SPAWNER_FORMATION.effects.ming.machineId) ? [MAGIC_SPAWNER_FORMATION] : [];
//   }
//   if (definitions === snapshot.formationDefinitions && definitions.every(group => "effects" in group)
//     && !recipes.some(recipe => recipe.behavior)) return snapshot;
//
//   const ratioOrigin = new Map<string, string>();
//   const formations = definitions.map(group => {
//     if ("effects" in group) return group;
//     const effectFor = (key: FormationEffect): FormationEffectDefinition => {
//       const machineId = group.machines[key];
//       if (group.id === MAGIC_SPAWNER_FORMATION.id) {
//         return { machineId, selectionRatioByLayer: MAGIC_SPAWNER_FORMATION.effects[key].selectionRatioByLayer };
//       }
//       const first = recipes.find(recipe => recipe.machineId === machineId && recipe.behavior);
//       if (!first?.behavior) throw new Error("旧快照缺少选格比例，请从网络配置重新装配 " + group.id + "/" + key);
//       ratioOrigin.set(machineId, first.id);
//       return { machineId, selectionRatioByLayer: first.behavior.params.chanceByLayer };
//     };
//     return { id: group.id, periodSeconds: group.periodSeconds, effects: { ming: effectFor("ming"), hui: effectFor("hui"), heng: effectFor("heng") } };
//   });
//   const machines = new Map(formations.flatMap(group => Object.values(group.effects).map(effect => [effect.machineId, effect] as const)));
//   const materials = recipes.map((recipe, index) => {
//     if (!recipe.behavior) return recipe;
//     const { behavior, ...material } = recipe;
//     const effect = machines.get(recipe.machineId);
//     if (!effect || behavior.behaviorId !== "formation-transfer") throw new Error("旧快照包含无效阵列配方 " + recipe.id);
//     const owner = [recipe.machineId, ratioOrigin.get(recipe.machineId), recipe.id].filter(Boolean).join(" / ");
//     checkFormationRatios(effect.selectionRatioByLayer, behavior.params.chanceByLayer, "$.recipeDefinitions[" + index + "].behavior", owner);
//     return material;
//   });
//   return { ...snapshot, formationDefinitions: formations, recipeDefinitions: materials };
// }
