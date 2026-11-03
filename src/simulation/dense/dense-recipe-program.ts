import { CompiledEnvironment, type EnvironmentRecipeBinding } from "../environment";
import { findEntityRange } from "@/shared/geometry/entity-range";
import type { GridRect } from "@/domain/shared/grid";
import {
  BELT_TRANSPORT_DURATION_SECONDS,
  PIPE_TRANSPORT_DURATION_SECONDS,
} from "@/domain/registry";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { resolveRecipeItemDomainFlags } from "@/domain/shared/item-domain-flags";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
import { validateRecipeProbability } from "@/shared/registry/recipe-probability";
import {
  WATER_PURIFIER_BYPRODUCT_CHANNEL_ID,
  WATER_PURIFIER_BYPRODUCT_RECIPE_ID,
  WATER_PURIFIER_COLLECT_RECIPE_ID,
  WATER_PURIFIER_INTAKE_CHANNEL_IDS,
  WATER_PURIFIER_NODE_ENTITY_ID,
} from "@/shared/water-purifier-node";

import type {
  CompiledSimulationDevice,
  CompiledSimulationRecipeChannel,
  CompiledSimulationTopology,
  SimulationRecipeType,
} from "../contracts";
import { convertSimulationSecondsToTicksExact } from "../contracts";
import { DENSE_INDEX_NONE, createDenseTopologyLookup, type DenseTopologyLayout } from "./dense-topology";

export const DENSE_RECIPE_ITEM_EXACT = 0;
export const DENSE_RECIPE_ITEM_ANY = 1;
export const DENSE_RECIPE_ITEM_DOMAIN = 2;
export const DENSE_RECIPE_ITEM_SAME_AS_INPUT = 3;

export interface DenseRecipeItemRule {
  readonly kind:
    | typeof DENSE_RECIPE_ITEM_EXACT
    | typeof DENSE_RECIPE_ITEM_ANY
    | typeof DENSE_RECIPE_ITEM_DOMAIN
    | typeof DENSE_RECIPE_ITEM_SAME_AS_INPUT;
  readonly value: number;
  readonly amount: number;
}

export interface DenseRecipeProgram {
  readonly recipeId: string;
  readonly probability?: number;
  readonly recipeType: SimulationRecipeType;
  readonly durationTicks: number;
  readonly inputs: readonly DenseRecipeItemRule[];
  readonly outputs: readonly DenseRecipeItemRule[];
  readonly requiredEnvironmentItemIndexes: readonly number[];
  readonly environmentBinding: EnvironmentRecipeBinding;
  readonly warehouseOutput: boolean;
  readonly environmentOutput: {
    readonly itemIndex: number;
    readonly rangeId: string;
    readonly localRect: GridRect;
  } | null;
  readonly warehouseSubmit: boolean;
  readonly powerOutput: number;
}

export interface DenseRecipeChannelProgram {
  readonly index: number;
  readonly deviceIndex: number;
  readonly channelId: string;
  readonly startPolicy: "automatic" | "state" | "environment-demand";
  readonly ingredientSlotIndexes: Uint32Array;
  readonly productSlotIndexes: Uint32Array;
  readonly candidates: readonly DenseRecipeProgram[];
  readonly hasProbabilityCandidates: boolean;
  readonly producer: boolean;
  readonly consumptionChannel: boolean;
  readonly transportPeriodTicks: number;
}

export interface DenseRecipeProgramSet {
  readonly environment: CompiledEnvironment;
  readonly startChannelIndexes: Uint32Array;
  readonly providerChannelIndexes: Uint32Array;
  readonly channels: readonly DenseRecipeChannelProgram[];
  readonly deviceChannelOffsets: Uint32Array;
  readonly deviceChannelIndexes: Uint32Array;
}

