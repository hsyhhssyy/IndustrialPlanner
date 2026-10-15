import { CropCultivationRuntime } from "../cultivation";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { compileDeviceStates, DeviceStateRuntime } from "../device-state";
import { CompiledEnvironment } from "../environment";
import { adjustReservedAmounts } from "./runtime-slot-access";
import { type CompiledSimulationTopology } from "../contracts";
import type { SimulationMutableRuntimeState } from "./runtime-state";

interface LegacyStateContext {
  readonly machines: DeviceStateRuntime;
  readonly cultivation: CropCultivationRuntime;
  readonly machineByDevice: ReadonlyMap<string, number>;
  readonly environment: CompiledEnvironment;
  readonly bindingByDeviceRecipe: ReadonlyMap<string, ReadonlyMap<string, number>>;
}
const contexts = new WeakMap<SimulationMutableRuntimeState, { topology: CompiledSimulationTopology; context: LegacyStateContext }>();
const statePresence = new WeakMap<CompiledSimulationTopology, boolean>();

/** 无状态机的场景不创建运行态；恢复时由持久状态重建需求计数。 */
function contextFor(registry: RegistryContract, topology: CompiledSimulationTopology, state: SimulationMutableRuntimeState): LegacyStateContext | null {
  let present = statePresence.get(topology);
  if (present === undefined) {
    present = topology.ordering.deviceOrder.some(id => registry.queries.findEntityDefinition(topology.devices[id]!.definitionId)?.stateMachine !== undefined);
    statePresence.set(topology, present);
  }
  if (!present) return null;
  const cached = contexts.get(state);
  if (cached?.topology === topology) return cached.context;
  const machines = new DeviceStateRuntime(compileDeviceStates(topology, registry));
  const checkpoint = machines.checkpoint();
  const machineByDevice = new Map<string, number>();
  machines.programs.forEach((program, index) => {
    machineByDevice.set(program.deviceId, index);
    const saved = state.persistent.devices[program.deviceId]?.deviceState;
    if (!saved) return;
    const stateIndex = program.states.findIndex(entry => entry.id === saved.stateId);
    if (stateIndex < 0) throw new Error(`Unknown saved device state: ${saved.stateId}`);
    checkpoint.indexes[index] = stateIndex;
    checkpoint.enteredSeconds[index] = saved.enteredAtSeconds;
    checkpoint.timerStartedSeconds[index] = saved.timerStartedAtSeconds ?? Infinity;
    checkpoint.deadlineSeconds[index] = saved.endsAtSeconds ?? Infinity;
  });
  machines.restore(checkpoint);
  const recipes = topology.ordering.deviceOrder.flatMap(deviceId => registry.queries.findRecipeDefinitionsByMachine(topology.devices[deviceId]!.definitionId).map(recipe => ({ deviceId, recipe })));
  const environment = new CompiledEnvironment(topology, registry, recipes);
  const bindingByDeviceRecipe = new Map<string, Map<string, number>>();
  recipes.forEach(({ deviceId, recipe }, index) => {
    let entries = bindingByDeviceRecipe.get(deviceId);
    if (!entries) { entries = new Map(); bindingByDeviceRecipe.set(deviceId, entries); }
    entries.set(recipe.id, index);
  });
  const cultivation = new CropCultivationRuntime(topology, registry, machines);
  cultivation.restoreSnapshots(state.persistent.cultivationSeconds ?? 0, id => state.persistent.devices[id]?.cultivation);
  const context = { machines, cultivation, machineByDevice, environment, bindingByDeviceRecipe };
  machines.programs.forEach((program, index) => {
    const current = program.states[machines.indexes[index]!];
    if (current?.enterRecipeId) changeDemand(context, program.deviceId, current.enterRecipeId, 1);
  });
  contexts.set(state, { topology, context });
  return context;
}

function changeDemand(context: LegacyStateContext, deviceId: string, recipeId: string, delta: 1 | -1): void {
  const binding = context.bindingByDeviceRecipe.get(deviceId)?.get(recipeId);
  if (binding !== undefined) context.environment.demand(context.environment.bindings[binding]!, delta);
}

export function processDeviceStates(registry: RegistryContract, topology: CompiledSimulationTopology, state: SimulationMutableRuntimeState): void {
  const context = contextFor(registry, topology, state);
  if (!context) return;
  const seconds = Math.max(0, state.tickNumber - 1) / topology.standardTickRate;
  context.cultivation.advance(seconds);
  context.machines.process(seconds,
    (index, previous, next) => {
      context.cultivation.stateChanged(index, next);
      const program = context.machines.programs[index]!;
      const oldRecipe = program.states[previous]?.enterRecipeId;
      const newRecipe = program.states[next]!.enterRecipeId;
      if (oldRecipe) changeDemand(context, program.deviceId, oldRecipe, -1);
      const device = state.persistent.devices[program.deviceId]!;
      const running = device.channelRecipes[program.channelId];
      if (previous >= 0 && running) {
        adjustReservedAmounts(state, running.reservations, -1);
        device.channelRecipes[program.channelId] = null;
      }
      if (newRecipe) changeDemand(context, program.deviceId, newRecipe, 1);
      state.persistent.devices[program.deviceId]!.deviceState = context.machines.snapshot(index);
    });
  context.cultivation.refresh();
  for (const id of context.cultivation.changedDevices) state.persistent.devices[id]!.cultivation = context.cultivation.snapshot(id);
  context.cultivation.changedDevices.clear();
  state.persistent.cultivationSeconds = seconds;
}

export function notifyStateRecipeCompleted(registry: RegistryContract, topology: CompiledSimulationTopology, state: SimulationMutableRuntimeState, deviceId: string, recipeId: string): void {
  const context = contextFor(registry, topology, state);
  const index = context?.machineByDevice.get(deviceId);
  if (index !== undefined) context!.machines.completed(index, recipeId);
}

export function stateRequestedRecipe(registry: RegistryContract, topology: CompiledSimulationTopology, state: SimulationMutableRuntimeState, deviceId: string): string | null {
  const context = contextFor(registry, topology, state);
  const index = context?.machineByDevice.get(deviceId);
  if (index === undefined) return null;
  return context!.machines.programs[index]!.states[context!.machines.indexes[index]!]!.enterRecipeId;
}

export function hasEnvironmentDemand(registry: RegistryContract, topology: CompiledSimulationTopology, state: SimulationMutableRuntimeState, deviceId: string, recipeId: string): boolean {
  const context = contextFor(registry, topology, state);
  const index = context?.bindingByDeviceRecipe.get(deviceId)?.get(recipeId);
  if (index === undefined) return false;
  const provider = context!.environment.bindings[index]!.providerIndex;
  return provider >= 0 && context!.environment.providerDemand[provider]! > 0;
}
