import { describe, expect, it } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { createRegistryContract } from "@/registry";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";
import { createSimulationHost } from "@/simulation/simulation-host";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import type { CompiledSimulationTopology } from "@/simulation/types";
import { compileSimulationTopology } from "@/simulation/topology-compiler";
import { SimulationWorkerRuntime } from "@/simulation/worker-runtime";
import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
  resolveFirstTickNumberAtSimulationMilliseconds,
} from "./blueprint-test-helpers";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

const STANDARD_SPEED = 1;
const COARSE_SPEED = 4;

describeSimulationEngineMatrix("belt phase gating host contract", (engineKind) => {
  it("只在 1000ms 门禁相位的第一 tick 接收运行时补入的物品", async () => {
    const registry = createRegistryContract();
    const document = createWorldDocumentFromBlueprint(createBeltPhaseGatingBlueprint());
    const host = createSimulationHost(createHostWorkspace(document, registry), {
      engineKind,
      workerMode: "runtime",
    });

    try {
      await host.actions.start();
      host.actions.pause();
      const standardTickRate = host.topology.getSnapshot()?.standardTickRate;
      expect(standardTickRate).toBeDefined();

      const zeroMillisecondTick = resolveFirstTickNumberAtSimulationMilliseconds(
        standardTickRate!,
        0,
      );
      expect((await host.internalActions.syncToTick(zeroMillisecondTick)).status).toBe("ready");
      await host.actions.patchRuntimeSlot({
        entityId: "storage",
        storageGroupId: "storage_slot_2",
        slotId: "slot_1",
        itemType: "item_copper_ore",
        count: 1,
        ignoreStock: false,
      });

      const halfSecondTick = resolveFirstTickNumberAtSimulationMilliseconds(
        standardTickRate!,
        500,
      );
      expect((await host.internalActions.syncToTick(halfSecondTick)).status).toBe("ready");
      expect(hasHostTransfer(host, "device:storage", "device:belt2")).toBe(false);

      const oneSecondTick = resolveFirstTickNumberAtSimulationMilliseconds(
        standardTickRate!,
        1_000,
      );
      expect((await host.internalActions.syncToTick(oneSecondTick)).status).toBe("ready");
      expect(hasHostTransfer(host, "device:storage", "device:belt2")).toBe(true);
      // AI-REMOVED 2026-09-08:
      // Reason: internal refresh 只刷新拓扑，不会把 Host runningState 切到 start，随后 patchRuntimeSlot 会被忽略。
      // Trigger: Legacy 与 Dense Host 门禁用例均未观察到运行时补货。
      // Evidence: 两个 Host 的 patchRuntimeSlot 都在 runningState === "stop" 时直接返回。
      // Replacement: host.actions.start() 后 pause，再按毫秒相位同步。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const started = await host.internalActions.refreshFromCurrentDocument();
      // expect(started.status).toBe("started");
      //
      // AI-REMOVED 2026-09-08:
      // Reason: 公共 start() 返回 Promise<void>，不存在可读取的 status 字段。
      // Trigger: Host 门禁用例运行时报 Cannot read properties of undefined。
      // Evidence: SimulationContract.actions.start 的返回契约为 void。
      // Replacement: await host.actions.start()；启动成功由随后存在 topology 和 ready tick 共同验证。
      // Risk: Low
      // Human Review: Required
      //
      // Original code:
      // const started = await host.actions.start();
      // expect(started.status).toBe("started");
    } finally {
      host.dispose();
    }
  });
});

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
  // AI-REMOVED 2026-09-08:
  // Reason: 用例名称暴露 Legacy 的 20 tick 实现坐标，没有表达跨实现业务时间。
  // Trigger: 用户要求固定 tick 1/41 一类设置统一改为毫秒数。
  // Evidence: Legacy 的 20 tick 周期等价于 1000ms。
  // Replacement: 下方 1000ms 门禁相位标题。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // it("非门禁时刻放入的物品，第二条传送带要等到 20 tick 相位点才第一次接到（标准帧率）", () => {
  it("非门禁时刻放入的物品，要等到 1000ms 门禁相位才第一次接到（Legacy 内部）", () => {
    const registry = createRegistryContract();
    const runtime = createRuntime(registry, STANDARD_SPEED);
    const zeroMillisecondTick = resolveLegacyFirstTick(0);
    const patchAtTwoHundredMillisecondsTick = resolveLegacyFirstTick(200);
    const collectFromTwoHundredFiftyMillisecondsTick = resolveLegacyFirstTick(250);
    const oneSecondTick = resolveLegacyFirstTick(1_000);
    const collectThroughThreeSecondsTick = resolveLegacyFirstTick(3_000);

    // tick 1（相位点）：belt1 从 storage 槽位1 接走物品 A。
    // AI-CORRECTION 2026-09-08: 下方 tick 1/5/6/21/61 分别由 0/200/250/1000/3000ms 换算。
    expect(receivesAt(runtime, zeroMillisecondTick, "device:storage", "device:belt1")).toBe(true);

    // tick 5（非门禁时刻，5-1=4 非 20 倍数）：向槽位2 放入物品 B。
    // 注意：patch 基准取 lastRequestedTickNumber，必须先请求 tick 5 快照再 patch。
    runtime.advanceToTick(patchAtTwoHundredMillisecondsTick);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: patchAtTwoHundredMillisecondsTick,
      simulationSpeed: STANDARD_SPEED,
    });
    patchStorageSlot2(runtime, "item_copper_ore", 1);

    // 逐标准 tick 收集 belt2 的接收时刻。
    const belt2Receives = collectReceives(
      runtime,
      collectFromTwoHundredFiftyMillisecondsTick,
      collectThroughThreeSecondsTick,
      "device:storage",
      "device:belt2",
    );
    // 无门禁（回归）：belt2 会在 tick 6 立即接收；
    // 有门禁：第一个可接相位点是 tick 21（B 在 tick 5 才可用，错过 tick 1）。
    expect(belt2Receives[0]).toBe(oneSecondTick);
    expect(belt2Receives.filter((tick) => tick < oneSecondTick)).toEqual([]);
  });

  it("粗步长（低 dynamicTickRate）下门禁仍生效", () => {
    const registry = createRegistryContract();
    const runtime = createRuntime(registry, COARSE_SPEED);
    const patchAtTwoHundredMillisecondsTick = resolveLegacyFirstTick(200);
    const collectFromTwoHundredFiftyMillisecondsTick = resolveLegacyFirstTick(250);
    const oneSecondTick = resolveLegacyFirstTick(1_000);
    const collectThroughThreeSecondsTick = resolveLegacyFirstTick(3_000);

    // 高倍速应进入粗步长（standardStepTicks > 1 → dynamicTickRate < 20）。
    expect(runtime.getStatus().dynamicTickRate).toBeLessThan(20);

    runtime.advanceToTick(patchAtTwoHundredMillisecondsTick);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: patchAtTwoHundredMillisecondsTick,
      simulationSpeed: COARSE_SPEED,
    });
    patchStorageSlot2(runtime, "item_copper_ore", 1);

    const belt2Receives = collectReceives(
      runtime,
      collectFromTwoHundredFiftyMillisecondsTick,
      collectThroughThreeSecondsTick,
      "device:storage",
      "device:belt2",
      COARSE_SPEED,
    );
    expect(belt2Receives[0]).toBe(oneSecondTick);
    expect(belt2Receives.filter((tick) => tick < oneSecondTick)).toEqual([]);
  });

  it("动态帧率切换（标准 → 粗步长）后门禁仍生效", () => {
    const registry = createRegistryContract();
    const runtime = createRuntime(registry, STANDARD_SPEED);
    const patchAtTwoHundredMillisecondsTick = resolveLegacyFirstTick(200);
    const collectFromTwoHundredFiftyMillisecondsTick = resolveLegacyFirstTick(250);
    const oneSecondTick = resolveLegacyFirstTick(1_000);
    const collectThroughThreeSecondsTick = resolveLegacyFirstTick(3_000);

    // 标准帧率推进到 tick 5 并放入 B。
    runtime.advanceToTick(patchAtTwoHundredMillisecondsTick);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: patchAtTwoHundredMillisecondsTick,
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
      tickNumber: collectThroughThreeSecondsTick,
      simulationSpeed: COARSE_SPEED,
    });
    runtime.advanceToTick(collectThroughThreeSecondsTick);

    const belt2Receives = collectReceives(
      runtime,
      collectFromTwoHundredFiftyMillisecondsTick,
      collectThroughThreeSecondsTick,
      "device:storage",
      "device:belt2",
      COARSE_SPEED,
    );
    expect(belt2Receives[0]).toBe(oneSecondTick);
    expect(belt2Receives.filter((tick) => tick < oneSecondTick)).toEqual([]);
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

