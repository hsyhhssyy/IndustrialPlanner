import { describe, expect, it } from "vitest";

import { CONSUMPTION_SLOT_ID, CONSUMPTION_STORAGE_GROUP_ID } from "@/shared/consumption-channel";
import type { CompiledSimulationTopology, RuntimeTickSnapshot } from "@/simulation/contracts";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/contracts/tick-rate";
import { periodicEnvironmentTimeUnits } from "@/simulation/environment";
import { SimulationWorkerRuntime } from "@/simulation/legacy/worker-runtime";
import { compileSimulationTopology } from "@/simulation/topology/compiler";

import {
  loadPeriodicRangeConversionFixture,
  PERIODIC_FIXTURE_PRODUCT_ITEM as PRODUCT,
  PERIODIC_FIXTURE_RAW_ITEM as RAW,
} from "./periodic-range-conversion-fixture";

function compileFixture(fixture: ReturnType<typeof loadPeriodicRangeConversionFixture>) {
  return compileSimulationTopology({
    ...fixture,
    simulationMode: "single-base",
    poweredEntityIds: new Set(fixture.document.entityOrder),
    standardTickRate: STANDARD_TICK_RATE_PER_SECOND,
  });
}

function getDevice(topology: CompiledSimulationTopology, entityId: string) {
  const device = Object.values(topology.devices).find(candidate => candidate.sourceEntityId === entityId);
  if (device === undefined) throw new Error(`Missing fixture device: ${entityId}`);
  return device;
}

function countItem(snapshot: RuntimeTickSnapshot, topology: CompiledSimulationTopology, entityId: string, itemType: string) {
  const device = getDevice(topology, entityId);
  const slotIds = new Set(device.nodeIds.flatMap(nodeId => topology.nodes[nodeId]!.slotIds));
  return [...slotIds].reduce((total, slotId) => {
    const slot = snapshot.slots[slotId];
    return total + (slot?.itemType === itemType ? slot.count : 0);
  }, 0);
}