export function compileDenseRecipePrograms(
  topology: CompiledSimulationTopology,
  layout: DenseTopologyLayout,
  registry: RegistryContract,
): DenseRecipeProgramSet {
  registry.recipeDefinitions.forEach(validateRecipeProbability);
  const lookup = createDenseTopologyLookup(layout.dictionary);
  const channels: DenseRecipeChannelProgram[] = [];
  const deviceChannelOffsets = new Uint32Array(layout.dictionary.deviceIds.length + 1);
  const deviceChannelIndexes: number[] = [];

  for (let deviceIndex = 0; deviceIndex < layout.dictionary.deviceIds.length; deviceIndex += 1) {
    const deviceId = layout.dictionary.deviceIds[deviceIndex]!;
    const device = topology.devices[deviceId];
    if (device === undefined) {
      throw new Error(`Dense recipe compiler cannot resolve device "${deviceId}".`);
    }
    deviceChannelOffsets[deviceIndex] = deviceChannelIndexes.length;
    for (const channel of device.recipeChannels) {
      const index = channels.length;
      const candidates = compileChannelCandidates({ topology, layout, registry, device, channel, itemIndexById: lookup.itemIndexById });
      channels.push({
        index,
        deviceIndex,
        channelId: channel.id,
        startPolicy: channel.startPolicy ?? "automatic",
        ingredientSlotIndexes: collectChannelSlotIndexes(
          topology,
          layout,
          lookup.slotIndexById,
          channel.ingredientNodeIds,
        ),
        productSlotIndexes: collectChannelSlotIndexes(
          topology,
          layout,
          lookup.slotIndexById,
          channel.productNodeIds,
        ),
        // AI-REMOVED 2026-11-02:
        // Reason: 编译结果需同时派生概率快速路径标记，避免重复编译。
        // Trigger: ST2-RQ-046。
        // Evidence: channel 编译仅在此入口构造候选。
        // Replacement: 上方 candidates 局部变量。
        // Risk: Low
        // Human Review: Required
        // Original code:
        // candidates: compileChannelCandidates({
        //   topology,
        //   layout,
        //   registry,
        //   device,
        //   channel,
        //   itemIndexById: lookup.itemIndexById,
        // }),
        candidates,
        hasProbabilityCandidates: candidates.some(recipe => recipe.probability !== undefined),
        producer: registry.queries
          .findEntityDefinition(device.definitionId)
          ?.tags.includes("Producer") === true,
        consumptionChannel: channel.type === "consumption-channel",
        transportPeriodTicks: resolveTransportPeriodTicks(
          topology,
          registry,
          device.definitionId,
        ),
      });
      deviceChannelIndexes.push(index);
    }
  }
  deviceChannelOffsets[layout.dictionary.deviceIds.length] = deviceChannelIndexes.length;

  const environment = new CompiledEnvironment(topology, registry, channels.flatMap(channel => channel.candidates.map(recipe => ({
    deviceId: layout.dictionary.deviceIds[channel.deviceIndex]!, recipe: {
      requiredEnvironmentAnyOf: recipe.requiredEnvironmentItemIndexes.map(index => layout.dictionary.itemIds[index]!),
      environmentOutput: recipe.environmentOutput === null ? undefined : { itemId: layout.dictionary.itemIds[recipe.environmentOutput.itemIndex]!, rangeId: recipe.environmentOutput.rangeId },
    },
  }))));
  let bindingIndex = 0;
  const boundChannels = channels.map(channel => ({ ...channel, candidates: channel.candidates.map(recipe => ({ ...recipe, environmentBinding: environment.bindings[bindingIndex++]! })) }));
  const priority = (channel: DenseRecipeChannelProgram) => channel.consumptionChannel ? 0 : channel.candidates.some(recipe => recipe.environmentOutput !== null) ? 1 : 2;
  return {
    environment,
    startChannelIndexes: Uint32Array.from([...boundChannels].sort((a, b) => priority(a) - priority(b)), channel => channel.index),
    providerChannelIndexes: Uint32Array.from(boundChannels.filter(channel => channel.candidates.some(recipe => recipe.environmentOutput !== null)), channel => channel.index),
    channels: boundChannels,
    deviceChannelOffsets,
    deviceChannelIndexes: Uint32Array.from(deviceChannelIndexes),
  };
}

