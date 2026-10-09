import { describe, expect, it, vi } from "vitest";
import { createRegistryContract } from "@/registry";
import { compileSimulationTopology } from "@/simulation/topology";
import { isSimulationWholeSecondTick } from "@/simulation/contracts";
import { DenseSimulationKernel } from "@/simulation/dense/dense-simulation-kernel";
import { compileDenseTopologyLayout, DENSE_SIMULATION_PROTOCOL_VERSION } from "@/simulation/dense/dense-topology";
import { DenseWorkerRuntime } from "@/simulation/dense/dense-worker-runtime";
import { DenseProjectionStore } from "@/simulation/dense/dense-frame-delta";
import type { DenseWorkerRequest, DenseWorkerResponse } from "@/simulation/dense/dense-worker-protocol";
import { createSimulationHost } from "@/simulation/simulation-host";
import { createWorldDocumentFromBlueprint, loadBlueprintFromFile } from "./blueprint-test-helpers";
import { createHeadlessWorkspace } from "./blueprint-runner";

const transportFixture = "src/tests/fixtures/blueprints/simulation/dense-checkpoint-transfer/scene-01-dense-checkpoint-transfer-c5624ff4.schema7.json";
const productionFixture = "src/tests/fixtures/blueprints/simulation/engine-boundary/scene-03-engine-boundary-operating-status-83ae3b34.schema7.json";

function createScenario(path = transportFixture) {
  const registry = createRegistryContract();
  const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile(path));
  const topology = compileSimulationTopology({
    document, registry, simulationMode: "single-base", standardTickRate: 4,
    poweredEntityIds: new Set(document.entityOrder),
  });
  expect(topology.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  const layout = compileDenseTopologyLayout(topology, registry);
  return { registry, document, topology, layout };
}

