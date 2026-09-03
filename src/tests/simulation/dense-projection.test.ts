import { describe, expect, it } from "vitest";

import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import { createRegistryContract } from "@/registry";
import {
  DenseFrameDeltaEncoder,
  DenseIndexSet,
  DenseMessageSequenceGate,
  DenseProjectionStore,
  DenseRuntimeState,
  collectDenseFrameTransferables,
  collectDenseTopologyTransferables,
  compileDenseTopologyLayout,
} from "@/simulation/dense";

import {
  createBlueprint,
  createEntity,
  getDevice,
  getTick,
  createWorldDocumentFromBlueprint,
} from "./blueprint-test-helpers";
import {
  createHeadlessWorkspace,
  runBlueprintSimulation,
} from "./blueprint-runner";
import { createSimulationHost } from "@/simulation/simulation-host";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";

const DENSE_TEST_SESSION = {
  sessionId: "dense-projection-test",
  topologyVersion: 1,
} as const;

function createDenseProjectionBlueprint(): BlueprintDocument {
  return createBlueprint("dense-projection", [
    createEntity("source-storage", "storager_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
      "storageSlotGroups[0].slots[0].initialCount": 20,
    }),
    createEntity("belt", "belt_straight_1x1", 0, -1, 270),
    createEntity("sink-storage", "storager_1", 0, -4),
  ]);
}

