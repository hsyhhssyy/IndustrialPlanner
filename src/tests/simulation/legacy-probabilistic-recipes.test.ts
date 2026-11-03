import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";
import { compileSimulationTopology } from "@/simulation/topology";
import { RecipeRandom, type RecipeRandomSource } from "@/simulation/recipe-selection";
import { createSimulationMutableRuntimeState } from "@/simulation/legacy/runtime-state";
import { startRecipes } from "@/simulation/legacy/stage-7-start-recipes";
import { SimulationWorkerRuntime } from "@/simulation/legacy/worker-runtime";
import { TimelineWorkerRuntime } from "@/simulation/legacy/timeline-worker-runtime";
import { createLegacyBlueprintEngine } from "@/simulation/legacy/blueprint-engine";
import { createSimulationHost } from "@/simulation/simulation-host";
import type { RuntimeTickSnapshot } from "@/simulation/contracts";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { createHeadlessWorkspace } from "./blueprint-runner";

function recipe(id: string, probability?: number, extras: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return { id, nameKey: id, machineId: "grinder_1", recipeType: "immediate-consume", tags: [], durationSeconds: 0.5,
    inputs: [{ itemId: "item_iron_nugget", amount: 1 }], outputs: [{ itemId: "item_iron_powder", amount: 1 }], probability, ...extras };
}

/** 同一版本化场景由正式 compiler 装配；仅注入尚未存在于存量数据的概率配方事实。 */
function scene(recipes: RecipeDefinition[], options: { twoDevices?: boolean; poweredFixture?: boolean; sibling?: boolean; policy?: "state" | "environment-demand"; manual?: boolean } = {}) {
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
  const registry: RegistryContract = { ...base, recipeDefinitions, entityDefinitions,
    queries: createRegistryQuery({ entityDefinitions, recipeDefinitions, itemDefinitions: base.itemDefinitions }) };
  const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile(`src/tests/fixtures/blueprints/simulation/probabilistic-recipes/${options.poweredFixture ? "host" : options.twoDevices ? "two-devices" : "single"}.schema7.json`));
  const topology = compileSimulationTopology({ document, registry, simulationMode: "single-base", standardTickRate: 20, poweredEntityIds: new Set(document.entityOrder) });
  expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
  const deviceIds = topology.ordering.deviceOrder.filter(id => topology.devices[id]!.sourceEntityId?.startsWith("machine-") === true);
  const state = createSimulationMutableRuntimeState(topology);
  state.tickNumber = 1;
  const start = (random: RecipeRandomSource) => startRecipes(registry, topology, state, random);
  const selected = (index = 0) => Object.values(state.persistent.devices[deviceIds[index]!]!.channelRecipes)[0]?.recipeId ?? null;
  return { registry, topology, document, deviceIds, state, start, selected };
}

function fixedSample(value: number) {
  let calls = 0;
  return { next: () => { calls++; return value; }, get calls() { return calls; } };
}

const probabilityCases: Array<[string, (number | undefined)[], number, string]> = [
  ["混合首区间", [0.2, 0.3, undefined], 0, "a"],
  ["精确 0.2 边界", [0.2, 0.3, undefined], 0.2, "b"],
  ["精确 0.5 回退", [0.2, 0.3, undefined], 0.5, "c"],
  ["普通剩余区间", [0.2, 0.3, undefined], 0.99, "c"],
  ["总和等于 1", [0.4, 0.6, undefined], 0.99, "b"],
  ["总和超过 1 首区间", [0.8, 0.6, undefined], 0.5, "a"],
  ["总和超过 1 后区间", [0.8, 0.6, undefined], 0.9, "b"],
  ["全概率不足 1", [0.2, 0.3], 0.9, "b"],
  ["全概率加权边界", [1, 1], 0.5, "b"],
  ["单项超过 1", [2, 1, undefined], 0.5, "a"],
  ["有限大权重", [Number.MAX_VALUE, Number.MAX_VALUE, undefined], 0.75, "b"],
  ["极小正权重", [Number.MIN_VALUE, Number.MIN_VALUE], 0.5, "b"],
];