function resolveLegacyFirstTick(elapsedMilliseconds: number): number {
  return resolveFirstTickNumberAtSimulationMilliseconds(
    STANDARD_TICK_RATE_PER_SECOND,
    elapsedMilliseconds,
  );
}

function createBeltPhaseGatingTopology(registry: RegistryContract): CompiledSimulationTopology {
  const document = createWorldDocumentFromBlueprint(createBeltPhaseGatingBlueprint());
  // AI-REMOVED 2026-09-08:
  // Reason: Host 契约测试与 Legacy Worker 实现测试应复用同一最小蓝图，避免场景漂移。
  // Trigger: 用户要求门禁测试改为 Host 行为矩阵。
  // Evidence: 原先内联设备与 Host 用例需要的设备完全相同。
  // Replacement: createBeltPhaseGatingBlueprint。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const document = createWorldDocumentFromBlueprint(
  //   createBlueprint("belt-phase-gating", [
  //     createEntity("storage", "storager_1", 0, 0, 0, {
  //       "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
  //       "storageSlotGroups[0].slots[0].initialCount": 1,
  //     }),
  //     createEntity("belt1", "belt_straight_1x1", 0, -1, 270),
  //     createEntity("sink1", "storager_1", 0, -4, 0),
  //     createEntity("belt2", "belt_straight_1x1", 1, -1, 270),
  //     createEntity("sink2", "storager_1", 1, -4, 0),
  //   ]),
  // );
  return compileSimulationTopology({
    document,
    registry,
    simulationMode: "single-base",
    poweredEntityIds: new Set(document.entityOrder),
  });
}

function createBeltPhaseGatingBlueprint() {
  return createBlueprint("belt-phase-gating", [
    createEntity("storage", "storager_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    }),
    createEntity("belt1", "belt_straight_1x1", 0, -1, 270),
    createEntity("sink1", "storager_1", 0, -4, 0),
    createEntity("belt2", "belt_straight_1x1", 1, -1, 270),
    createEntity("sink2", "storager_1", 1, -4, 0),
  ]);
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
      ignoreStock: false,
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

function createHostWorkspace(
  document: ReturnType<typeof createWorldDocumentFromBlueprint>,
  registry: RegistryContract,
): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry,
    app: null,
    editor: {
      document: createSnapshotStore(document),
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
    sync: null,
  };
}

function hasHostTransfer(
  host: ReturnType<typeof createSimulationHost>,
  sourceDeviceId: string,
  targetDeviceId: string,
): boolean {
  return host.internalState.currentSnapshot?.transfers.some((transfer) =>
    transfer.sourceSlotId.includes(sourceDeviceId)
    && transfer.targetSlotId.includes(targetDeviceId)
  ) ?? false;
}