export function resolveDenseDeviceTransportPeriodTicks(
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
  definitionId: string,
): number {
  return resolveTransportPeriodTicks(topology, registry, definitionId);
}

function compileChannelCandidates(options: {
  readonly topology: CompiledSimulationTopology;
  readonly layout: DenseTopologyLayout;
  readonly registry: RegistryContract;
  readonly device: CompiledSimulationDevice;
  readonly channel: CompiledSimulationRecipeChannel;
  readonly itemIndexById: ReadonlyMap<string, number>;
}): readonly DenseRecipeProgram[] {
  const transportPeriodTicks = resolveTransportPeriodTicks(
    options.topology,
    options.registry,
    options.device.definitionId,
  );
  const registryCandidates = resolveRegistryRecipes(options)
    .map(recipe => compileRecipeProgram(recipe, options.itemIndexById, options.topology, options.registry));
  if (transportPeriodTicks > 0 && !options.channel.manualRecipeOnly && options.channel.type !== "consumption-channel") {
    const isBelt = options.registry.queries.isBeltFamily(options.device.definitionId);
    const durationSeconds = isBelt
      ? BELT_TRANSPORT_DURATION_SECONDS
      : PIPE_TRANSPORT_DURATION_SECONDS;
    const transport: DenseRecipeProgram = {
      recipeId: `${options.device.definitionId}:${isBelt
        ? "dynamic-belt-transfer"
        : "dynamic-pipe-transfer"}`,
      recipeType: "reserved-item",
      durationTicks: requireExactDurationTicks(
        durationSeconds,
        options.topology.standardTickRate,
        `${options.device.definitionId}:transport`,
      ),
      inputs: [{ kind: DENSE_RECIPE_ITEM_ANY, value: DENSE_INDEX_NONE, amount: 1 }],
      outputs: [{
        kind: DENSE_RECIPE_ITEM_SAME_AS_INPUT,
        value: DENSE_INDEX_NONE,
        amount: 1,
      }],
      requiredEnvironmentItemIndexes: [],
      environmentBinding: { conditions: new Uint32Array(0), providerIndex: -1 },
      warehouseOutput: false,
      environmentOutput: null,
      warehouseSubmit: false,
      powerOutput: 0,
    };
    return [transport, ...registryCandidates].sort(compareRecipeEfficiency);
  }

  // AI-REMOVED 2026-11-03:
  // Reason: 动态运输不能提前排除 Registry 自动候选。
  // Trigger: ST2-RQ-046-BUG-001 双引擎传送带变异回归失败。
  // Evidence: 真实环境正常且20个输入全部仍为原矿，候选仅含动态运输。
  // Replacement: 同函数下方统一组合动态运输与 Registry 候选。
  // AI-CORRECTION 2026-11-03: Dense 组合位于此记录上方的 transport 分支，普通分支复用 registryCandidates。
  // Risk: Medium；需回归相位、手选、活动和物流域锁。
  // Human Review: Required
  // Original code:
  // const recipes = resolveRegistryRecipes(options);
  // return recipes
  //   .map((recipe) => compileRecipeProgram(recipe, options.itemIndexById, options.topology, options.registry))
  //   .sort(compareRecipeEfficiency);
  return registryCandidates.sort(compareRecipeEfficiency);
}