describe("Legacy 周期范围转化", () => {
  it("转换运输中的预占物品，恢复检查点后保留进度并可交付给下游", () => {
    const fixture = loadPeriodicRangeConversionFixture(2.5);
    const topology = compileFixture(fixture);
    expect(topology.diagnostics.filter(entry => entry.severity === "error")).toEqual([]);
    const runtime = new SimulationWorkerRuntime(fixture.registry);
    const resumed = new SimulationWorkerRuntime(fixture.registry);
    const resumedOld = new SimulationWorkerRuntime(fixture.registry);

    try {
      runtime.initializeIsolated(topology, "infinite", []);
      let tick = runtime.advanceIsolated();
      while (tick.tickNumber < 49) tick = runtime.advanceIsolated();
      const before = runtime.exportRuntimeState()!;
      expect(before.runtimeState.persistent.periodicEnvironment?.regions).toHaveLength(1);
      expect(countItem(before.snapshot, topology, "covered-belt", RAW)).toBe(1);
      const covered = getDevice(topology, "covered-belt");
      const running = before.snapshot.devices[covered.id]!.recipe!;
      expect(running.progressTicks).toBeGreaterThan(0);

      expect(resumed.importRuntimeState(structuredClone(before), { scheduleBackgroundFill: false }).status.status)
        .toBe("ready");
      const mid = resumed.advanceIsolated();
      expect(mid.tickNumber).toBe(50);
      const triggered = resumed.advanceIsolated();
      expect(triggered.tickNumber).toBe(51);
      expect(countItem(triggered, topology, "covered-belt", PRODUCT)).toBe(1);
      expect(countItem(triggered, topology, "belt", RAW)).toBe(1);
      const after = resumed.exportRuntimeState()!.runtimeState.persistent.devices[covered.id]!.channelRecipes.default!;
      expect(after.runId).toBe(running.runId);
      expect(after.progressTicks).toBeGreaterThan(running.progressTicks);
      expect(after.inputItems).toEqual([{ itemType: PRODUCT, amount: 1 }]);
      expect(after.reservations).toMatchObject([{ itemType: PRODUCT, amount: 1 }]);

      const oldFormat = structuredClone(before);
      delete oldFormat.runtimeState.persistent.periodicEnvironment;
      expect(resumedOld.importRuntimeState(oldFormat, { scheduleBackgroundFill: false }).status.status).toBe("ready");
      expect(resumedOld.exportRuntimeState()!.runtimeState.persistent.devices[covered.id]!.channelRecipes.default)
        .toEqual(before.runtimeState.persistent.devices[covered.id]!.channelRecipes.default);
      resumedOld.advanceIsolated();
      const oldAtDue = resumedOld.advanceIsolated();
      expect(countItem(oldAtDue, topology, "covered-belt", RAW)).toBe(1);
      expect(countItem(oldAtDue, topology, "covered-belt", PRODUCT)).toBe(0);

      let downstreamProduct = 0;
      let sinkProduct = 0;
      for (let frame = 0; frame < 100 && sinkProduct === 0; frame++) {
        const result = resumed.advanceIsolated();
        downstreamProduct = Math.max(downstreamProduct, countItem(result, topology, "downstream-belt", PRODUCT));
        sinkProduct = countItem(result, topology, "sink-storage", PRODUCT);
      }
      expect(downstreamProduct).toBe(1);
      expect(sinkProduct).toBeGreaterThan(0);
    } finally {
      runtime.disposeIsolated();
      resumed.disposeIsolated();
      resumedOld.disposeIsolated();
    }
  });

  it("用真实拓扑迁移保留同一作用区进度，拆除后再创建从零开始", () => {
    const fixture = loadPeriodicRangeConversionFixture(2.5);
    const topology = compileFixture(fixture);
    const runtime = new SimulationWorkerRuntime(fixture.registry);
    const document = fixture.document;
    const withoutSource = compileFixture({
      ...fixture,
      document: {
        ...document,
        entities: Object.fromEntries(Object.entries(document.entities).filter(([id]) => id !== "gas-diffuser")),
        entityOrder: document.entityOrder.filter(id => id !== "gas-diffuser"),
      },
    });

    try {
      runtime.initializeIsolated(topology, "infinite", []);
      runtime.advanceToTick(46);
      const before = runtime.exportRuntimeState(46)!;
      expect(before.runtimeState.persistent.periodicEnvironment?.regions).toHaveLength(1);

      const unrelatedEdit = compileFixture({
        ...fixture,
        document: {
          ...document,
          entities: { ...document.entities, power: {
            ...document.entities.power!,
            position: { x: 5, y: 4 },
          } },
        },
      });
      const moved = runtime.handleRequest({
        type: "load-topology", requestId: 1, topology: unrelatedEdit,
        migration: { baseTickNumber: 46, resetDeviceIds: [getDevice(unrelatedEdit, "power").id] },
      });
      expect(moved).toMatchObject({ type: "topology-loaded", result: { status: "started" } });
      runtime.advanceToTick(51);
      expect(countItem(runtime.exportRuntimeState(51)!.snapshot, unrelatedEdit, "covered-belt", PRODUCT)).toBe(1);

      const removed = runtime.handleRequest({
        type: "load-topology", requestId: 2, topology: withoutSource,
        migration: { baseTickNumber: 51, resetDeviceIds: [getDevice(topology, "gas-diffuser").id] },
      });
      expect(removed).toMatchObject({ type: "topology-loaded", result: { status: "started" } });
      expect(runtime.exportRuntimeState(51)!.runtimeState.persistent.periodicEnvironment).toBeUndefined();
      expect(countItem(runtime.exportRuntimeState(51)!.snapshot, withoutSource, "covered-belt", PRODUCT)).toBe(1);

      const rebuilt = runtime.handleRequest({
        type: "load-topology", requestId: 3, topology,
        migration: { baseTickNumber: 51, resetDeviceIds: [getDevice(topology, "gas-diffuser").id] },
      });
      expect(rebuilt).toMatchObject({ type: "topology-loaded", result: { status: "started" } });
      const newRegion = runtime.exportRuntimeState(51)!.runtimeState.persistent.periodicEnvironment?.regions[0];
      expect(newRegion?.remainingMs).toBe(newRegion?.periodMs);
      expect(newRegion?.active).toBe(false);
    } finally {
      runtime.disposeIsolated();
    }
  });

  it("耗尽燃料时保留累计进度，重新供料后只执行剩余时长", () => {
    const fixture = loadPeriodicRangeConversionFixture(12.5);
    const topology = compileFixture(fixture);
    const runtime = new SimulationWorkerRuntime(fixture.registry);
    const patch = {
      entityId: "gas-diffuser",
      storageGroupId: CONSUMPTION_STORAGE_GROUP_ID,
      slotId: CONSUMPTION_SLOT_ID,
      itemType: "item_gas_xiranite",
      count: 1,
      ignoreStock: false,
    };
    const rate = topology.standardTickRate;
    const readRegion = () => runtime.exportRuntimeState()!.runtimeState.persistent.periodicEnvironment!.regions[0]!;

    try {
      runtime.initializeIsolated(topology, "infinite", [patch]);
      let frame = runtime.advanceIsolated();
      if (frame.tickNumber === 0) frame = runtime.advanceIsolated();
      expect(readRegion().active).toBe(true);
      while (frame.tickNumber < 10 * rate + 1) frame = runtime.advanceIsolated();
      const paused = readRegion();
      expect(paused.active).toBe(false);
      expect(paused.remainingMs).toBe(periodicEnvironmentTimeUnits(2.5 * rate + 1, rate));
      while (frame.tickNumber < 22 * rate + 1) frame = runtime.advanceIsolated();
      expect(readRegion()).toEqual(paused);

      runtime.patchIsolatedSlot(patch);
      for (let step = 0; step < rate && !readRegion().active; step++) frame = runtime.advanceIsolated();
      const resumed = readRegion();
      expect(resumed.active).toBe(true);
      expect(resumed.remainingMs).toBe(paused.remainingMs);
      const dueTick = frame.tickNumber + 2.5 * rate;
      while (frame.tickNumber < dueTick - 1) frame = runtime.advanceIsolated();
      expect(readRegion()).toEqual(resumed);
      expect(runtime.advanceIsolated().tickNumber).toBe(dueTick);
      expect(readRegion().remainingMs).toBe(resumed.periodMs);
    } finally {
      runtime.disposeIsolated();
    }
  });

  it("粗步长在周期到期时插入真实帧，并从该帧返回原物流相位", () => {
    const fixture = loadPeriodicRangeConversionFixture(2.25);
    const topology = compileFixture(fixture);
    const runtime = new SimulationWorkerRuntime(fixture.registry);
    try {
      runtime.initializeIsolated(topology, "infinite", []);
      runtime.setFixedDynamicTickRate(2);
      let frame = runtime.advanceIsolated();
      while (frame.tickNumber < 41) frame = runtime.advanceIsolated();
      expect(frame.tickNumber).toBe(41);
      expect(countItem(frame, topology, "covered-belt", RAW)).toBe(1);
      expect(topology.standardTickRate / frame.tickRate).toBe(5);
      frame = runtime.advanceIsolated();
      expect(frame.tickNumber).toBe(46);
      expect(countItem(frame, topology, "covered-belt", PRODUCT)).toBe(1);
      expect(runtime.advanceIsolated().tickNumber).toBe(51);
    } finally {
      runtime.disposeIsolated();
    }
  });
});