describe("ST2-RQ-046 Legacy 概率选择与准入", () => {
  it.each(probabilityCases)("%s", (_name, probabilities, sample, expected) => {
    const test = scene(probabilities.map((probability, index) => recipe(String.fromCharCode(97 + index), probability)));
    const random = fixedSample(sample); test.start(random);
    expect(test.selected()).toBe(expected); expect(random.calls).toBe(1);
    expect(test.state.persistent.nextRecipeRunIndex).toBe(2);
    const ingredient = Object.entries(test.state.persistent.slots).find(([slotId, slot]) => {
      const node = test.topology.nodes[test.topology.slots[slotId]!.nodeId]!;
      return node.deviceId === test.deviceIds[0] && slot.itemType === "item_iron_nugget";
    });
    expect(ingredient?.[1].count).toBe(49);
  });

  it.each([
    ["无候选", [] as RecipeDefinition[], null],
    ["单普通", [recipe("a")], "a"],
    ["单概率", [recipe("a", 0.001)], "a"],
    ["全普通顺序", [recipe("b"), recipe("a")], "a"],
    ["概率缺料", [recipe("a", 100, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] }), recipe("b")], "b"],
    ["普通缺料", [recipe("a", undefined, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] }), recipe("b", 0.01)], "b"],
    ["概率缺少环境", [recipe("a", 100, { requiredEnvironmentAnyOf: ["item_gas_water"] }), recipe("b")], "b"],
  ])("%s 不抽样", (_name, recipes, expected) => {
    const test = scene(recipes as RecipeDefinition[]); const random = fixedSample(0.9);
    test.start(random); expect(test.selected()).toBe(expected); expect(random.calls).toBe(0);
  });

  it("缺料概率候选不占区间，普通回退按原次序", () => {
    const test = scene([recipe("a", 100, { inputs: [{ itemId: "item_iron_nugget", amount: 51 }] }), recipe("b", 0.2), recipe("c"), recipe("d")]);
    const random = fixedSample(0.2); test.start(random);
    expect(test.selected()).toBe("c"); expect(random.calls).toBe(1);
  });

  it("原料只供一轮时，后续 channel 读取提交后的真实库存", () => {
    const test = scene([recipe("a", 1, { inputs: [{ itemId: "item_iron_nugget", amount: 30 }] }), recipe("b", 1, { inputs: [{ itemId: "item_iron_nugget", amount: 30 }] })], { sibling: true });
    const random = fixedSample(0); test.start(random);
    expect(Object.values(test.state.persistent.devices[test.deviceIds[0]!]!.channelRecipes).filter(Boolean).map(entry => entry!.recipeId)).toEqual(["a"]);
    expect(random.calls).toBe(1); expect(test.state.persistent.nextRecipeRunIndex).toBe(2);
  });

  it("同设备 channel 排他，剩余单候选不抽样", () => {
    const test = scene([recipe("a", 1), recipe("b", 1)], { sibling: true });
    const random = fixedSample(0); test.start(random);
    expect(Object.values(test.state.persistent.devices[test.deviceIds[0]!]!.channelRecipes).filter(Boolean).map(entry => entry!.recipeId)).toEqual(["a", "b"]);
    expect(random.calls).toBe(1); expect(test.state.persistent.nextRecipeRunIndex).toBe(3);
  });

  it("reserved-item 只预占最终配方且不扣除其他候选输入", () => {
    const test = scene([recipe("a", 1, { recipeType: "reserved-item" }), recipe("b", 1, { recipeType: "reserved-item" })]);
    const random = fixedSample(0.75); test.start(random);
    expect(test.selected()).toBe("b");
    const selected = Object.values(test.state.persistent.devices[test.deviceIds[0]!]!.channelRecipes)[0]!;
    expect(selected.reservations.reduce((sum, value) => sum + value.amount, 0)).toBe(1);
    expect(test.state.persistent.nextRecipeRunIndex).toBe(2);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("Legacy 外部 Registry 入口拒绝非法概率 %s", probability => {
    const test = scene([recipe("rq046-invalid", probability)]);
    expect(() => new SimulationWorkerRuntime(test.registry)).toThrow(/probability.*rq046-invalid/);
  });

  it.each([{ manual: true }, { policy: "environment-demand" as const }])("手动或环境按需未满足不启动 %j", options => {
    const test = scene([recipe("a", 1), recipe("b", 1)], options); const random = fixedSample(0);
    test.start(random); expect(test.selected()).toBeNull(); expect(random.calls).toBe(0); expect(test.state.persistent.nextRecipeRunIndex).toBe(1);
  });

  it("非生命周期相位和停电不能强制启动概率配方", () => {
    const test = scene([recipe("a", 1), recipe("b", 1)]); const random = fixedSample(0);
    test.state.tickNumber = 2; test.start(random);
    expect(test.selected()).toBeNull(); expect(random.calls).toBe(0);
    test.state.tickNumber = 1;
    startRecipes(test.registry, test.topology, test.state, random, "real", 0, test.topology.totalPowerDemand);
    expect(test.selected()).toBeNull(); expect(random.calls).toBe(0);
  });
});