describe("Dense 整秒原地调速", () => {
  it("采用 tick 1 为相位原点，整秒和半秒边界不混淆", () => {
    expect([0, 1, 5, 9].every((tick) => isSimulationWholeSecondTick(tick, 4))).toBe(true);
    expect([2, 3, 4, 6].some((tick) => isSimulationWholeSecondTick(tick, 4))).toBe(false);
    expect(isSimulationWholeSecondTick(3, 2)).toBe(true);
    expect(isSimulationWholeSecondTick(2, 2)).toBe(false);
    expect(isSimulationWholeSecondTick(-1, 4)).toBe(false);
  });

  it("改变时间单位不改变拓扑身份、索引、库存、预占或已发生的传输", () => {
    const { registry, document, topology, layout } = createScenario();
    const topology2 = compileSimulationTopology({
      document, registry, simulationMode: "single-base", standardTickRate: 2,
      poweredEntityIds: new Set(document.entityOrder),
    });
    expect(topology2.topologyId).toBe(topology.topologyId);
    const kernel = new DenseSimulationKernel(topology, layout, registry);
    kernel.advanceToTick(5);
    const before = kernel.createCheckpoint();
    const state = kernel.state;
    kernel.switchStandardTickRate(2);
    const downshift = kernel.createCheckpoint();
    expect(kernel.state).toBe(state);
    expect(kernel.layout).toBe(layout);
    expect(kernel.topology.devices).toBe(topology.devices);
    expect(kernel.topology.transferEdges).toBe(topology.transferEdges);
    expect(downshift).toMatchObject({
      tickNumber: 3, standardTickRate: 2, slotCounts: before.slotCounts,
      slotReserved: before.slotReserved, slotItemIndexes: before.slotItemIndexes,
      routingCursors: before.routingCursors, channelStates: before.channelStates,
      channelRunIds: before.channelRunIds, channelReservations: before.channelReservations,
      transfers: before.transfers, baseBatteryJoules: before.baseBatteryJoules,
    });
    expect([...downshift.channelProgressTicks]).toEqual([...before.channelProgressTicks].map((ticks) => ticks / 2));
    expect(() => kernel.restoreCheckpoint(before)).toThrow("time unit");
    kernel.switchStandardTickRate(4);
    expect(kernel.createCheckpoint()).toEqual(before);
    kernel.advanceToTick(9);
    const reference = new DenseSimulationKernel(topology, layout, registry);
    reference.advanceToTick(9);
    expect(kernel.createCheckpoint()).toEqual(reference.createCheckpoint());
  });

  it("拒绝非整秒与非法频率，失败不能修改已有状态", () => {
    const { registry, topology, layout } = createScenario();
    const kernel = new DenseSimulationKernel(topology, layout, registry);
    kernel.advanceToTick(3);
    const before = kernel.createCheckpoint();
    expect(() => kernel.switchStandardTickRate(2)).toThrow("whole-second");
    expect(kernel.createCheckpoint()).toEqual(before);
    kernel.advanceToTick(5);
    const boundary = kernel.createCheckpoint();
    expect(() => kernel.switchStandardTickRate(3)).toThrow("4/2 TPS");
    expect(kernel.createCheckpoint()).toEqual(boundary);
  });

  it("整秒调速保留停电造成的四分之一秒配方进度", () => {
    const { registry, topology, layout } = createScenario(productionFixture);
    const kernel = new DenseSimulationKernel(topology, layout, registry);
    kernel.advanceToTick(2);
    expect([...kernel.createCheckpoint().channelProgressTicks]).toContain(1);
    kernel.setPowerConsumptionOverride(1e12);
    kernel.setPowerMode("real");
    kernel.advanceToTick(5);
    const before = kernel.createCheckpoint();
    expect([...before.channelProgressTicks]).toContain(1);
    kernel.switchStandardTickRate(2);
    expect([...kernel.createCheckpoint().channelProgressTicks]).toContain(0.5);
    kernel.switchStandardTickRate(4);
    expect(kernel.createCheckpoint()).toEqual(before);
  });

  it("Worker 原会话返回完整新频率帧，清除旧预测并能继续推进和恢复", () => {
    const { registry, topology } = createScenario();
    const runtime = new DenseWorkerRuntime(registry);
    const identity = { protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION, sessionId: "in-place-rate", topologyVersion: 1 } as const;
    let sequence = 0;
    type Payload = DenseWorkerRequest extends infer T ? T extends DenseWorkerRequest ? Omit<T, keyof typeof identity | "sequence"> : never : never;
    const request = (payload: Payload) => runtime.handleRequest({ ...identity, sequence: ++sequence, ...payload });
    const initialized = request({ type: "initialize-session", topology, perfEnabled: false,
      debugDataEnabled: false, powerMode: "infinite", powerConsumptionOverride: undefined });
    if (initialized.type !== "topology-ready") throw new Error(initialized.type);
    const projection = new DenseProjectionStore(initialized.layout.dictionary, identity);
    projection.apply(initialized.initialDelta);
    const advance = request({ type: "advance-budget", targetTickNumber: 5, wallTimeBudgetMs: 100 });
    if (advance.type !== "frame-delta") throw new Error(advance.type);
    expect(advance.executionMs).toBeGreaterThan(0);
    projection.apply(advance.delta);
    const before = projection.materializeSnapshot();
    expect(request({ type: "ensure-buffered-through", tickNumber: 21 }).type).toBe("buffer-ready");
    const switched = request({ type: "switch-tick-rate", tickNumber: 5, standardTickRate: 2 });
    if (switched.type !== "presentation-checkpoint") throw new Error(switched.type);
    expect(switched).toMatchObject({ ...identity, runtimeRetainedStateCount: 1 });
    projection.replaceCheckpoint(switched.delta);
    expect(projection.materializeSnapshot()).toMatchObject({ tickNumber: 3, standardTickRate: 2, slots: before.slots });
    expect(request({ type: "request-presentation-checkpoint", tickNumber: 0 }).type).toBe("protocol-error");
    const later = request({ type: "advance-budget", targetTickNumber: 5, wallTimeBudgetMs: 100 });
    if (later.type !== "frame-delta") throw new Error(later.type);
    projection.apply(later.delta);
    const restored = request({ type: "request-presentation-checkpoint", tickNumber: 3 });
    if (restored.type !== "presentation-checkpoint") throw new Error(restored.type);
    projection.replaceCheckpoint(restored.delta);
    expect(projection.materializeSnapshot().slots).toEqual(before.slots);
    expect(request({ type: "switch-tick-rate", tickNumber: 3, standardTickRate: 4 }).type).toBe("protocol-error");
    expect(request({ type: "switch-tick-rate", tickNumber: 5, standardTickRate: 4 }).type).toBe("presentation-checkpoint");
  });

  it("真实 Host 在整秒调速且复用拓扑，五秒内不自动反向切换", async () => {
    const { registry, document } = createScenario();
    let now = 100;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    // 只记录正式 Runtime 的调用与返回，所有仿真仍由真实内核执行。
    const requests = vi.spyOn(DenseWorkerRuntime.prototype, "handleRequest");
    const host = createSimulationHost(createHeadlessWorkspace(document, registry), { engineKind: "dense-v2", workerMode: "runtime" });
    try {
      await host.actions.start();
      await host.internalActions.syncToTick(2);
      const before = host.topology.getSnapshot()!;
      host.actions.setSimulationSpeed(16);
      await host.actions.advancePlaybackByDeltaMs(1000);
      const switches = () => requests.mock.calls.map(([request]) => request).filter((request) => request.type === "switch-tick-rate");
      expect(switches()).toHaveLength(1);
      expect(switches()[0]).toMatchObject({ tickNumber: 5, standardTickRate: 2 });
      expect(host.topology.getSnapshot()).toMatchObject({ topologyId: before.topologyId, standardTickRate: 2 });
      expect(host.topology.getSnapshot()!.devices).toBe(before.devices);
      for (now = 1100; now < 5100; now += 1000) await host.actions.advancePlaybackByDeltaMs(250);
      expect(switches()).toHaveLength(1);
      now = 6100;
      await host.actions.advancePlaybackByDeltaMs(250);
      expect(switches()).toHaveLength(2);
      expect(switches()[1]!.standardTickRate).toBe(4);
      expect(isSimulationWholeSecondTick(switches()[1]!.tickNumber, 2)).toBe(true);
      expect(requests.mock.calls.filter(([request]) => request.type === "initialize-session")).toHaveLength(1);
      expect(host.topology.getSnapshot()!.devices).toBe(before.devices);
      const responses = requests.mock.results.flatMap((result) => result.type === "return" ? [result.value as DenseWorkerResponse] : []);
      expect(responses.filter((response) => response.type === "protocol-error")).toEqual([]);
    } finally {
      host.dispose();
      requests.mockRestore();
      clock.mockRestore();
    }
  });
});
