import type { RegistryContract } from "@/domain/registry/registry-contract";
import { compileDeviceStates, DeviceStateRuntime } from "../device-state";
import { CompiledEnvironment } from "../environment";
import { isSimulationWholeSecondTick, type CompiledSimulationTopology } from "../contracts";
import type { SimulationMutableRuntimeState } from "./runtime-state";

interface LegacyStateContext {
  readonly machines: DeviceStateRuntime;
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
  const context = { machines, machineByDevice, environment, bindingByDeviceRecipe };
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
  context.machines.process(Math.max(0, state.tickNumber - 1) / topology.standardTickRate,
    isSimulationWholeSecondTick(state.tickNumber, topology.standardTickRate), (index, previous, next) => {
      const program = context.machines.programs[index]!;
      const oldRecipe = program.states[previous]?.enterRecipeId;
      const newRecipe = program.states[next]!.enterRecipeId;
      if (oldRecipe) changeDemand(context, program.deviceId, oldRecipe, -1);
      if (newRecipe) changeDemand(context, program.deviceId, newRecipe, 1);
      state.persistent.devices[program.deviceId]!.deviceState = context.machines.snapshot(index);
    });
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
