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

/**
 * 管道相位门禁（液体版）端到端测试。
 *
 * 与传送带版（belt-phase-gating）对照：
 *   - 传送带族（BeltFamily）在 2026-07-23 重构后失去门禁（回归，测试应失败）；
 *   - 管道设备族（PipeFamily）始终有门禁 `(standardTick - 1) % transferUnitTicks === 0`，
 *     transferUnitTicks = min(round(0.5×20), 20) = 10，合法相位为 tick 1、11、21…
 *   （本测试用于证明管道门禁在端到端仍生效，作为修复传送带门禁时不回归的对照。）
 *
 * 设备差异：`liquid_storager_1` 是单槽单口（1 进 1 出），无法像协议储存箱那样
 * 用"第二槽位 + 第二条管道"复刻。因此场景改为：源槽位初始为空（管道空闲），
 * 在非门禁时刻 tick 5 注入液体，验证管道要等到 10 tick 相位点 tick 11 才接收。
 */
describe("管道相位门禁（液体版）", () => {
  it("非门禁时刻放入的液体，管道要等到 10 tick 相位点才第一次接到", () => {
    const registry = createRegistryContract();
    const runtime = new SimulationWorkerRuntime(registry);
    runtime.handleRequest({
      type: "load-topology",
      requestId: 1,
      topology: createLiquidPhaseGatingTopology(registry),
      simulationSpeed: STANDARD_SPEED,
    });

    // 源槽位初始为空（管道空闲）；推进到 tick 5（非门禁，5-1=4 非 10 倍数）。
    runtime.advanceToTick(5);
    runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: 50,
      tickNumber: 5,
      simulationSpeed: STANDARD_SPEED,
    });
    // tick 5 向源槽位放入液体。
    runtime.handleRequest({
      type: "patch-runtime-slot",
      requestId: 9000,
      patch: {
        entityId: "source",
        storageGroupId: "liquid_storage",
        slotId: "slot_1",
        itemType: "item_liquid_water",
        count: 1,
        ignoreStock: false,
      },
    });

    // 管道门禁（transferUnitTicks=10）：tick 6-10 非相位不接收，tick 11 才接。
    const pipeReceives = collectReceives(runtime, 6, 61, "device:source", "device:pipe");
    expect(pipeReceives[0]).toBe(11);
    expect(pipeReceives.filter((tick) => tick < 11)).toEqual([]);
  });
});

function createLiquidPhaseGatingTopology(registry: RegistryContract): CompiledSimulationTopology {
  const document = createWorldDocumentFromBlueprint(
    createBlueprint("pipe-phase-gating", [
      createEntity("source", "liquid_storager_1", 0, 0, 0),
      createEntity("pipe", "pipe_straight_1x1", 3, 1),
      createEntity("sink", "liquid_storager_1", 4, 0),
    ]),
  );
  return compileSimulationTopology({
    document,
    registry,
    poweredEntityIds: new Set(document.entityOrder),
  });
}

function collectReceives(
  runtime: SimulationWorkerRuntime,
  fromTick: number,
  toTick: number,
  sourceDeviceId: string,
  targetDeviceId: string,
): number[] {
  const ticks: number[] = [];
  for (let tickNumber = fromTick; tickNumber <= toTick; tickNumber += 1) {
    runtime.advanceToTick(tickNumber);
    const response = runtime.handleRequest({
      type: "get-tick-snapshot",
      requestId: tickNumber + 10_000,
      tickNumber,
      simulationSpeed: STANDARD_SPEED,
    });
    const transfers = response.type === "tick-snapshot-result"
      ? response.result.currentTick?.transfers ?? []
      : [];
    if (transfers.some((transfer) =>
      transfer.sourceSlotId.includes(sourceDeviceId)
      && transfer.targetSlotId.includes(targetDeviceId),
    )) {
      ticks.push(tickNumber);
    }
  }
  return ticks;
}