function runtimeScene(twoDevices = false, statePolicy = false) {
  const test = scene([recipe("a", 1), recipe("b", 1)], { twoDevices, ...(statePolicy ? { policy: "state" as const } : {}) });
  const runtime = new SimulationWorkerRuntime(test.registry);
  runtime.initializeIsolated(test.topology, "infinite", []);
  const advance = (tick: number) => {
    let snapshot: RuntimeTickSnapshot | null = null;
    while (runtime.getStatus().latestTickNumber === null || (snapshot?.tickNumber ?? 0) < tick) {
      snapshot = runtime.advanceIsolated();
      if (snapshot.tickNumber >= tick) break;
    }
    return snapshot!;
  };
  const selected = (snapshot: RuntimeTickSnapshot, index = 0) => Object.values(snapshot.devices[test.deviceIds[index]!]!.channelRecipes)[0]?.recipeId ?? null;
  return { ...test, runtime, advance, runtimeSelected: selected };
}

describe("ST2-RQ-046 Legacy 随机生命周期", () => {
  afterEach(() => vi.useRealTimers());

  it("真实 Legacy Host 暂停继续与同速连续运行一致，停止重启恢复起点", async () => {
    // AI-REMOVED 2026-11-02:
    // Reason: 真实 Host 按文档计算供电范围，单机夹具缺少供电装配。
    // Trigger: 新增 Host 测试无启动配方，主代理已确认补齐 fixture。
    // Evidence: Legacy controller.computePoweredEntityIds 判定原场景为 out-of-power-range。
    // Replacement: host.schema7.json 保存完整供电设备。
    // Risk: Low；不修改任何供电准入或概率断言。
    // Human Review: Required
    // Original code:
    // const test = scene([recipe("a", 1), recipe("b", 1)]);
    const test = scene([recipe("a", 1), recipe("b", 1)], { poweredFixture: true });
    const first = createSimulationHost(createHeadlessWorkspace(test.document, test.registry), { engineKind: "legacy", workerMode: "runtime" });
    const second = createSimulationHost(createHeadlessWorkspace(test.document, test.registry), { engineKind: "legacy", workerMode: "runtime" });
    try {
      await first.actions.start(); await second.actions.start();
      expect(first.queries.getDocumentRuntimeStatus()?.standardTickRate).toBe(20);
      expect(first.state.simulationSpeed).toBe(1);
      expect(test.registry.queries.findEntityDefinition("grinder_1")!.recipeChannels[0]!.id).toBe("default");
      expect(first.queries.getDeviceRuntimeStatus("machine-1")?.powerStatus).toBe("in-power-range");
      for (const tick of [1, 11, 21, 31]) {
        if (tick === 21) { first.actions.pause(); first.actions.resume(); }
        await first.internalActions.syncToTick(tick); await second.internalActions.syncToTick(tick);
        const status = first.queries.getDeviceRuntimeStatus("machine-1");
        expect(status).not.toBeNull();
        expect(status!.channelRecipes.default?.recipeId).toBe(tick === 1 || tick === 31 ? "a" : "b");
        expect(status).toEqual(second.queries.getDeviceRuntimeStatus("machine-1"));
      }
      first.actions.stop(); await first.actions.start(); await first.internalActions.syncToTick(1);
      expect(first.queries.getDeviceRuntimeStatus("machine-1")?.channelRecipes.default?.recipeId).toBe("a");
    } finally { first.dispose(); second.dispose(); }
  });

  it("所有设备共享运行序列，独立 runtime 交错运行互不影响", () => {
    const first = runtimeScene(true); const second = runtimeScene(true); const random = new RecipeRandom();
    try {
      for (let tick = 1; tick <= 61; tick += 10) {
        const left = first.advance(tick); const right = second.advance(tick);
        expect(left).toEqual(right);
        for (let index = 0; index < 2; index++) expect(first.runtimeSelected(left, index)).toBe(random.next() < 0.5 ? "a" : "b");
      }
    } finally { first.runtime.disposeIsolated(); second.runtime.disposeIsolated(); }
  });

  it("状态指定只启动指定概率配方，不参加概率竞争", () => {
    const test = runtimeScene(false, true);
    try { expect(test.runtimeSelected(test.advance(1))).toBe("b"); }
    finally { test.runtime.disposeIsolated(); }
  });

  it("checkpoint 导出不含随机状态，导入继续取数，重新开始才重置", () => {
    const test = runtimeScene(); const random = new RecipeRandom();
    try {
      const initial = test.runtime.exportRuntimeState(0)!;
      expect(Object.keys(initial.runtimeState).filter(key => /random/i.test(key))).toEqual([]);
      expect(Object.keys(initial.runtimeState.persistent).filter(key => /random/i.test(key))).toEqual([]);
      expect(test.runtimeSelected(test.advance(1))).toBe(random.next() < 0.5 ? "a" : "b");
      expect(test.runtimeSelected(test.advance(11))).toBe(random.next() < 0.5 ? "a" : "b");
      test.runtime.importRuntimeState(initial, { scheduleBackgroundFill: false });
      expect(test.runtimeSelected(test.advance(1))).toBe(random.next() < 0.5 ? "a" : "b");
      test.runtime.initializeIsolated(test.topology, "infinite", []);
      expect(test.runtimeSelected(test.advance(1))).toBe("a");
    } finally { test.runtime.disposeIsolated(); }
  });

  it("拓扑迁移不重置源，稀疏快照及 checkpoint clone 不额外抽样", () => {
    const test = runtimeScene(); const random = new RecipeRandom();
    try {
      expect(test.runtimeSelected(test.advance(1))).toBe(random.next() < 0.5 ? "a" : "b");
      const checkpoint = test.runtime.exportRuntimeState(1)!;
      test.runtime.exportRuntimeState(1);
      const loaded = test.runtime.handleRequest({ type: "load-topology", requestId: 1, topology: test.topology, migration: { baseTickNumber: 1, resetDeviceIds: [] } });
      expect(loaded.type).toBe("topology-loaded");
      test.runtime.importRuntimeState(checkpoint, { scheduleBackgroundFill: false });
      expect(test.runtimeSelected(test.advance(11))).toBe(random.next() < 0.5 ? "a" : "b");
    } finally { test.runtime.disposeIsolated(); }
  });

  it("独立蓝图执行入口也使用共享规则，并拥有独立固定序列", () => {
    const test = scene([recipe("a", 1), recipe("b", 1)]); const random = new RecipeRandom();
    const engine = createLegacyBlueprintEngine(test.registry, { topology: test.topology, powerMode: "infinite", initialSlots: [] });
    try {
      for (let tick = 1; tick <= 31; tick++) {
        engine.advance();
        if ((tick - 1) % 10 === 0) {
          const device = engine.readDevices().find(entry => entry.deviceId === test.deviceIds[0])!;
          expect(Object.values(device.channelRecipes)[0]?.recipeId).toBe(random.next() < 0.5 ? "a" : "b");
        }
      }
    } finally { engine.dispose(); }
  });

  it("时间轴源独立，普通 load 重建不重置，stop 后新运行重置", () => {
    vi.useFakeTimers();
    const test = runtimeScene(); const timeline = new TimelineWorkerRuntime(test.registry); const random = new RecipeRandom();
    try {
      test.advance(1); const anchor = test.runtime.exportRuntimeState(1)!;
      const load = () => timeline.handleRequest({ type: "load-timeline", requestId: 1, runtimeExport: anchor, startTimelineTickNumber: 0, targetTimelineTickNumber: 1, capacityTimelineTicks: 2, stepStandardTicks: 10 });
      const result = () => {
        vi.runAllTimers();
        const response = timeline.handleRequest({ type: "get-timeline-checkpoint", requestId: 2, timelineTickNumber: 1 });
        if (response.type !== "timeline-checkpoint-result") throw new Error(response.type);
        return test.runtimeSelected(response.runtimeExport!.snapshot);
      };
      load(); expect(result()).toBe(random.next() < 0.5 ? "a" : "b");
      load(); expect(result()).toBe(random.next() < 0.5 ? "a" : "b");
      expect(test.runtimeSelected(test.advance(11))).toBe("b");
      timeline.stop(); load(); expect(result()).toBe("a");
    } finally { timeline.stop(); test.runtime.disposeIsolated(); }
  });

  it("时间轴 retarget 回退重建继续消费序列，不恢复检查点随机位置", () => {
    vi.useFakeTimers();
    const test = runtimeScene(); const timeline = new TimelineWorkerRuntime(test.registry); const random = new RecipeRandom();
    try {
      test.advance(1); const anchor = test.runtime.exportRuntimeState(1)!;
      timeline.handleRequest({ type: "load-timeline", requestId: 1, runtimeExport: anchor, startTimelineTickNumber: 0, targetTimelineTickNumber: 1, capacityTimelineTicks: 2, stepStandardTicks: 10 });
      vi.runAllTimers(); random.next();
      timeline.handleRequest({ type: "retarget-timeline", requestId: 2, retainedFromTimelineTickNumber: 0, targetTimelineTickNumber: 0 });
      timeline.handleRequest({ type: "retarget-timeline", requestId: 3, retainedFromTimelineTickNumber: 0, targetTimelineTickNumber: 1 });
      vi.runAllTimers();
      const response = timeline.handleRequest({ type: "get-timeline-checkpoint", requestId: 4, timelineTickNumber: 1 });
      if (response.type !== "timeline-checkpoint-result") throw new Error(response.type);
      expect(test.runtimeSelected(response.runtimeExport!.snapshot)).toBe(random.next() < 0.5 ? "a" : "b");
    } finally { timeline.stop(); test.runtime.disposeIsolated(); }
  });
});
