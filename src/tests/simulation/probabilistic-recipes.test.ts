import { describe, expect, it } from "vitest";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { RECIPE_DEFINITIONS } from "@/registry/recipe-definition";
import { compileSimulationTopology } from "@/simulation/topology";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { RecipeRandom, type RecipeRandomSource } from "@/simulation/recipe-selection";
import { compileDenseTopologyLayout, DENSE_SIMULATION_PROTOCOL_VERSION } from "@/simulation/dense/dense-topology";
import { DenseWorkerRuntime } from "@/simulation/dense/dense-worker-runtime";
import { DenseProjectionStore } from "@/simulation/dense/dense-frame-delta";
import type { DenseWorkerRequest, DenseWorkerResponse } from "@/simulation/dense/dense-worker-protocol";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";

function recipe(id: string, probability?: number, extras: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return { id, nameKey: id, machineId: "grinder_1", recipeType: "immediate-consume", tags: [], durationSeconds: 0.5,
    inputs: [{ itemId: "item_iron_nugget", amount: 1 }], outputs: [{ itemId: "item_iron_powder", amount: 1 }], probability, ...extras };
}

/** 使用真实 Registry 查询和蓝图编译，只替换本需求尚未配入存量数据的配方事实。 */
function scene(recipes: RecipeDefinition[], options: { twoDevices?: boolean; sibling?: boolean; policy?: "state" | "environment-demand"; manual?: boolean } = {}) {
  const base = createRegistryContract();
  const recipeDefinitions = [...base.recipeDefinitions.filter(entry => entry.machineId !== "grinder_1"), ...recipes];
  const entityDefinitions = base.entityDefinitions.map((entity): EntityDefinition => {
    if (entity.id !== "grinder_1") return entity;
    if (options.sibling) return { ...entity, recipeChannels: [...entity.recipeChannels, { ...entity.recipeChannels[0]!, id: "secondary" }] };
    if (options.policy || options.manual) return { ...entity,
      recipeChannels: entity.recipeChannels.map(channel => ({ ...channel, startPolicy: options.policy ?? "automatic", manualRecipeOnly: options.manual })),
      ...(options.policy === "state" ? { stateMachine: { channelId: entity.recipeChannels[0]!.id, initialStateId: "initial", states: [{ id: "initial", nameKey: "initial", enterRecipeId: "b", transitions: [] }] } } : {}),
    };
    return entity;
  });
  const registry = { ...base, recipeDefinitions, entityDefinitions,
    queries: createRegistryQuery({ entityDefinitions, recipeDefinitions, itemDefinitions: base.itemDefinitions }) };
  const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile(`src/tests/fixtures/blueprints/simulation/probabilistic-recipes/${options.twoDevices ? "two-devices" : "single"}.schema7.json`));
  const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base", standardTickRate: 2, poweredEntityIds: new Set(document.entityOrder) });
  expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
  const layout = compileDenseTopologyLayout(topology, registry);
  const kernel = (random?: RecipeRandomSource) => new DenseSimulationKernel(topology, layout, registry, undefined, random);
  return { registry, topology, layout, kernel };
}

function machineSnapshot(kernel: DenseSimulationKernel, device = 0) {
  const index = kernel.layout.dictionary.deviceIds.findIndex(id => kernel.topology.devices[id]!.sourceEntityId === `machine-${device + 1}`);
  if (index < 0) throw new Error("Missing fixture machine");
  return kernel.createDeviceSnapshot(index);
}

function selected(kernel: DenseSimulationKernel, device = 0): string | null {
  // AI-REMOVED 2026-11-02:
  // Reason: 编译器补齐基地设备，字典首项并非测试设备。
  // Trigger: 新测试返回 null，装配修正已获主代理确认。
  // Evidence: sourceEntityId 保留版本化场景设备身份。
  // Replacement: machineSnapshot
  // Risk: Low
  // Human Review: Required
  // Original code:
  // return Object.values(kernel.createDeviceSnapshot(device).channelRecipes)[0]?.recipeId ?? null;
  return Object.values(machineSnapshot(kernel, device).channelRecipes)[0]?.recipeId ?? null;
}

