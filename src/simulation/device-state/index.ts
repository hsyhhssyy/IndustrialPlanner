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
    readonly durationSeconds: number | null;
    // AI-REMOVED 2026-10-15:
    // Reason: 单个完成条件和目标无法表达同层级分支。
    // Trigger: 育种完成优先于生长计时到期。
    // Evidence: 原状态只能编译一条迁移，无法同时保留两个目标。
    // Replacement: 下方有序 transitions 数组。
    // Risk: Low - 所有消费者已统一迁移。
    // Human Review: Required
    // Original code:
    // readonly completionRecipeId: string | null;
    // readonly nextIndex: number;
    readonly transitions: readonly {
      readonly completionRecipeId: string | null;
      readonly nextIndex: number;
      readonly inheritTimer: boolean;
    }[];
    readonly visualKey: string | null;
  }[];
}

export interface DeviceStateCheckpoint {
  readonly indexes: Int32Array;
  readonly enteredSeconds: Float64Array;
  readonly timerStartedSeconds: Float64Array;
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
        durationSeconds: state.timerDurationSeconds ?? null,
        transitions: state.transitions.map(transition => ({
          completionRecipeId: transition.kind === "recipe-completed" ? transition.recipeId : null,
          nextIndex: indexes.get(transition.nextStateId)!, inheritTimer: transition.inheritTimer === true,
        })), visualKey: state.visualKey ?? null })) });
  }
  return result;
}

function validateMachine(machine: DeviceStateMachineDefinition, definitionId: string, registry: RegistryContract): void {
  const ids = new Set(machine.states.map(state => state.id));
  if (ids.size !== machine.states.length || !ids.has(machine.initialStateId)) throw new Error(`Invalid state IDs: ${definitionId}`);
  for (const state of machine.states) {
    if (state.timerDurationSeconds !== undefined
      && (!Number.isFinite(state.timerDurationSeconds) || state.timerDurationSeconds <= 0)) {
      throw new Error(`State duration must be positive: ${definitionId}:${state.id}`);
    }
    for (const transition of state.transitions) {
      if (!ids.has(transition.nextStateId)) throw new Error(`Invalid state target: ${definitionId}:${state.id}`);
      if (transition.kind === "recipe-completed" && transition.recipeId !== state.enterRecipeId) {
        throw new Error(`Completion must refer to the state's requested recipe: ${definitionId}:${state.id}`);
      }
    }
    if (state.enterRecipeId !== undefined && registry.queries.findRecipeDefinition(state.enterRecipeId)?.machineId !== definitionId) {
      throw new Error(`Invalid state recipe: ${definitionId}:${state.enterRecipeId}`);
    }
  }
  // 同一状态可能从不同路径进入；逐一校验有/无计时器的可达情况。
  const byId = new Map(machine.states.map(state => [state.id, state]));
  const initial = byId.get(machine.initialStateId)!;
  const pending = [{ state: initial, hasTimer: initial.timerDurationSeconds !== undefined }];
  const visited = new Set<string>();
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const { state, hasTimer } = pending[cursor]!;
    const key = state.id + ":" + hasTimer;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const transition of state.transitions) {
      if (!hasTimer && (transition.kind === "elapsed" || transition.inheritTimer)) {
        throw new Error(`State transition requires a timer: ${definitionId}:${state.id}`);
      }
      const target = byId.get(transition.nextStateId)!;
      pending.push({ state: target, hasTimer: transition.inheritTimer ? hasTimer : target.timerDurationSeconds !== undefined });
    }
  }
}

/** 稀疏状态机运行数据；时间以仿真秒保存，调速不转换也不舍入。 */
export class DeviceStateRuntime {
  public readonly indexes: Int32Array;
  public readonly enteredSeconds: Float64Array;
  public readonly timerStartedSeconds: Float64Array;
  public readonly deadlineSeconds: Float64Array;
  private readonly pending: number[] = [];
  private readonly pendingFlags: Uint8Array;
  private nextDeadline = Infinity;
  private readonly completedRecipes: (string | null)[];

  public constructor(public readonly programs: readonly DeviceStateProgram[]) {
    this.indexes = new Int32Array(programs.length).fill(-1);
    this.enteredSeconds = new Float64Array(programs.length);
    this.timerStartedSeconds = new Float64Array(programs.length).fill(Infinity);
    this.completedRecipes = Array<string | null>(programs.length).fill(null);
    this.deadlineSeconds = new Float64Array(programs.length).fill(Infinity);
    this.pendingFlags = new Uint8Array(programs.length);
    for (let index = 0; index < programs.length; index++) this.enqueue(index);
  }