function resolveRegistryRecipes(options: {
  readonly topology: CompiledSimulationTopology;
  readonly registry: RegistryContract;
  readonly device: CompiledSimulationDevice;
  readonly channel: CompiledSimulationRecipeChannel;
}): readonly RecipeDefinition[] {
  const recipes = options.registry.queries
    .findRecipeDefinitionsByMachine(options.device.definitionId)
    .filter((recipe) => isRecipeAvailableByActivity(recipe, options.topology.activeActivityIds))
    .filter((recipe) => recipe.tags.includes(CONSUMPTION_RECIPE_TAG)
      === (options.channel.type === "consumption-channel"));
  if (options.device.definitionId === WATER_PURIFIER_NODE_ENTITY_ID) {
    const allowedRecipeId = resolveWaterPurifierAllowedRecipeId(options.channel.id);
    if (
      allowedRecipeId === null
      || (
        options.device.waterPurifierNode?.outputMode === "manual-rate"
        && allowedRecipeId === WATER_PURIFIER_BYPRODUCT_RECIPE_ID
      )
    ) {
      return [];
    }
    return recipes.filter((recipe) => recipe.id === allowedRecipeId);
  }
  if (!options.channel.manualRecipeOnly) {
    return recipes;
  }
  return options.channel.defaultRecipeId === null
    ? []
    : recipes.filter((recipe) => recipe.id === options.channel.defaultRecipeId);
}

function resolveWaterPurifierAllowedRecipeId(channelId: string): string | null {
  if ((WATER_PURIFIER_INTAKE_CHANNEL_IDS as readonly string[]).includes(channelId)) {
    return WATER_PURIFIER_COLLECT_RECIPE_ID;
  }
  return channelId === WATER_PURIFIER_BYPRODUCT_CHANNEL_ID
    ? WATER_PURIFIER_BYPRODUCT_RECIPE_ID
    : null;
}

function compileRecipeProgram(
  recipe: RecipeDefinition,
  itemIndexById: ReadonlyMap<string, number>,
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
): DenseRecipeProgram {
  // AI-REMOVED 2026-11-02:
  // Reason: 入口已对全部配方集中校验，不重复校验每台设备的编译候选。
  // Trigger: ST2-RQ-046。
  // Evidence: compileDenseRecipePrograms 入口遍历 registry.recipeDefinitions。
  // Replacement: compileDenseRecipePrograms
  // Risk: Low
  // Human Review: Required
  // Original code:
  // validateRecipeProbability(recipe);
  return {
    recipeId: recipe.id,
    probability: recipe.probability,
    recipeType: recipe.recipeType,
    durationTicks: requireExactDurationTicks(
      recipe.durationSeconds,
      topology.standardTickRate,
      recipe.id,
    ),
    inputs: recipe.inputs.map((input) => compileItemRule(input, itemIndexById, false)),
    outputs: recipe.outputs.map((output) => compileItemRule(output, itemIndexById, true)),
    requiredEnvironmentItemIndexes: (recipe.requiredEnvironmentAnyOf ?? []).map(id => requireItemIndex(itemIndexById, id)),
    environmentBinding: { conditions: new Uint32Array(0), providerIndex: -1 },
    warehouseOutput: recipe.outputTarget === "warehouse",
    environmentOutput: recipe.environmentOutput === undefined
      ? null
      : {
          itemIndex: requireItemIndex(itemIndexById, recipe.environmentOutput.itemId),
          rangeId: recipe.environmentOutput.rangeId,
          localRect: findEntityRange(
            registry.queries.findEntityDefinition(recipe.machineId)!, recipe.environmentOutput.rangeId,
          ).localRect,
        },
    warehouseSubmit: recipe.id === "r_warehouse_submit",
    powerOutput: recipe.powerOutput ?? 0,
  };
}

