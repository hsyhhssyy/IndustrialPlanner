import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { DeviceStateMachineDefinition } from "@/domain/registry/types/entity-definition";
import type { SimulationDeviceStateReadModel } from "@/domain/simulation/types/simulation-types";
import type { CompiledSimulationTopology } from "../contracts";

export interface DeviceStateProgram {
  readonly deviceId: string;
  readonly channelId: string;
  readonly initialIndex: number;
  readonly states: readonly {
    readonly id: string;
    readonly enterRecipeId: string | null;
    readonly completionRecipeId: string | null;
    readonly durationSeconds: number | null;
    readonly nextIndex: number;
    readonly visualKey: string | null;
  }[];
}

export interface DeviceStateCheckpoint {
  readonly indexes: Int32Array;
  readonly enteredSeconds: Float64Array;
  readonly deadlineSeconds: Float64Array;
}

/** 编译时解析全部跳转；运行时不查询 Registry、不比较设备定义 ID。 */
export function compileDeviceStates(topology: CompiledSimulationTopology, registry: RegistryContract): readonly DeviceStateProgram[] {
  const result: DeviceStateProgram[] = [];
  for (const deviceId of topology.ordering.deviceOrder) {
    const device = topology.devices[deviceId]!;
    const machine = registry.queries.findEntityDefinition(device.definitionId)?.stateMachine;
    if (machine === undefined) continue;
    validateMachine(machine, device.definitionId, registry);
    const indexes = new Map(machine.states.map((state, index) => [state.id, index]));
    if (!device.recipeChannels.some(channel => channel.id === machine.channelId && channel.startPolicy === "state")) {
      throw new Error(`State machine channel is missing: ${deviceId}:${machine.channelId}`);
    }
    result.push({ deviceId, channelId: machine.channelId, initialIndex: indexes.get(machine.initialStateId)!,
      states: machine.states.map(state => ({ id: state.id, enterRecipeId: state.enterRecipeId ?? null,
        completionRecipeId: state.transition.kind === "recipe-completed" ? state.transition.recipeId : null,
        durationSeconds: state.transition.kind === "elapsed" ? state.transition.durationSeconds : null,
        nextIndex: indexes.get(state.transition.nextStateId)!, visualKey: state.visualKey ?? null })) });
  }
  return result;
}

function validateMachine(machine: DeviceStateMachineDefinition, definitionId: string, registry: RegistryContract): void {
  const ids = new Set(machine.states.map(state => state.id));
  if (ids.size !== machine.states.length || !ids.has(machine.initialStateId)) throw new Error(`Invalid state IDs: ${definitionId}`);
  for (const state of machine.states) {
    if (!ids.has(state.transition.nextStateId)) throw new Error(`Invalid state target: ${definitionId}:${state.id}`);
    if (state.transition.kind === "elapsed" && (!Number.isSafeInteger(state.transition.durationSeconds) || state.transition.durationSeconds <= 0)) {
      throw new Error(`State duration must be a positive integer: ${definitionId}:${state.id}`);
    }
    for (const recipeId of [state.enterRecipeId, state.transition.kind === "recipe-completed" ? state.transition.recipeId : undefined]) {
      if (recipeId !== undefined && registry.queries.findRecipeDefinition(recipeId)?.machineId !== definitionId) {
        throw new Error(`Invalid state recipe: ${definitionId}:${recipeId}`);
      }
    }
  }
}

/** 稀疏状态机运行数据；时间以仿真秒保存，调速不转换也不舍入。 */
export class DeviceStateRuntime {
  public readonly indexes: Int32Array;
  public readonly enteredSeconds: Float64Array;
  public readonly deadlineSeconds: Float64Array;
  private readonly pending: number[] = [];
  private readonly pendingFlags: Uint8Array;
  private nextDeadline = Infinity;

  public constructor(public readonly programs: readonly DeviceStateProgram[]) {
    this.indexes = new Int32Array(programs.length).fill(-1);
    this.enteredSeconds = new Float64Array(programs.length);
    this.deadlineSeconds = new Float64Array(programs.length).fill(Infinity);
    this.pendingFlags = new Uint8Array(programs.length);
    for (let index = 0; index < programs.length; index++) this.enqueue(index);
  }

  public completed(index: number, recipeId: string): void {
    if (index < 0) return;
    const stateIndex = this.indexes[index]!;
    if (stateIndex >= 0 && this.programs[index]!.states[stateIndex]!.completionRecipeId === recipeId) this.enqueue(index);
  }

  public process(seconds: number, wholeSecond: boolean, changed: (index: number, previous: number, next: number) => void): void {
    if (wholeSecond && seconds >= this.nextDeadline) {
      this.nextDeadline = Infinity;
      for (let index = 0; index < this.programs.length; index++) {
        const deadline = this.deadlineSeconds[index]!;
        if (deadline <= seconds) this.enqueue(index);
        else this.nextDeadline = Math.min(this.nextDeadline, deadline);
      }
    }
    for (const index of this.pending) {
      this.pendingFlags[index] = 0;
      const previous = this.indexes[index]!;
      const program = this.programs[index]!;
      const next = previous < 0 ? program.initialIndex : program.states[previous]!.nextIndex;
      const state = program.states[next]!;
      this.indexes[index] = next;
      this.enteredSeconds[index] = seconds;
      this.deadlineSeconds[index] = state.durationSeconds === null ? Infinity : seconds + state.durationSeconds;
      this.nextDeadline = Math.min(this.nextDeadline, this.deadlineSeconds[index]!);
      changed(index, previous, next);
    }
    this.pending.length = 0;
  }

  public snapshot(index: number): SimulationDeviceStateReadModel | undefined {
    const stateIndex = this.indexes[index];
    if (stateIndex === undefined || stateIndex < 0) return undefined;
    const state = this.programs[index]!.states[stateIndex]!;
    return { stateId: state.id, enteredAtSeconds: this.enteredSeconds[index]!,
      endsAtSeconds: Number.isFinite(this.deadlineSeconds[index]!) ? this.deadlineSeconds[index]! : null,
      visualKey: state.visualKey };
  }

  public checkpoint(): DeviceStateCheckpoint {
    return { indexes: this.indexes.slice(), enteredSeconds: this.enteredSeconds.slice(), deadlineSeconds: this.deadlineSeconds.slice() };
  }

  public restore(checkpoint: DeviceStateCheckpoint): void {
    if ([checkpoint.indexes.length, checkpoint.enteredSeconds.length, checkpoint.deadlineSeconds.length].some(size => size !== this.programs.length)) {
      throw new Error("Device state checkpoint shape mismatch.");
    }
    this.pending.length = 0;
    this.pendingFlags.fill(0);
    this.nextDeadline = Infinity;
    for (let index = 0; index < this.programs.length; index++) {
      const stateIndex = checkpoint.indexes[index]!;
      if (stateIndex < -1 || stateIndex >= this.programs[index]!.states.length) throw new Error("Invalid device state checkpoint index.");
      if (stateIndex < 0) this.enqueue(index);
      this.nextDeadline = Math.min(this.nextDeadline, checkpoint.deadlineSeconds[index]!);
    }
    this.indexes.set(checkpoint.indexes);
    this.enteredSeconds.set(checkpoint.enteredSeconds);
    this.deadlineSeconds.set(checkpoint.deadlineSeconds);
  }

  private enqueue(index: number): void {
    if (this.pendingFlags[index]) return;
    this.pendingFlags[index] = 1;
    this.pending.push(index);
  }
}
