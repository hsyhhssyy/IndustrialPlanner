import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { FormationDefinition } from "@/domain/registry/types/periodic-range-conversion";
import type { GridRect } from "@/domain/shared/grid";
import { findFormation } from "@/shared/formation-recipes";
import { compileFormationTransfer } from "./formation-transfer";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { findEntityRange, resolveLocalRangeGridRect } from "@/shared/geometry/entity-range";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { GridRectIndex } from "@/shared/geometry/grid-rect-index";
import {
  createPeriodicRangeRegionId,
  PERIODIC_RANGE_TIME_UNITS_PER_SECOND,
} from "@/shared/periodic-range-conversion";
import { isRecipeAvailableInChannel } from "@/shared/registry/recipe-channel-eligibility";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { convertSimulationSecondsToTicksExact, type CompiledSimulationTopology } from "../contracts";
import type { RecipeRandomSource } from "../recipe-selection";
import { PeriodicEnvironmentTransformation, type PeriodicEnvironmentCheckpoint } from "./periodic-transformation";

type SourceEffect = "ming" | "hui";
type TransformSlot = (slotId: string, transformItem: (itemId: string) => string) => void;
type PeriodicRuntime = PeriodicEnvironmentTransformation<string, string, string, string>;

export interface CompiledPeriodicEnvironment {
  readonly sourcesByDevice: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, SourceEffect>>>;
  readonly affectedSlotIds: ReadonlySet<string>;
  createRuntime(random: RecipeRandomSource, transformSlot: TransformSlot): PeriodicRuntime;
}

export function periodicEnvironmentSourceId(deviceId: string, channelId: string): string {
  return JSON.stringify([deviceId, channelId]);
}

/** 共同整数时基准确表示 Dense 4/2 和 Legacy 60/20 等仿真频率。 */
export function periodicEnvironmentTimeUnits(tickNumber: number, standardTickRate: number): number {
  return Math.max(0, tickNumber - 1) * PERIODIC_RANGE_TIME_UNITS_PER_SECOND / standardTickRate;
}

export function periodicEnvironmentTickAtTime(time: number, standardTickRate: number): number {
  return time * standardTickRate / PERIODIC_RANGE_TIME_UNITS_PER_SECOND + 1;
}