function compileItemRule(
  item: { readonly itemId: string; readonly amount: number },
  itemIndexById: ReadonlyMap<string, number>,
  output: boolean,
): DenseRecipeItemRule {
  if (item.itemId === "any") {
    return {
      kind: output ? DENSE_RECIPE_ITEM_SAME_AS_INPUT : DENSE_RECIPE_ITEM_ANY,
      value: DENSE_INDEX_NONE,
      amount: item.amount,
    };
  }
  if (output && item.itemId === "same-as-input") {
    return {
      kind: DENSE_RECIPE_ITEM_SAME_AS_INPUT,
      value: DENSE_INDEX_NONE,
      amount: item.amount,
    };
  }
  const domainFlags = resolveRecipeItemDomainFlags(item.itemId);
  if (domainFlags !== null) {
    if (output) {
      throw new Error(`Dense recipe output cannot use domain placeholder "${item.itemId}".`);
    }
    return {
      kind: DENSE_RECIPE_ITEM_DOMAIN,
      value: domainFlags,
      amount: item.amount,
    };
  }
  return {
    kind: DENSE_RECIPE_ITEM_EXACT,
    value: requireItemIndex(itemIndexById, item.itemId),
    amount: item.amount,
  };
}

function collectChannelSlotIndexes(
  topology: CompiledSimulationTopology,
  layout: DenseTopologyLayout,
  slotIndexById: ReadonlyMap<string, number>,
  nodeIds: readonly string[],
): Uint32Array {
  const indexes: number[] = [];
  const seenStorageIndexes = new Set<number>();
  for (const nodeId of nodeIds) {
    const node = topology.nodes[nodeId];
    if (node === undefined) {
      continue;
    }
    for (const slotId of node.slotIds) {
      const slotIndex = slotIndexById.get(slotId);
      if (slotIndex === undefined) {
        throw new Error(`Dense recipe compiler cannot resolve slot "${slotId}".`);
      }
      const storageIndex = layout.slotStorageIndexes[slotIndex]!;
      if (seenStorageIndexes.has(storageIndex)) {
        continue;
      }
      seenStorageIndexes.add(storageIndex);
      indexes.push(slotIndex);
    }
  }
  return Uint32Array.from(indexes);
}

function resolveTransportPeriodTicks(
  topology: CompiledSimulationTopology,
  registry: RegistryContract,
  definitionId: string,
): number {
  if (registry.queries.isBeltFamily(definitionId)) {
    return Math.min(
      requireExactDurationTicks(
        BELT_TRANSPORT_DURATION_SECONDS,
        topology.standardTickRate,
        `${definitionId}:belt-transport`,
      ),
      topology.standardTickRate,
    );
  }
  if (registry.queries.isPipeFamily(definitionId)) {
    return Math.min(
      requireExactDurationTicks(
        PIPE_TRANSPORT_DURATION_SECONDS,
        topology.standardTickRate,
        `${definitionId}:pipe-transport`,
      ),
      topology.standardTickRate,
    );
  }
  return 0;
}

function requireExactDurationTicks(
  durationSeconds: number,
  standardTickRate: number,
  recipeId: string,
): number {
  const durationTicks = convertSimulationSecondsToTicksExact(
    durationSeconds,
    standardTickRate,
  );
  if (durationTicks === null) {
    throw new Error(
      `Dense recipe "${recipeId}" duration ${durationSeconds}s is not exactly representable at ${standardTickRate} TPS.`,
    );
  }
  return durationTicks;
}

function requireItemIndex(index: ReadonlyMap<string, number>, itemId: string): number {
  const value = index.get(itemId);
  if (value === undefined) {
    throw new Error(`Dense recipe compiler cannot resolve item "${itemId}".`);
  }
  return value;
}

function compareRecipeEfficiency(left: DenseRecipeProgram, right: DenseRecipeProgram): number {
  const outputDifference = sumAmounts(right.outputs) - sumAmounts(left.outputs);
  if (outputDifference !== 0) {
    return outputDifference;
  }
  const inputDifference = sumAmounts(left.inputs) - sumAmounts(right.inputs);
  return inputDifference !== 0
    ? inputDifference
    : compareStableIds(left.recipeId, right.recipeId);
}

function sumAmounts(items: readonly DenseRecipeItemRule[]): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