function fixedSample(value: number) {
  let calls = 0;
  return { next: () => { calls++; return value; }, get calls() { return calls; } };
}

const probabilityCases: Array<[string, (number | undefined)[], number, string]> = [
  ["混合低于 1 的首区间", [0.2, 0.3, undefined], 0, "a"],
  ["精确 0.2 边界归后区间", [0.2, 0.3, undefined], 0.2, "b"],
  ["精确 0.5 边界回退普通", [0.2, 0.3, undefined], 0.5, "c"],
  ["混合剩余区间", [0.2, 0.3, undefined], 0.99, "c"],
  ["混合总和等于 1", [0.4, 0.6, undefined], 0.99, "b"],
  ["混合超过 1 首区间", [0.8, 0.6, undefined], 0.5, "a"],
  ["混合超过 1 后区间", [0.8, 0.6, undefined], 0.9, "b"],
  ["全部概率低于 1 仍归一化", [0.2, 0.3], 0.9, "b"],
  ["全部概率精确加权边界", [1, 1], 0.5, "b"],
  ["单项超过 1", [2, 1, undefined], 0.5, "a"],
  ["有限大权重之和溢出", [Number.MAX_VALUE, Number.MAX_VALUE, undefined], 0.75, "b"],
  ["极小正权重", [Number.MIN_VALUE, Number.MIN_VALUE], 0.5, "b"],
];

