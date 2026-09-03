import {
  BELT_TRANSPORT_DURATION_SECONDS,
  PIPE_TRANSPORT_DURATION_SECONDS,
} from "@/domain/registry";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { resolveRecipeItemDomainFlags } from "@/domain/shared/item-domain-flags";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";
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
} from "../types";
import {
  DENSE_INDEX_NONE,
  createDenseTopologyLookup,
  type DenseTopologyLayout,
} from "./dense-topology";

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
  readonly recipeType: SimulationRecipeType;
  readonly durationTicks: number;
  readonly inputs: readonly DenseRecipeItemRule[];
  readonly outputs: readonly DenseRecipeItemRule[];
  readonly requiredGasItemIndex: number;
  readonly gasDiffusionOutput: {
    readonly itemIndex: number;
    readonly range: number;
  } | null;
  readonly warehouseSubmit: boolean;
  readonly powerOutput: number;
}

export interface DenseRecipeChannelProgram {
  readonly index: number;
  readonly deviceIndex: number;
  readonly channelId: string;
  readonly ingredientSlotIndexes: Uint32Array;
  readonly productSlotIndexes: Uint32Array;
  readonly candidates: readonly DenseRecipeProgram[];
  readonly producer: boolean;
  readonly consumptionChannel: boolean;
  readonly transportPeriodTicks: number;
}

export interface DenseRecipeProgramSet {
  readonly channels: readonly DenseRecipeChannelProgram[];
  readonly deviceChannelOffsets: Uint32Array;
  readonly deviceChannelIndexes: Uint32Array;
}

export function compileDenseRecipePrograms(
  topology: CompiledSimulationTopology,
  layout: DenseTopologyLayout,
  registry: RegistryContract,
): DenseRecipeProgramSet {
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
      channels.push({
        index,
        deviceIndex,
        channelId: channel.id,
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
        candidates: compileChannelCandidates({
          topology,
          layout,
          registry,
          device,
          channel,
          itemIndexById: lookup.itemIndexById,
        }),
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

  return {
    channels,
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
  if (transportPeriodTicks > 0) {
    const isBelt = options.registry.queries.isBeltFamily(options.device.definitionId);
    const durationSeconds = isBelt
      ? BELT_TRANSPORT_DURATION_SECONDS
      : PIPE_TRANSPORT_DURATION_SECONDS;
    return [{
      recipeId: `${options.device.definitionId}:${isBelt
        ? "dynamic-belt-transfer"
        : "dynamic-pipe-transfer"}`,
      recipeType: "reserved-item",
      durationTicks: Math.max(
        1,
        Math.round(durationSeconds * options.topology.standardTickRate),
      ),
      inputs: [{ kind: DENSE_RECIPE_ITEM_ANY, value: DENSE_INDEX_NONE, amount: 1 }],
      outputs: [{
        kind: DENSE_RECIPE_ITEM_SAME_AS_INPUT,
        value: DENSE_INDEX_NONE,
        amount: 1,
      }],
      requiredGasItemIndex: DENSE_INDEX_NONE,
      gasDiffusionOutput: null,
      warehouseSubmit: false,
      powerOutput: 0,
    }];
  }

  const recipes = resolveRegistryRecipes(options);
  return recipes
    .map((recipe) => compileRecipeProgram(recipe, options.itemIndexById, options.topology))
    .sort(compareRecipeEfficiency);
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
): DenseRecipeProgram {
  return {
    recipeId: recipe.id,
    recipeType: recipe.recipeType,
    durationTicks: Math.max(1, Math.round(recipe.durationSeconds * topology.standardTickRate)),
    inputs: recipe.inputs.map((input) => compileItemRule(input, itemIndexById, false)),
    outputs: recipe.outputs.map((output) => compileItemRule(output, itemIndexById, true)),
    requiredGasItemIndex: recipe.requiredGasDiffusion === undefined
      ? DENSE_INDEX_NONE
      : requireItemIndex(itemIndexById, recipe.requiredGasDiffusion),
    gasDiffusionOutput: recipe.gasDiffusionOutput === undefined
      ? null
      : {
          itemIndex: requireItemIndex(itemIndexById, recipe.gasDiffusionOutput.gasItemId),
          range: recipe.gasDiffusionOutput.range,
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
      Math.max(1, Math.round(BELT_TRANSPORT_DURATION_SECONDS * topology.standardTickRate)),
      topology.standardTickRate,
    );
  }
  if (registry.queries.isPipeFamily(definitionId)) {
    return Math.min(
      Math.max(1, Math.round(PIPE_TRANSPORT_DURATION_SECONDS * topology.standardTickRate)),
      topology.standardTickRate,
    );
  }
  return 0;
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