  public completed(index: number, recipeId: string): void {
    if (index < 0) return;
    const stateIndex = this.indexes[index]!;
    if (stateIndex >= 0 && this.programs[index]!.states[stateIndex]!.transitions.some(transition => transition.completionRecipeId === recipeId)) {
      this.completedRecipes[index] = recipeId;
      this.enqueue(index);
    }
  }

  public process(seconds: number, changed: (index: number, previous: number, next: number) => void): void {
    if (seconds >= this.nextDeadline) {
      this.nextDeadline = Infinity;
      for (let index = 0; index < this.programs.length; index++) {
        const deadline = this.deadlineSeconds[index]!;
        if (deadline <= seconds) this.enqueue(index);
        else this.nextDeadline = Math.min(this.nextDeadline, deadline);
      }
    }
    for (const index of this.pending) {
      this.pendingFlags[index] = 0;
      const program = this.programs[index]!;
      let hops = 0;
      while (true) {
        const previous = this.indexes[index]!;
        const transition = previous < 0 ? null : program.states[previous]!.transitions.find(candidate =>
          candidate.completionRecipeId === null ? this.deadlineSeconds[index]! <= seconds
            : candidate.completionRecipeId === this.completedRecipes[index]);
        if (previous >= 0 && !transition) break;
        if (++hops > program.states.length + 1) throw new Error(`Instant state transition cycle: ${program.deviceId}`);
        const next = previous < 0 ? program.initialIndex : transition!.nextIndex;
        const state = program.states[next]!;
        this.completedRecipes[index] = null;
        this.indexes[index] = next;
        this.enteredSeconds[index] = seconds;
        if (!transition?.inheritTimer) {
          this.timerStartedSeconds[index] = state.durationSeconds === null ? Infinity : seconds;
          this.deadlineSeconds[index] = state.durationSeconds === null ? Infinity : seconds + state.durationSeconds;
        }
        changed(index, previous, next);
      }
      this.completedRecipes[index] = null;
      // 无到期迁移的状态允许保留计时信息，但不能重复进入到期队列。
      const current = program.states[this.indexes[index]!]!;
      if (current.transitions.some(transition => transition.completionRecipeId === null)) {
        this.nextDeadline = Math.min(this.nextDeadline, this.deadlineSeconds[index]!);
      }
    }
    this.pending.length = 0;
  }

  public snapshot(index: number): SimulationDeviceStateReadModel | undefined {
    const stateIndex = this.indexes[index];
    if (stateIndex === undefined || stateIndex < 0) return undefined;
    const state = this.programs[index]!.states[stateIndex]!;
    return { stateId: state.id, enteredAtSeconds: this.enteredSeconds[index]!,
      timerStartedAtSeconds: Number.isFinite(this.timerStartedSeconds[index]!) ? this.timerStartedSeconds[index]! : null,
      endsAtSeconds: Number.isFinite(this.deadlineSeconds[index]!) ? this.deadlineSeconds[index]! : null,
      visualKey: state.visualKey };
  }

  public checkpoint(): DeviceStateCheckpoint {
    return { indexes: this.indexes.slice(), enteredSeconds: this.enteredSeconds.slice(), timerStartedSeconds: this.timerStartedSeconds.slice(), deadlineSeconds: this.deadlineSeconds.slice() };
  }

  public restore(checkpoint: DeviceStateCheckpoint): void {
    if ([checkpoint.indexes.length, checkpoint.enteredSeconds.length, checkpoint.timerStartedSeconds.length, checkpoint.deadlineSeconds.length].some(size => size !== this.programs.length)) {
      throw new Error("Device state checkpoint shape mismatch.");
    }
    this.pending.length = 0;
    this.pendingFlags.fill(0);
    this.completedRecipes.fill(null);
    this.nextDeadline = Infinity;
    for (let index = 0; index < this.programs.length; index++) {
      const stateIndex = checkpoint.indexes[index]!;
      if (stateIndex < -1 || stateIndex >= this.programs[index]!.states.length) throw new Error("Invalid device state checkpoint index.");
      if (stateIndex < 0) this.enqueue(index);
      this.nextDeadline = Math.min(this.nextDeadline, checkpoint.deadlineSeconds[index]!);
    }
    this.indexes.set(checkpoint.indexes);
    this.enteredSeconds.set(checkpoint.enteredSeconds);
    this.timerStartedSeconds.set(checkpoint.timerStartedSeconds);
    this.deadlineSeconds.set(checkpoint.deadlineSeconds);
  }

  private enqueue(index: number): void {
    if (this.pendingFlags[index]) return;
    this.pendingFlags[index] = 1;
    this.pending.push(index);
  }
}
