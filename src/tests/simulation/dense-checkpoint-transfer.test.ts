import { describe, expect, it } from "vitest";

import { createRegistryContract } from "@/registry";
import {
  DENSE_SIMULATION_PROTOCOL_VERSION,
  DenseProjectionStore,
  DenseWorkerRuntime,
  collectDenseFrameTransferables,
  type DenseFrameDelta,
  type DenseWorkerResponse,
} from "@/simulation/dense";
import { DENSE_STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import { compileSimulationTopology } from "@/simulation/topology-compiler";

import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
} from "./blueprint-test-helpers";

const SESSION = {
  protocolVersion: DENSE_SIMULATION_PROTOCOL_VERSION,
  sessionId: "dense-checkpoint-transfer",
  topologyVersion: 1,
} as const;

describe("Dense checkpoint 的传输缓冲区所有权", () => {
  it("返回帧的 buffer 转移后，同 tick 展示与历史恢复仍保留完整传输事件", () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBlueprint(
      "dense-checkpoint-transfer",
      [
        createEntity("source-storage", "storager_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 20,
        }),
        createEntity("belt", "belt_straight_1x1", 0, -1, 270),
        createEntity("sink-storage", "storager_1", 0, -4),
      ],
    ));
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
});

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