/** 能力声明不存在时不建立空间索引，也不实例化任何区域运行状态。 */
export function compilePeriodicEnvironment(
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
  canonicalSlotId: (slotId: string) => string,
): CompiledPeriodicEnvironment | null {

  const owners = new Set(registry.recipeDefinitions.filter(recipe => recipe.periodicRangeConversion)
    .map(recipe => recipe.ownerDeviceId ?? recipe.machineId));
  const behaviors = new Map<string, ReturnType<typeof compileFormationTransfer>>();
  const sourcesByDevice = new Map<string, Map<string, Map<string, SourceEffect>>>();
  const regions = new Map<string, {
    rect: GridRect;
    sourceIds: Set<string>;
    sourceDeviceIds: Set<string>;
    formation: FormationDefinition;
  }>();
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId]!;
    if (!owners.has(device.definitionId) || !device.position || !device.footprint || device.rotation === null || device.recipeChannels.length === 0) continue;
    const recipes = registry.queries.findRecipeDefinitionsByMachineScope(device.definitionId).filter(recipe =>
      recipe.periodicRangeConversion !== undefined && isRecipeAvailableByActivity(recipe, topology.activeActivityIds));
    if (recipes.length === 0) continue;
    const definition = registry.queries.findEntityDefinition(device.definitionId)!;
    const channels = new Map<string, Map<string, SourceEffect>>();
    for (const channel of device.recipeChannels) {
      const candidates = new Map<string, SourceEffect>();
      const sourceId = periodicEnvironmentSourceId(deviceId, channel.id);
      let sourceRegionIds: readonly string[] | undefined;
      for (const recipe of recipes) {
        if (!isRecipeAvailableInChannel(recipe, channel.id, device.recipeChannels)
          || recipe.tags.includes(CONSUMPTION_RECIPE_TAG) !== (channel.type === "consumption-channel")
          || (channel.manualRecipeOnly && channel.defaultRecipeId !== null && channel.defaultRecipeId !== recipe.id)) continue;
        const source = recipe.periodicRangeConversion!;
        const formation = findFormation(registry, source.programId);
        if (!behaviors.has(formation.id)) {
          if (convertSimulationSecondsToTicksExact(formation.periodSeconds, topology.standardTickRate) === null) {
            throw new Error("Invalid periodic range conversion duration: " + formation.id);
          }
          behaviors.set(formation.id, compileFormationTransfer(registry, formation, topology.activeActivityIds));
        }
        const candidateRegions = new Set<string>();
        for (const rangeId of channel.projectionRangeIds ?? source.rangeIds) {
          const range = findEntityRange(definition, rangeId);
          const rect = resolveLocalRangeGridRect(device.position, device.footprint, device.rotation, range.localRect);
          const regionId = createPeriodicRangeRegionId(topology.documentKey, formation.id, rect);
          let region = regions.get(regionId);
          if (region === undefined) {
            region = {
              rect,
              sourceIds: new Set(),
              sourceDeviceIds: new Set(),
              formation,
            };
            regions.set(regionId, region);
          }
          region.sourceIds.add(sourceId);
          region.sourceDeviceIds.add(deviceId);
          candidateRegions.add(regionId);
        }
        if (sourceRegionIds !== undefined
          && (sourceRegionIds.length !== candidateRegions.size || sourceRegionIds.some(id => !candidateRegions.has(id)))) {
          throw new Error(`Periodic range conversion candidates for ${deviceId}/${channel.id} must share a program and ranges.`);
        }
        sourceRegionIds = [...candidateRegions];
        candidates.set(recipe.id, source.side === 0 ? "ming" : "hui");
      }
      if (candidates.size > 0) channels.set(channel.id, candidates);
    }
    if (channels.size > 0) sourcesByDevice.set(deviceId, channels);
  }
  if (regions.size === 0) return null;

  const belts = topology.ordering.deviceOrder.flatMap(deviceId => {
    const device = topology.devices[deviceId]!;
    if (!device.position || !device.footprint || device.rotation === null || !registry.queries.isBelt(device.definitionId)) return [];
    const rect = { ...device.position, ...getRotatedGridFootprint(device.footprint, device.rotation) };
    const slotIds = device.nodeIds.flatMap(nodeId => topology.nodes[nodeId]!.slotIds.map(canonicalSlotId));
    return [{ rect, slotIds }];
  });
  const beltIndex = new GridRectIndex(belts, belt => belt.rect);
  const affectedSlotIds = new Set<string>();
  const definitions = [...regions].map(([regionId, {
    rect, sourceIds, sourceDeviceIds, formation,
  }]) => {
    const covered = beltIndex.intersecting(rect);
    const slotIds = [...new Set(covered.flatMap(belt => belt.slotIds))];
    for (const slotId of slotIds) {
      const slot = topology.slots[slotId];
      if (slot?.capacity !== 1) throw new Error(`Periodic range conversion requires a single-item belt slot: ${slotId}.`);
      affectedSlotIds.add(slotId);
    }
    return {
      regionId,
      formationId: formation.id,
      gridRect: rect,
      slotIds,
      sourceIds: [...sourceIds],
      sourceDeviceIds: [...sourceDeviceIds],
      periodMs: formation.periodSeconds * PERIODIC_RANGE_TIME_UNITS_PER_SECOND,
      settleItems: behaviors.get(formation.id)!,
    };
  });
  function migrateCheckpoint(saved: PeriodicEnvironmentCheckpoint<string, string>): PeriodicEnvironmentCheckpoint<string, string> {
    if (saved.regions.every(region => regions.has(region.regionId))) return saved;
    const sharedPhaseAliases = new Map<string, string[]>();
    for (const [deviceId, channels] of sourcesByDevice) {
      const owner = topology.devices[deviceId]!.definitionId;
      if (owner === "magic_spawner_1" || owner === "magic_spawner_2") {
        const ports = [...channels.keys()].filter(id => id === "east" || id === "south");
        sharedPhaseAliases.set(periodicEnvironmentSourceId(deviceId, "custom_periodic_phase"),
          ports.map(id => periodicEnvironmentSourceId(deviceId, id)));
      }
    }
    const migrated = saved.regions.map(region => {
      if (regions.has(region.regionId) || typeof region.regionId !== "string") return region;
      if (!region.regionId.startsWith("[")) return region;
      let parts: unknown;
      let old: unknown;
      try {
        parts = JSON.parse(region.regionId);
        if (!Array.isArray(parts) || typeof parts[1] !== "string" || !parts[1].startsWith("[")) return region;
        old = JSON.parse(parts[1]);
      } catch {
        return region;
      }
      if (!Array.isArray(old) || typeof old[0] !== "string" || old[1] !== region.periodMs) return region;
      return { ...region, regionId: JSON.stringify([parts[0], old[0], ...parts.slice(2)]),
        sourceIds: region.sourceIds.flatMap(id => sharedPhaseAliases.get(id) ?? [id]) };
    });
    if (migrated.every((region, index) => region === saved.regions[index])) return saved;
    return { ...saved, regions: migrated, sources: saved.sources.flatMap(([id, effect]) =>
      (sharedPhaseAliases.get(id) ?? [id]).map(source => [source, effect] as const)) };
  }
  return {
    sourcesByDevice,
    affectedSlotIds,
    createRuntime(random, transformSlot) {
      const runtime = new PeriodicEnvironmentTransformation<string, string, string, string>(random, transformSlot, migrateCheckpoint);
      for (const region of definitions) runtime.addRegion(region, 0);
      return runtime;
    },
  };
}

