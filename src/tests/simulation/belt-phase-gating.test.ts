import { describe, expect, it } from "vitest";

import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createRegistryContract } from "@/registry";
import type { CompiledSimulationTopology } from "@/simulation/types";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
} from "./blueprint-test-helpers";

const STANDARD_SPEED = 1;
const COARSE_SPEED = 4;

/**
 * 传送带相位门禁端到端测试（真实仿真引擎，不 mock）。
 *
 * 背景：传送带族本应在 `(standardTick - 1) % transferUnitTicks === 0`（transferUnitTicks=20）
 * 的相位点才接收/发送物品。2026-07-23 重构后 phase-gated 门禁只认 PipeFamily，
 * 传送带被排除出门禁（回归）。
 *
 * 场景（用户要求）：
 *   协议储存箱 `storage` 两个输出口各接一条传送带：
 *     belt1 ← storage 槽位1（初始放物品 A），belt2 ← storage 槽位2。
 *   tick 1（相位点）belt1 接走 A；
 *   tick 5（非门禁时刻）通过 patch-runtime-slot 向 storage 槽位2 放入物品 B；
 *   因传送带相位门禁，belt2 不能立即在 tick 6 接收 B，必须等到下一个 20 tick 相位点 tick 21。
 */
describe("传送带相位门禁", () => {
  it("非门禁时刻放入的物品，第二条传送带要等到 20 tick 相位点才第一次接到（标准帧率）", () => {
    const registry = createRegistryContract();
    const runtime = createRuntime(registry, STANDARD_SPEED);

    // tick 1（相位点）：belt1 从 storage 槽位1 接走物品 A。
    expect(receivesAt(runtime, 1, "device:storage", "device:belt1")).toBe(true);

    // tick 5（非门禁时刻，5-1=4 非 20 倍数）：向槽位2 放入物品 B。
    // 注意：patch 基准取 lastRequestedTickNumber，必须先请求 tick 5 快照再 patch。
    runtime.advanceToTick(5);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: 5,
      simulationSpeed: STANDARD_SPEED,
    });
    patchStorageSlot2(runtime, "item_copper_ore", 1);

    // 逐标准 tick 收集 belt2 的接收时刻。
    const belt2Receives = collectReceives(runtime, 6, 61, "device:storage", "device:belt2");
    // 无门禁（回归）：belt2 会在 tick 6 立即接收；
    // 有门禁：第一个可接相位点是 tick 21（B 在 tick 5 才可用，错过 tick 1）。
    expect(belt2Receives[0]).toBe(21);
    expect(belt2Receives.filter((tick) => tick < 21)).toEqual([]);
  });

  it("粗步长（低 dynamicTickRate）下门禁仍生效", () => {
    const registry = createRegistryContract();
    const runtime = createRuntime(registry, COARSE_SPEED);

    // 高倍速应进入粗步长（standardStepTicks > 1 → dynamicTickRate < 20）。
    expect(runtime.getStatus().dynamicTickRate).toBeLessThan(20);

    runtime.advanceToTick(5);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: 5,
      simulationSpeed: COARSE_SPEED,
    });
    patchStorageSlot2(runtime, "item_copper_ore", 1);

    const belt2Receives = collectReceives(runtime, 6, 61, "device:storage", "device:belt2", COARSE_SPEED);
    expect(belt2Receives[0]).toBe(21);
    expect(belt2Receives.filter((tick) => tick < 21)).toEqual([]);
  });

  it("动态帧率切换（标准 → 粗步长）后门禁仍生效", () => {
    const registry = createRegistryContract();
    const runtime = createRuntime(registry, STANDARD_SPEED);

    // 标准帧率推进到 tick 5 并放入 B。
    runtime.advanceToTick(5);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: 5,
      simulationSpeed: STANDARD_SPEED,
    });
    patchStorageSlot2(runtime, "item_copper_ore", 1);

    // 中途切换到高倍速（触发粗步长 dynamicTickRate），继续推进。
    runtime.handleRequest({
      type: "set-simulation-speed",
      requestId: 2,
      simulationSpeed: COARSE_SPEED,
    });
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 3,
      tickNumber: 61,
      simulationSpeed: COARSE_SPEED,
    });
    runtime.advanceToTick(61);

    const belt2Receives = collectReceives(runtime, 6, 61, "device:storage", "device:belt2", COARSE_SPEED);
    expect(belt2Receives[0]).toBe(21);
    expect(belt2Receives.filter((tick) => tick < 21)).toEqual([]);
  });
});

function createRuntime(
  registry: RegistryContract,
  simulationSpeed: number,
): SimulationWorkerRuntime {
  const runtime = new SimulationWorkerRuntime(registry);
  runtime.handleRequest({
    type: "load-topology",
    requestId: 1,
    topology: createBeltPhaseGatingTopology(registry),
    simulationSpeed,
  });
  return runtime;
}

function createBeltPhaseGatingTopology(registry: RegistryContract): CompiledSimulationTopology {
  const document = createWorldDocumentFromBlueprint(
    createBlueprint("belt-phase-gating", [
      createEntity("storage", "storager_1", 0, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
        "storageSlotGroups[0].slots[0].initialCount": 1,
      }),
      createEntity("belt1", "belt_straight_1x1", 0, -1, 270),
      createEntity("sink1", "storager_1", 0, -4, 0),
      createEntity("belt2", "belt_straight_1x1", 1, -1, 270),
      createEntity("sink2", "storager_1", 1, -4, 0),
    ]),
  );
  return compileSimulationTopology({
    document,
    registry,
    poweredEntityIds: new Set(document.entityOrder),
  });
}

function patchStorageSlot2(runtime: SimulationWorkerRuntime, itemType: string, count: number): void {
  runtime.handleRequest({
    type: "patch-runtime-slot",
    requestId: 9000,
    patch: {
      entityId: "storage",
      storageGroupId: "storage_slot_2",
      slotId: "slot_1",
      itemType,
      count,
    },
  });
}

function receivesAt(
  runtime: SimulationWorkerRuntime,
  tickNumber: number,
  sourceDeviceId: string,
  targetDeviceId: string,
): boolean {
  return getTickTransfers(runtime, tickNumber, STANDARD_SPEED)
    .some((transfer) =>
      transfer.sourceSlotId.includes(sourceDeviceId)
      && transfer.targetSlotId.includes(targetDeviceId),
    );
}

function collectReceives(
  runtime: SimulationWorkerRuntime,
  fromTick: number,
  toTick: number,
  sourceDeviceId: string,
  targetDeviceId: string,
  simulationSpeed = STANDARD_SPEED,
): number[] {
  const ticks: number[] = [];
  for (let tickNumber = fromTick; tickNumber <= toTick; tickNumber += 1) {
    if (getTickTransfers(runtime, tickNumber, simulationSpeed).some((transfer) =>
      transfer.sourceSlotId.includes(sourceDeviceId)
      && transfer.targetSlotId.includes(targetDeviceId),
    )) {
      ticks.push(tickNumber);
    }
  }
  return ticks;
}

function getTickTransfers(
  runtime: SimulationWorkerRuntime,
  tickNumber: number,
  simulationSpeed: number,
) {
  runtime.advanceToTick(tickNumber);
  const response = runtime.handleRequest({
    type: "get-tick-snapshot",
    requestId: tickNumber + 10_000,
    tickNumber,
    simulationSpeed,
  });
  if (response.type !== "tick-snapshot-result") {
    return [];
  }
  return response.result.currentTick?.transfers ?? [];
}
