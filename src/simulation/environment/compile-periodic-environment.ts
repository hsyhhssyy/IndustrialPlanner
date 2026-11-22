import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { PeriodicRangeConversionProgram } from "@/domain/registry/types/periodic-range-conversion";
import type { GridRect } from "@/domain/shared/grid";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { findEntityRange, resolveLocalRangeGridRect } from "@/shared/geometry/entity-range";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { GridRectIndex } from "@/shared/geometry/grid-rect-index";
import { isRecipeAvailableInChannel } from "@/shared/registry/recipe-channel-eligibility";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { convertSimulationSecondsToTicksExact, type CompiledSimulationTopology } from "../contracts";
import type { RecipeRandomSource } from "../recipe-selection";
import { PeriodicEnvironmentTransformation } from "./periodic-transformation";

type SourceEffect = "ming" | "hui";
type TransformSlot = (slotId: string, transformItem: (itemId: string) => string) => void;
type PeriodicRuntime = PeriodicEnvironmentTransformation<string, string, string, string>;
const TIME_UNITS_PER_SECOND = 3000;

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
  return Math.max(0, tickNumber - 1) * TIME_UNITS_PER_SECOND / standardTickRate;
}

export function periodicEnvironmentTickAtTime(time: number, standardTickRate: number): number {
  return time * standardTickRate / TIME_UNITS_PER_SECOND + 1;
}

function compileProgram(program: PeriodicRangeConversionProgram, registry: RegistryContract, standardTickRate: number) {
  const periodMs = program.periodSeconds * TIME_UNITS_PER_SECOND;
  if (!Number.isSafeInteger(periodMs) || convertSimulationSecondsToTicksExact(program.periodSeconds, standardTickRate) === null) {
    throw new Error(`Invalid periodic range conversion duration: ${program.id}.`);
  }
  const compileEffect = (effect: PeriodicRangeConversionProgram["effects"][number]) => {
    const probabilities = [...effect.probabilityByLayer];
    if (probabilities.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`Invalid periodic range conversion probability: ${program.id}.`);
    }
    const outputs = Object.entries(effect.outputItemByInputId).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [input, output] of outputs) {
      if (registry.queries.resolveItemDomain(input) !== ItemDomainFlag.Solid
        || registry.queries.resolveItemDomain(output) !== ItemDomainFlag.Solid) {
        throw new Error(`Periodic range conversion requires solid items: ${program.id} (${input}, ${output}).`);
      }
    }
    return { probabilities, outputs };
  };
  const ming = compileEffect(program.effects[0]);
  const hui = compileEffect(program.effects[1]);
  const heng = compileEffect(program.effects[2]);
  return {
    signature: JSON.stringify([program.id, periodMs, ming, hui, heng]),
    periodMs,
    probabilities: { ming: ming.probabilities, hui: hui.probabilities, heng: heng.probabilities },
    conversions: { ming: new Map(ming.outputs), hui: new Map(hui.outputs), heng: new Map(heng.outputs) },
  };
}

/** 能力声明不存在时不建立空间索引，也不实例化任何区域运行状态。 */
export function compilePeriodicEnvironment(
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
  canonicalSlotId: (slotId: string) => string,
): CompiledPeriodicEnvironment | null {
  if (!registry.recipeDefinitions.some(recipe => recipe.periodicRangeConversion !== undefined)) return null;

  const programsByDefinition = new Map<PeriodicRangeConversionProgram, ReturnType<typeof compileProgram>>();
  const programSignaturesById = new Map<string, string>();
  const sourcesByDevice = new Map<string, Map<string, Map<string, SourceEffect>>>();
  const regions = new Map<string, {
    rect: GridRect;
    sourceIds: Set<string>;
    program: ReturnType<typeof compileProgram>;
    saturateLayerProbability: boolean;
  }>();
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId]!;
    if (!device.position || !device.footprint || device.rotation === null || device.recipeChannels.length === 0) continue;
    const recipes = registry.queries.findRecipeDefinitionsByMachine(device.definitionId).filter(recipe =>
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
        let program = programsByDefinition.get(source.program);
        if (program === undefined) {
          program = compileProgram(source.program, registry, topology.standardTickRate);
          const signature = programSignaturesById.get(source.program.id);
          if (signature !== undefined && signature !== program.signature) {
            throw new Error(`Conflicting periodic range conversion program: ${source.program.id}.`);
          }
          programSignaturesById.set(source.program.id, program.signature);
          programsByDefinition.set(source.program, program);
        }
        const candidateRegions = new Set<string>();
        for (const rangeId of source.rangeIds) {
          const range = findEntityRange(definition, rangeId);
          const rect = resolveLocalRangeGridRect(device.position, device.footprint, device.rotation, range.localRect);
          const regionId = JSON.stringify([topology.documentKey, program.signature, rect.x, rect.y, rect.width, rect.height]);
          let region = regions.get(regionId);
          if (region === undefined) {
            region = { rect, sourceIds: new Set(), program, saturateLayerProbability: false };
            regions.set(regionId, region);
          }
          region.saturateLayerProbability ||= Object.hasOwn(registry.customContent.recipeUuids, recipe.id);
          region.sourceIds.add(sourceId);
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
  const definitions = [...regions].map(([regionId, { rect, sourceIds, program, saturateLayerProbability }]) => {
    const covered = beltIndex.intersecting(rect);
    const slotIds = [...new Set(covered.flatMap(belt => belt.slotIds))];
    for (const slotId of slotIds) {
      const slot = topology.slots[slotId];
      if (slot?.capacity !== 1) throw new Error(`Periodic range conversion requires a single-item belt slot: ${slotId}.`);
      affectedSlotIds.add(slotId);
    }
    return { regionId, slotIds, sourceIds: [...sourceIds], ...program, saturateLayerProbability };
  });
  return {
    sourcesByDevice,
    affectedSlotIds,
    createRuntime(random, transformSlot) {
      const runtime = new PeriodicEnvironmentTransformation<string, string, string, string>(random, transformSlot);
      for (const region of definitions) runtime.addRegion(region, 0);
      return runtime;
    },
  };
}