describe("ST2-RQ-023 dense projection", () => {
  it("runs a real blueprint through the explicitly selected dense-v2 host", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createBlueprint("dense-v2-host", [
        createEntity("storage", "storager_1", 0, 0, 0, {
          "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
          "storageSlotGroups[0].slots[0].initialCount": 20,
        }),
      ]),
      registry: createRegistryContract(),
      maxTickNumber: 1,
      engineKind: "dense-v2",
    });

    expect(getTick(report, 0).status).toBe("initial");
    expect(getTick(report, 1).status).toBe("running");
    expect(getTick(report, 1).transfers).toEqual([]);
    expect(getDevice(report, 1, "storage").slotItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storageGroupId: "storage_slot_1",
          slotId: "slot_1",
          itemType: "item_iron_ore",
          count: 20,
        }),
      ]),
    );
  });

  it("executes transport recipes in dense-v2 without delegating to legacy runtime", async () => {
    const report = await runBlueprintSimulation({
      blueprint: createDenseProjectionBlueprint(),
      registry: createRegistryContract(),
      maxTickNumber: 41,
      engineKind: "dense-v2",
    });

    expect(getTick(report, 1).transfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemType: "item_iron_ore",
        amount: 1,
      }),
    ]));
    expect(getTick(report, 41).transfers.some((transfer) =>
      transfer.sourceSlotId.includes("device:belt")
      && transfer.targetSlotId.includes("device:sink-storage")
    )).toBe(true);
    expect(getDevice(report, 41, "belt").channelRecipes.default?.recipeId)
      .toBe("belt_straight_1x1:dynamic-belt-transfer");
  });

  it("matches legacy warehouse production statistics after the first full minute", async () => {
    const blueprint = createBlueprint("dense-v2-warehouse-stats", [
      createEntity("pump", "water_pump_1", 0, 0, 0, {
        channelRecipes: { default: "r_pump_water_basic" },
      }),
      createEntity("power", "power_diffuser_1", 4, 0),
    ]);
    const maxTickNumber = 60 * STANDARD_TICK_RATE_PER_SECOND;
    const registry = createRegistryContract();
    const [legacy, dense] = await Promise.all([
      runBlueprintSimulation({ blueprint, registry, maxTickNumber }),
      runBlueprintSimulation({
        blueprint,
        registry,
        maxTickNumber,
        engineKind: "dense-v2",
      }),
    ]);

    expect(getTick(dense, 0).warehouseStats).toEqual(getTick(legacy, 0).warehouseStats);
    expect(getTick(dense, maxTickNumber).warehouseStats)
      .toEqual(getTick(legacy, maxTickNumber).warehouseStats);
    expect(getTick(dense, maxTickNumber).warehouseStats).toMatchObject({
      statsWindowReady: true,
      items: {
        item_liquid_water: {
          producedPerMinute: expect.any(Number),
          lastChangedTick: expect.any(Number),
        },
      },
    });
  }, 120_000);

  it("round-trips consecutive real simulation frames through dense deltas", async () => {
    const registry = createRegistryContract();
    const workspace = createHeadlessWorkspace(
      createWorldDocumentFromBlueprint(createDenseProjectionBlueprint()),
      registry,
    );
    const host = createSimulationHost(workspace, { workerMode: "runtime" });

    try {
      const startResult = await host.internalActions.refreshFromCurrentDocument();
      expect(startResult.status).toBe("started");
      const topology = host.topology.getSnapshot();
      expect(topology).not.toBeNull();
      if (topology === null) return;

      const layout = compileDenseTopologyLayout(topology, registry);
      const runtimeState = new DenseRuntimeState(layout);
      const encoder = new DenseFrameDeltaEncoder(layout.dictionary, DENSE_TEST_SESSION);
      const projection = new DenseProjectionStore(layout.dictionary, DENSE_TEST_SESSION);

      expect((await host.internalActions.syncToTick(0)).status).toBe("ready");
      const tickZero = host.internalState.currentSnapshot;
      expect(tickZero).not.toBeNull();
      if (tickZero === null) return;

      for (let slotIndex = 0; slotIndex < layout.dictionary.slotIds.length; slotIndex += 1) {
        const slotId = layout.dictionary.slotIds[slotIndex]!;
        const expectedSlot = tickZero.slots[slotId]!;
        const denseSlot = runtimeState.readSlot(slotIndex);
        expect({
          itemType: denseSlot.itemIndex === -1
            ? null
            : layout.dictionary.itemIds[denseSlot.itemIndex],
          count: denseSlot.count,
          reserved: denseSlot.reserved,
          ignoreStock: denseSlot.ignoreStock,
        }).toEqual({
          itemType: expectedSlot.itemType,
          count: expectedSlot.count,
          reserved: expectedSlot.reserved,
          ignoreStock: expectedSlot.ignoreStock,
        });
      }

      const firstDelta = encoder.encode(tickZero);
      projection.apply(firstDelta);
      expect(projection.materializeSnapshot()).toEqual(tickZero);
      expect(firstDelta.changedSlotIndexes).toHaveLength(layout.dictionary.slotIds.length);
      const sourceSlotId = layout.dictionary.slotIds.find((slotId) =>
        slotId.includes("device:source-storage")
      );
      expect(sourceSlotId).toBeDefined();
      if (sourceSlotId !== undefined) {
        const current = projection.getSlot(sourceSlotId);
        expect(current).not.toBeNull();
        if (current !== null) {
          expect(runtimeState.writeSlotById(sourceSlotId, {
            itemId: current.itemType,
            count: current.count + 1,
            reserved: current.reserved,
            ignoreStock: current.ignoreStock,
          })).toBe(true);
          expect(runtimeState.dirtySlotIndexes.size).toBe(1);
          expect(runtimeState.activeDeviceIndexes.size).toBe(1);
        }
      }
      expect(new Set(collectDenseFrameTransferables(firstDelta)).size).toBe(
        collectDenseFrameTransferables(firstDelta).length,
      );
      expect(new Set(collectDenseTopologyTransferables(layout)).size).toBe(
        collectDenseTopologyTransferables(layout).length,
      );

      expect((await host.internalActions.syncToTick(1)).status).toBe("ready");
      const tickOne = host.internalState.currentSnapshot;
      expect(tickOne).not.toBeNull();
      if (tickOne === null) return;

      const secondDelta = encoder.encode(tickOne);
      projection.apply(secondDelta);
      expect(projection.tickNumber).toBe(1);
      expect(projection.frameSequence).toBe(2);
      expect(projection.materializeSnapshot()).toEqual(tickOne);
      expect(secondDelta.changedSlotIndexes.length).toBeLessThanOrEqual(
        layout.dictionary.slotIds.length,
      );
    } finally {
      host.dispose();
    }
  });

  it("rejects non-contiguous frame sequences before mutating the projection", async () => {
    const registry = createRegistryContract();
    const workspace = createHeadlessWorkspace(
      createWorldDocumentFromBlueprint(createDenseProjectionBlueprint()),
      registry,
    );
    const host = createSimulationHost(workspace, { workerMode: "runtime" });

    try {
      await host.internalActions.refreshFromCurrentDocument();
      await host.internalActions.syncToTick(0);
      const topology = host.topology.getSnapshot();
      const snapshot = host.internalState.currentSnapshot;
      expect(topology).not.toBeNull();
      expect(snapshot).not.toBeNull();
      if (topology === null || snapshot === null) return;

      const dictionary = compileDenseTopologyLayout(topology, registry).dictionary;
      const delta = new DenseFrameDeltaEncoder(dictionary, DENSE_TEST_SESSION).encode(snapshot);
      const projection = new DenseProjectionStore(dictionary, DENSE_TEST_SESSION);

      expect(() => projection.apply({ ...delta, frameSequence: 2 })).toThrow(
        "Dense projection expected frame 1, received 2.",
      );
      expect(projection.frameSequence).toBe(0);
    } finally {
      host.dispose();
    }
  });

  it("validates the entire frame before applying any projection mutation", async () => {
    const registry = createRegistryContract();
    const workspace = createHeadlessWorkspace(
      createWorldDocumentFromBlueprint(createDenseProjectionBlueprint()),
      registry,
    );
    const host = createSimulationHost(workspace, { workerMode: "runtime" });

    try {
      await host.internalActions.refreshFromCurrentDocument();
      await host.internalActions.syncToTick(0);
      const topology = host.topology.getSnapshot();
      const snapshot = host.internalState.currentSnapshot;
      expect(topology).not.toBeNull();
      expect(snapshot).not.toBeNull();
      if (topology === null || snapshot === null) return;

      const dictionary = compileDenseTopologyLayout(topology, registry).dictionary;
      const delta = new DenseFrameDeltaEncoder(dictionary, DENSE_TEST_SESSION).encode(snapshot);
      const projection = new DenseProjectionStore(dictionary, DENSE_TEST_SESSION);
      projection.apply(delta);

      const slotId = dictionary.slotIds[0]!;
      const before = projection.getSlot(slotId);
      const firstDevice = delta.changedDevices[0]!;
      const invalidNextFrame = {
        ...delta,
        frameSequence: 2,
        changedSlotIndexes: Uint32Array.of(0),
        changedSlotItemIndexes: Int32Array.of(delta.changedSlotItemIndexes[0]!),
        changedSlotNumbers: Float64Array.of(
          delta.changedSlotNumbers[0]! + 10,
          delta.changedSlotNumbers[1]!,
        ),
        changedSlotFlags: Uint8Array.of(delta.changedSlotFlags[0]!),
        changedDeviceIndexes: Uint32Array.of(0),
        changedDevices: [{ ...firstDevice, deviceId: "invalid-device" }],
        changedNodeIndexes: new Uint32Array(),
        changedNodes: [],
        changedComponentIndexes: new Uint32Array(),
        changedComponentItemIndexes: new Int32Array(),
      };

      expect(() => projection.apply(invalidNextFrame)).toThrow("Dense device delta id mismatch");
      expect(projection.getSlot(slotId)).toEqual(before);
      expect(projection.frameSequence).toBe(1);
    } finally {
      host.dispose();
    }
  });

  it("deduplicates active indexes and drains without allocating a persistent object set", () => {
    const active = new DenseIndexSet(96);
    expect(active.add(1)).toBe(true);
    expect(active.add(1)).toBe(false);
    expect(active.add(63)).toBe(true);
    expect(active.add(95)).toBe(true);
    expect(active.size).toBe(3);

    const drained: number[] = [];
    active.drain((index) => drained.push(index));

    expect(drained).toEqual([1, 63, 95]);
    expect(active.size).toBe(0);
    expect(active.has(1)).toBe(false);
    expect(active.add(1)).toBe(true);
  });

  it("rejects stale sessions, topology versions, and protocol sequence gaps", () => {
    const gate = new DenseMessageSequenceGate(DENSE_TEST_SESSION);
    gate.accept({
      protocolVersion: 1,
      ...DENSE_TEST_SESSION,
      sequence: 1,
    });
    expect(gate.expectedSequence).toBe(2);
    expect(() => gate.accept({
      protocolVersion: 1,
      ...DENSE_TEST_SESSION,
      sequence: 3,
    })).toThrow("Dense protocol sequence gap: expected 2, received 3.");
    expect(gate.expectedSequence).toBe(2);
    expect(() => gate.accept({
      protocolVersion: 1,
      sessionId: "stale-session",
      topologyVersion: 1,
      sequence: 2,
    })).toThrow("Dense protocol session mismatch");
    expect(() => gate.accept({
      protocolVersion: 1,
      sessionId: DENSE_TEST_SESSION.sessionId,
      topologyVersion: 2,
      sequence: 2,
    })).toThrow("Dense protocol topology version mismatch");
  });
});