// AI-REMOVED 2026-11-26:
// Reason: ST3-RQ-002 区域钟只触发已绑定行为，按当前阵型、原料和层数结算。
// Trigger: 阵列四层必成、双口独立和跨读者单一配方来源的已确认需求。
// Evidence: 此文件的原有声明或消费者引用已迁入下述实现，回归清单见 ST3-RQ-002 执行日志。
// Replacement: simulation/environment/formation-transfer.ts 与 compile-periodic-environment.ts
// Risk: 恢复历史逻辑会同时启用两条业务路径。
// Human Review: Required
//
// Original code:
// import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
//
// import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
//
//   createPeriodicRangeProgramSignature,
//
// import { PeriodicEnvironmentTransformation } from "./periodic-transformation";
//
// function compileProgram(program: PeriodicRangeConversionProgram, registry: RegistryContract, standardTickRate: number) {
//   const periodMs = program.periodSeconds * PERIODIC_RANGE_TIME_UNITS_PER_SECOND;
//   if (!Number.isSafeInteger(periodMs) || convertSimulationSecondsToTicksExact(program.periodSeconds, standardTickRate) === null) {
//     throw new Error(`Invalid periodic range conversion duration: ${program.id}.`);
//   }
//   const compileEffect = (effect: PeriodicRangeConversionProgram["effects"][number]) => {
//     const probabilities = [...effect.probabilityByLayer];
//     if (probabilities.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
//       throw new Error(`Invalid periodic range conversion probability: ${program.id}.`);
//     }
//     const outputs = Object.entries(effect.outputItemByInputId).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
//     for (const [input, output] of outputs) {
//       if (registry.queries.resolveItemDomain(input) !== ItemDomainFlag.Solid
//         || registry.queries.resolveItemDomain(output) !== ItemDomainFlag.Solid) {
//         throw new Error(`Periodic range conversion requires solid items: ${program.id} (${input}, ${output}).`);
//       }
//     }
//     return { probabilities, outputs };
//   };
//   const ming = compileEffect(program.effects[0]);
//   const hui = compileEffect(program.effects[1]);
//   const heng = compileEffect(program.effects[2]);
//   return {
//     signature: createPeriodicRangeProgramSignature(program),
//     periodMs,
//     probabilities: { ming: ming.probabilities, hui: hui.probabilities, heng: heng.probabilities },
//     conversions: { ming: new Map(ming.outputs), hui: new Map(hui.outputs), heng: new Map(heng.outputs) },
//   };
// }
//
//
//   if (!registry.recipeDefinitions.some(recipe => recipe.periodicRangeConversion !== undefined)) return null;
//
//   const programsByDefinition = new Map<PeriodicRangeConversionProgram, ReturnType<typeof compileProgram>>();
//   const programSignaturesById = new Map<string, string>();
//
//     programSignature: string;
//     program: ReturnType<typeof compileProgram>;
//     saturateLayerProbability: boolean;
//
//     if (!device.position || !device.footprint || device.rotation === null || device.recipeChannels.length === 0) continue;
//
//         let program = programsByDefinition.get(source.program);
//         if (program === undefined) {
//           program = compileProgram(source.program, registry, topology.standardTickRate);
//           const signature = programSignaturesById.get(source.program.id);
//           if (signature !== undefined && signature !== program.signature) {
//             throw new Error(`Conflicting periodic range conversion program: ${source.program.id}.`);
//
//           programSignaturesById.set(source.program.id, program.signature);
//           programsByDefinition.set(source.program, program);
//
//         for (const rangeId of source.rangeIds) {
//
//           const regionId = JSON.stringify([topology.documentKey, program.signature, rect.x, rect.y, rect.width, rect.height]);
//
//               programSignature: program.signature,
//               program,
//               saturateLayerProbability: false,
//
//           region.saturateLayerProbability ||= Object.hasOwn(registry.customContent.recipeUuids, recipe.id);
//
//     rect, sourceIds, sourceDeviceIds, programSignature, program, saturateLayerProbability,
//
//       programSignature,
//
//       ...program,
//       saturateLayerProbability,
//
//       const runtime = new PeriodicEnvironmentTransformation<string, string, string, string>(random, transformSlot);
