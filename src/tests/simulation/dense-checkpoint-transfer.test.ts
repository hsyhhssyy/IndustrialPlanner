import { loadBlueprintFromFile } from "./blueprint-test-helpers";
import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import { DENSE_SIMULATION_PROTOCOL_VERSION } from "@/simulation/dense/dense-topology";
import {
  DenseProjectionStore,
  collectDenseFrameTransferables,
  type DenseFrameDelta,
} from "@/simulation/dense/dense-frame-delta";
import { DenseWorkerRuntime } from "@/simulation/dense/dense-worker-runtime";
import { type DenseWorkerResponse } from "@/simulation/dense/dense-worker-protocol";
import {
  DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND,
  DENSE_STANDARD_TICK_RATE_PER_SECOND,
} from "@/simulation/contracts/tick-rate";
import { compileSimulationTopology } from "@/simulation/topology/compiler";

// AI-REMOVED 2026-09-14:
// Reason: 场景构造已批量固化为带版本的蓝图文件。
// Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
// Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
// Replacement: src/tests/fixtures/blueprints/simulation/dense-checkpoint-transfer/index.json
// Risk: Low；断言与被测动作不变。
// Human Review: Required
// Original code:
// import {
//   createBlueprint,
//   createEntity,
//   createWorldDocumentFromBlueprint,
// } from "./blueprint-test-helpers";
import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";

const SESSION = {
  protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
  sessionId: "dense-checkpoint-transfer",
  topologyVersion: 1,
} as const;