describe("ST2-RQ-046 概率选择", () => {
  it.each(probabilityCases)("%s", (_name, probabilities, sample, expected) => {
    const test = scene(probabilities.map((probability, index) => recipe(String.fromCharCode(97 + index), probability)));
    const random = fixedSample(sample);
    const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    expect(selected(kernel)).toBe(expected);
    expect(random.calls).toBe(1);
    const checkpoint = kernel.createCheckpoint();
    // AI-REMOVED 2026-11-02:
    // Reason: 仓库也有同物品的预定义槽，必须锁定版本化场景设备。
    // Trigger: 新测试读取自动仓库空槽，装配修正已获主代理确认。
    // Evidence: 正确输入槽由 sourceEntityId=machine-1 标识。
    // Replacement: 下方设备和初始物品联合筛选。
    // Risk: Low
    // Human Review: Required
    // Original code:
    // const ingredient = test.layout.dictionary.slotIds.findIndex(id => test.topology.slots[id]!.initialItemType === "item_iron_nugget");
    const ingredient = test.layout.dictionary.slotIds.findIndex(id => {
      const slot = test.topology.slots[id]!;
      return slot.initialItemType === "item_iron_nugget"
        && test.topology.devices[test.topology.nodes[slot.nodeId]!.deviceId]!.sourceEntityId === "machine-1";
    });
    expect(checkpoint.slotCounts[test.layout.slotStorageIndexes[ingredient]!]).toBe(49);
    expect(Array.from(checkpoint.slotReserved).every(amount => amount === 0)).toBe(true);
  });

  it.each([
    ["无候选", [] as RecipeDefinition[], null],
    ["单普通", [recipe("a")], "a"],
    ["单概率", [recipe("a", 0.001)], "a"],
    ["全普通保持既有次序", [recipe("b"), recipe("a")], "a"],
    ["概率配方缺料后仅剩一个普通", [recipe("a", 100, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] }), recipe("b")], "b"],
    ["普通缺料后单概率直接执行", [recipe("a", undefined, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] }), recipe("b", 0.01)], "b"],
    ["未满足环境的概率不参与", [recipe("a", 10, { requiredEnvironmentAnyOf: ["item_gas_water"] }), recipe("b")], "b"],
    ["过滤概率后多普通保持次序", [recipe("a", 10, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] }), recipe("b"), recipe("c")], "b"],
  ])("%s 不推进随机源", (_name, recipes, expected) => {
    const test = scene(recipes as RecipeDefinition[]);
    const random = fixedSample(0.9);
    const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    expect(selected(kernel)).toBe(expected);
    expect(random.calls).toBe(0);
  });

  it("不可执行概率不占区间，普通回退按既有顺序", () => {
    const test = scene([recipe("a", 100, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] }), recipe("b", 0.2), recipe("c"), recipe("d")]);
    const random = fixedSample(0.2); const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    expect(selected(kernel)).toBe("c"); expect(random.calls).toBe(1);
  });

  it("多 channel 排他并读取上个提交后的真实剩余原料", () => {
    const test = scene([recipe("a", 1, { inputs: [{ itemId: "item_iron_nugget", amount: 30 }] }), recipe("b", 1, { inputs: [{ itemId: "item_iron_nugget", amount: 30 }] })], { sibling: true });
    const random = fixedSample(0); const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    const running = Object.values(machineSnapshot(kernel).channelRecipes).filter(Boolean);
    expect(running.map(entry => entry!.recipeId)).toEqual(["a"]);
    expect(random.calls).toBe(1);
  });

  it("多 channel 对同一配方排他，单个剩余候选不重复抽样", () => {
    const test = scene([recipe("a", 1), recipe("b", 1)], { sibling: true });
    const random = fixedSample(0); const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    expect(Object.values(machineSnapshot(kernel).channelRecipes).filter(Boolean).map(entry => entry!.recipeId)).toEqual(["a", "b"]);
    expect(random.calls).toBe(1);
  });

  it("状态指定配方不被其他概率候选抢占，也不抽样", () => {
    const test = scene([recipe("a", 100), recipe("b", 0.001)], { policy: "state" });
    const random = fixedSample(0); const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    expect(selected(kernel)).toBe("b"); expect(random.calls).toBe(0);
  });

  it("状态指定配方缺料时不会回退到概率配方", () => {
    const test = scene([recipe("a", 100), recipe("b", 0.001, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] })], { policy: "state" });
    const random = fixedSample(0); const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    expect(selected(kernel)).toBeNull(); expect(random.calls).toBe(0);
  });

  it.each([{ policy: "environment-demand" as const }, { manual: true }])("无环境需求或未指定手动配方时，不启动且不抽样 %j", options => {
    const test = scene([recipe("a", 1), recipe("b", 1)], options);
    const random = fixedSample(0); const kernel = test.kernel(random);
    kernel.advanceToTick(5);
    expect(selected(kernel)).toBeNull(); expect(random.calls).toBe(0);
  });

  it("reserved-item 候选筛选不预占多个配方，只预占最终命中", () => {
    const test = scene([recipe("a", 1, { recipeType: "reserved-item" }), recipe("b", 1, { recipeType: "reserved-item" })]);
    const random = fixedSample(0.75); const kernel = test.kernel(random);
    kernel.advanceToTick(1);
    expect(selected(kernel)).toBe("b"); expect(random.calls).toBe(1);
    expect(Array.from(kernel.createCheckpoint().slotReserved).reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it("停电不豁免概率候选准入，恢复供电才抽样", () => {
    const test = scene([recipe("a", 1), recipe("b", 1)]);
    const random = fixedSample(0); const kernel = test.kernel(random);
    kernel.setPowerMode("real"); kernel.setPowerConsumptionOverride(1e12);
    kernel.advanceToTick(1);
    expect(selected(kernel)).toBeNull(); expect(random.calls).toBe(0);
    kernel.setPowerMode("infinite"); kernel.advanceToTick(2);
    expect(selected(kernel)).toBe("a"); expect(random.calls).toBe(1);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("非法概率 %s 在正式 Registry 构建与外部 Registry Dense 编译均报错", probability => {
    const invalid = recipe("rq046-invalid", probability);
    RECIPE_DEFINITIONS.push(invalid);
    try { expect(() => createRegistryContract()).toThrow(/rq046-invalid.*probability|probability.*rq046-invalid/); }
    finally { RECIPE_DEFINITIONS.pop(); }
    const test = scene([invalid]);
    expect(() => test.kernel()).toThrow(/probability.*rq046-invalid/);
  });
});

function workerScene() {
  const test = scene([recipe("a", 1), recipe("b", 1)]);
  const runtime = new DenseWorkerRuntime(test.registry);
  let sequence = 0; let topologyVersion = 1;
  const sessionId = "rq046";
  let projection: DenseProjectionStore;
  type Payload = DenseWorkerRequest extends infer Request ? Request extends DenseWorkerRequest ? Omit<Request, "protocolVersion" | "sessionId" | "sequence" | "topologyVersion"> : never : never;
  const request = (payload: Payload): DenseWorkerResponse => {
    const response = runtime.handleRequest({ protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION, sessionId, topologyVersion, sequence: ++sequence, ...payload } as DenseWorkerRequest);
    if (response.type === "protocol-error") throw new Error(response.message);
    if (response.type === "frame-delta") projection.apply(response.delta);
    if (response.type === "presentation-checkpoint") {
      if (payload.type === "switch-presentation") projection = new DenseProjectionStore(test.layout.dictionary, { sessionId, topologyVersion });
      projection.replaceCheckpoint(response.delta);
    }
    return response;
  };
  const initialize = (migration?: { baseTickNumber: number; resetDeviceIds: string[] }) => {
    if (migration) { topologyVersion++; sequence = 0; }
    const result = request({ type: "initialize-session", topology: test.topology, powerMode: "infinite", powerConsumptionOverride: undefined, perfEnabled: false, debugDataEnabled: false, migration });
    if (result.type !== "topology-ready") throw new Error(result.type);
    const store = new DenseProjectionStore(result.layout.dictionary, { sessionId, topologyVersion });
    store.apply(result.initialDelta);
    return store;
  };
  projection = initialize();
  return { test, request,
    advance(tick: number) {
      const result = request({ type: "advance-budget", targetTickNumber: tick, wallTimeBudgetMs: 1000 });
      if (result.type !== "frame-delta" && result.type !== "presentation-checkpoint") throw new Error(result.type);
      // AI-REMOVED 2026-11-02:
      // Reason: 真实投影必须接收 initialDelta 及所有中间帧，且不能使用自动补齐设备作为观测目标。
      // Trigger: 新测试 frame sequence 异常，装配修正已获主代理确认。
      // Evidence: DenseProjectionStore.validateDelta 要求连续帧号。
      // Replacement: request 中统一应用返回帧，initialize 中应用 initialDelta。
      // Risk: Low
      // Human Review: Required
      // Original code:
      // projection.replaceCheckpoint(result.delta);
      // return Object.values(projection.materializeSnapshot().devices)[0]!.channelRecipes;
      const deviceId = test.layout.dictionary.deviceIds.find(id => test.topology.devices[id]!.sourceEntityId === "machine-1")!;
      return projection.getDevice(deviceId)!.channelRecipes;
    },
    migrate(tick: number) { projection = initialize({ baseTickNumber: tick, resetDeviceIds: [] }); },
    restart() { runtime.reset(); sequence = 0; projection = initialize(); },
  };
}

function workerSelected(worker: ReturnType<typeof workerScene>, tick: number): string | null {
  return Object.values(worker.advance(tick))[0]?.recipeId ?? null;
}

describe("ST2-RQ-046 固定随机源生命周期", () => {
  it("xorshift32 固定种子输出由已知序列锁定", () => {
    const random = new RecipeRandom();
    expect(Array.from({ length: 5 }, () => Math.round(random.next() * 0xffffffff + 1))).toEqual([1085196063, 2447379481, 2618286376, 1701901981, 265159372]);
  });

  it("所有设备共享一个序列，独立 kernel 与交错运行互不影响", () => {
    const test = scene([recipe("a", 1), recipe("b", 1)], { twoDevices: true });
    const first = test.kernel(); const second = test.kernel(); const random = new RecipeRandom();
    for (let tick = 1; tick <= 12; tick++) {
      first.advanceToTick(tick); second.advanceToTick(tick);
      expect(first.createCheckpoint()).toEqual(second.createCheckpoint());
      for (let device = 0; device < 2; device++) expect(selected(first, device)).toBe(random.next() < 0.5 ? "a" : "b");
    }
  });

  it("checkpoint 不包含随机状态，同 kernel 恢复继续消耗序列", () => {
    const test = scene([recipe("a", 1), recipe("b", 1)]);
    const random = fixedSample(0.25); const kernel = test.kernel(random);
    const checkpoint = kernel.createCheckpoint();
    expect(Object.keys(checkpoint).filter(key => /random/i.test(key))).toEqual([]);
    kernel.advanceToTick(1); expect(random.calls).toBe(1);
    kernel.restoreCheckpoint(checkpoint); kernel.advanceToTick(1); expect(random.calls).toBe(2);
  });

  it("Worker 暂停继续与持续运行相同，重启返回初始序列", () => {
    const first = workerScene(); const second = workerScene();
    const before: (string | null)[] = [];
    for (let tick = 1; tick <= 12; tick++) {
      if (tick === 5) {
        first.request({ type: "command-batch", commands: [{ type: "pause" }] });
        first.request({ type: "command-batch", commands: [{ type: "resume" }] });
      }
      before.push(workerSelected(first, tick));
      expect(before.at(-1)).toBe(workerSelected(second, tick));
    }
    first.restart();
    for (let tick = 1; tick <= 12; tick++) expect(workerSelected(first, tick)).toBe(before[tick - 1]);
  });

  it("时间轴重算与预缓冲消耗同一序列，展示切换不重置", () => {
    const worker = workerScene(); const random = new RecipeRandom();
    const next = () => random.next() < 0.5 ? "a" : "b";
    expect(workerSelected(worker, 1)).toBe(next());
    worker.request({ type: "request-presentation-checkpoint", tickNumber: 0 });
    // 从 tick 0 重算 tick 1，将消耗下一次实际抽样。
    // AI-CORRECTION 2026-11-02: 此处 tick 1 等于主 kernel 当前 tick，直接投影且不抽样；下方预缓冲才实际抽样。
    worker.request({ type: "request-presentation-checkpoint", tickNumber: 1 });
    // tick 1 已是主 kernel 当前点，无需重算；请求 tick 2 才抽样。
    worker.request({ type: "ensure-buffered-through", tickNumber: 2 }); next();
    expect(workerSelected(worker, 2)).toBe(next());
    worker.request({ type: "switch-presentation", tickNumber: 2, presentationDeviceIds: worker.test.layout.dictionary.deviceIds, operatingStatusDeviceIds: [] });
    expect(workerSelected(worker, 3)).toBe(next());
  });

  it("非 checkpoint 相位历史重算继续推进会话随机源", () => {
    const worker = workerScene(); const random = new RecipeRandom();
    for (let tick = 1; tick <= 4; tick++) { random.next(); workerSelected(worker, tick); }
    worker.request({ type: "request-presentation-checkpoint", tickNumber: 1 }); random.next();
    expect(workerSelected(worker, 5)).toBe(random.next() < 0.5 ? "a" : "b");
  });

  it("拓扑迁移复用随机源而非从种子重新开始", () => {
    const worker = workerScene(); const random = new RecipeRandom();
    for (let tick = 1; tick <= 3; tick++) { expect(workerSelected(worker, tick)).toBe(random.next() < 0.5 ? "a" : "b"); }
    worker.migrate(3);
    expect(workerSelected(worker, 4)).toBe(random.next() < 0.5 ? "a" : "b");
  });
});