describe("Dense checkpoint 的传输缓冲区所有权", () => {
  it("返回帧的 buffer 转移后，同 tick 展示与历史恢复仍保留完整传输事件", () => {
    const registry = createRegistryContract();
    // AI-REMOVED 2026-09-14:
    // Reason: 场景构造已批量固化为带版本的蓝图文件。
    // Trigger: 用户要求测试通过蓝图文件装载场景，保留版本便于后续迁移。
    // Evidence: 原构造表达式已解析为完整实体集合，按正式迁移规则保存。
    // Replacement: src/tests/fixtures/blueprints/simulation/dense-checkpoint-transfer/index.json
    // Risk: Low；断言与被测动作不变。
    // Human Review: Required
    // Original code:
    // createBlueprint(
    //       "dense-checkpoint-transfer",
    //       [
    //         createEntity("source-storage", "storager_1", 0, 0, 0, {
    //           "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
    //           "storageSlotGroups[0].slots[0].initialCount": 20,
    //         }),
    //         createEntity("belt", "belt_straight_1x1", 0, -1, 270),
    //         createEntity("sink-storage", "storager_1", 0, -4),
    //       ],
    //     )
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile("src/tests/fixtures/blueprints/simulation/dense-checkpoint-transfer/scene-01-dense-checkpoint-transfer-c5624ff4.schema6.json"));
    const topology = compileSimulationTopology({
      document,
      registry,
      simulationMode: "single-base",
      poweredEntityIds: new Set(document.entityOrder),
      standardTickRate: DENSE_STANDARD_TICK_RATE_PER_SECOND,
    });
    expect(topology.diagnostics.filter((diagnostic) => diagnostic.severity === "error"))
      .toEqual([]);

    const runtime = new DenseWorkerRuntime(registry);
    let sequence = 1;
    const initialized = runtime.handleRequest({
      ...SESSION,
      sequence: sequence++,
      type: "initialize-session",
      topology,
      perfEnabled: false,
      debugDataEnabled: false,
      powerMode: "infinite",
      powerConsumptionOverride: undefined,
    });
    if (initialized.type !== "topology-ready") {
      throw new Error(`Unexpected dense initialization response: ${initialized.type}.`);
    }
    const projection = new DenseProjectionStore(initialized.layout.dictionary, SESSION);
    projection.apply(initialized.initialDelta);

    const firstTick = transferResponseFrame(runtime.handleRequest({
      ...SESSION,
      sequence: sequence++,
      type: "advance-budget",
      targetTickNumber: 1,
      wallTimeBudgetMs: Number.MAX_SAFE_INTEGER,
    }));
    projection.apply(firstTick);
    const expectedTransfers = projection.materializeSnapshot().transfers;
    expect(expectedTransfers).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: "item_iron_ore", amount: 1 }),
    ]));

    // 每个 checkpoint 本身也实际转移 buffer，重复读取能发现展示帧借用了内核数据。
    for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
      const checkpoint = transferResponseFrame(runtime.handleRequest({
        ...SESSION,
        sequence: sequence++,
        type: "request-presentation-checkpoint",
        tickNumber: 1,
      }));
      projection.replaceCheckpoint(checkpoint);
      expect(projection.tickNumber).toBe(1);
      expect(projection.materializeSnapshot().transfers).toEqual(expectedTransfers);
    }

    const laterTick = transferResponseFrame(runtime.handleRequest({
      ...SESSION,
      sequence: sequence++,
      type: "advance-budget",
      targetTickNumber: 1 + DENSE_STANDARD_TICK_RATE_PER_SECOND,
      wallTimeBudgetMs: Number.MAX_SAFE_INTEGER,
    }));
    projection.apply(laterTick);
    expect(projection.tickNumber).toBeGreaterThan(1);

    for (let requestIndex = 0; requestIndex < 2; requestIndex += 1) {
      const historical = transferResponseFrame(runtime.handleRequest({
        ...SESSION,
        sequence: sequence++,
        type: "request-presentation-checkpoint",
        tickNumber: 1,
      }));
      projection.replaceCheckpoint(historical);
      expect(projection.tickNumber).toBe(1);
      expect(projection.materializeSnapshot().transfers).toEqual(expectedTransfers);
    }
  });

  it("在半秒相位边界热切换 4/2 TPS 并保留运行态", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(loadBlueprintFromFile(
      "src/tests/fixtures/blueprints/simulation/dense-checkpoint-transfer/scene-01-dense-checkpoint-transfer-c5624ff4.schema6.json",
    ));
    const compileAtRate = (standardTickRate: number) => compileSimulationTopology({
      document,
      registry,
      simulationMode: "single-base",
      poweredEntityIds: new Set(document.entityOrder),
      standardTickRate,
    });
    const topology4 = compileAtRate(DENSE_STANDARD_TICK_RATE_PER_SECOND);
    const topology2 = compileAtRate(DENSE_LOW_STANDARD_TICK_RATE_PER_SECOND);
    const runtime = new DenseWorkerRuntime(registry);
    const session4 = {
      protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
      sessionId: "dense-rate-4",
      topologyVersion: 1,
    } as const;
    const initialized4 = runtime.handleRequest({
      ...session4,
      sequence: 1,
      type: "initialize-session",
      topology: topology4,
      perfEnabled: false,
      debugDataEnabled: false,
      powerMode: "infinite",
      powerConsumptionOverride: undefined,
    });
    if (initialized4.type !== "topology-ready") {
      throw new Error(`Unexpected Dense 4 TPS initialization: ${initialized4.type}.`);
    }
    const projection4 = new DenseProjectionStore(initialized4.layout.dictionary, session4);
    projection4.apply(initialized4.initialDelta);
    projection4.apply(transferResponseFrame(runtime.handleRequest({
      ...session4,
      sequence: 2,
      type: "advance-budget",
      targetTickNumber: 3,
      wallTimeBudgetMs: Number.MAX_SAFE_INTEGER,
    })));
    const beforeDownshift = projection4.materializeSnapshot();

    const session2 = {
      protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
      sessionId: "dense-rate-2",
      topologyVersion: 2,
    } as const;
    const initialized2 = runtime.handleRequest({
      ...session2,
      sequence: 1,
      type: "initialize-session",
      topology: topology2,
      perfEnabled: false,
      debugDataEnabled: false,
      powerMode: "infinite",
      powerConsumptionOverride: undefined,
      migration: { baseTickNumber: 3, resetDeviceIds: [] },
    });
    if (initialized2.type !== "topology-ready") {
      throw new Error(`Unexpected Dense 2 TPS migration: ${initialized2.type}.`);
    }
    const projection2 = new DenseProjectionStore(initialized2.layout.dictionary, session2);
    projection2.apply(initialized2.initialDelta);
    const afterDownshift = projection2.materializeSnapshot();
    expect(afterDownshift).toMatchObject({
      tickNumber: 2,
      standardTickRate: 2,
      tickRate: 2,
      slots: beforeDownshift.slots,
    });
    expect(readRecipeProgressSeconds(afterDownshift)).toEqual(
      readRecipeProgressSeconds(beforeDownshift),
    );

    projection2.apply(transferResponseFrame(runtime.handleRequest({
      ...session2,
      sequence: 2,
      type: "advance-budget",
      targetTickNumber: 3,
      wallTimeBudgetMs: Number.MAX_SAFE_INTEGER,
    })));
    const beforeUpshift = projection2.materializeSnapshot();
    const session4Restored = {
      protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
      sessionId: "dense-rate-4-restored",
      topologyVersion: 3,
    } as const;
    const restored4 = runtime.handleRequest({
      ...session4Restored,
      sequence: 1,
      type: "initialize-session",
      topology: topology4,
      perfEnabled: false,
      debugDataEnabled: false,
      powerMode: "infinite",
      powerConsumptionOverride: undefined,
      migration: { baseTickNumber: 3, resetDeviceIds: [] },
    });
    if (restored4.type !== "topology-ready") {
      throw new Error(`Unexpected Dense 4 TPS restoration: ${restored4.type}.`);
    }
    const restoredProjection4 = new DenseProjectionStore(
      restored4.layout.dictionary,
      session4Restored,
    );
    restoredProjection4.apply(restored4.initialDelta);
    const afterUpshift = restoredProjection4.materializeSnapshot();
    expect(afterUpshift).toMatchObject({
      tickNumber: 5,
      standardTickRate: 4,
      tickRate: 4,
      slots: beforeUpshift.slots,
    });
    expect(readRecipeProgressSeconds(afterUpshift)).toEqual(
      readRecipeProgressSeconds(beforeUpshift),
    );
  });
});

function readRecipeProgressSeconds(snapshot: ReturnType<DenseProjectionStore["materializeSnapshot"]>) {
  return Object.values(snapshot.devices).flatMap((device) =>
    Object.entries(device.channelRecipes).flatMap(([channelId, recipe]) =>
      recipe === null
        ? []
        : [{
            deviceId: device.deviceId,
            channelId,
            recipeId: recipe.recipeId,
            progressSeconds: recipe.progressTicks / snapshot.standardTickRate,
            durationSeconds: recipe.durationTicks / snapshot.standardTickRate,
          }]
    )
  );
}

function transferResponseFrame(response: DenseWorkerResponse): DenseFrameDelta {
  if (response.type !== "frame-delta" && response.type !== "presentation-checkpoint") {
    throw new Error(`Unexpected dense frame response: ${response.type}.`);
  }
  const buffers = collectDenseFrameTransferables(response.delta);
  const received = structuredClone(response, { transfer: [...buffers] });
  for (const buffer of buffers) {
    expect(buffer.byteLength).toBe(0);
  }
  return received.delta;
}
