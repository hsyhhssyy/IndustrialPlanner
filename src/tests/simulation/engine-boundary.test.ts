import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createRegistryContract } from "@/registry";
import { DenseProjectionStore } from "@/simulation/dense";
import { createSimulationHost } from "@/simulation/simulation-host";
import { readSimulationSnapshot } from "@/simulation/testkit";
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store";

import { createHeadlessWorkspace } from "./blueprint-runner";
import {
  createBlueprint,
  createEntity,
  createWorldDocumentFromBlueprint,
  resolveFirstTickNumberAtSimulationMilliseconds,
} from "./blueprint-test-helpers";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

describeSimulationEngineMatrix("simulation engine boundary", (engineKind) => {
  it("keeps public state free of snapshots while queries follow runtime edits and restart", async () => {
    const document = createWorldDocumentFromBlueprint(createBlueprint("engine-boundary-storage", [
      createEntity("storage", "storager_1", 0, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
        "storageSlotGroups[0].slots[0].initialCount": 7,
      }),
      createEntity("power", "power_diffuser_1", 4, 0),
    ]));
    const workspace = createHeadlessWorkspace(document, createRegistryContract());
    const host = createSimulationHost(workspace, { engineKind, workerMode: "runtime" });
    try {
      expect(host.queries.getDeviceOperatingStatus("storage")).toBe("closed");
      expect(host.queries.getDeviceRuntimeStatus("storage")).toBeNull();
      expect(readSimulationSnapshot(host)).toBeNull();
      await host.actions.start();
      expect(host.queries.getDeviceOperatingStatus("storage")).toBe("idle");
      expect(host.queries.getDeviceOperatingStatus("device:storage")).toBe("idle");
      expect(host.state).not.toHaveProperty("statistics");
      expect(host.state).not.toHaveProperty("bufferSize");
      expect(host.queries.getPerformanceDiagnostics()).toMatchObject({
        targetTickPerSecond: host.queries.getDocumentRuntimeStatus()?.tickRate,
      });
      expect(host.state).not.toHaveProperty("currentSnapshot");
      expect(host.internalState).not.toHaveProperty("currentSnapshot");
      expect(host.queries.getDeviceRuntimeStatus("storage")?.slotItems).toContainEqual(
        expect.objectContaining({ itemType: "item_copper_ore", count: 7 }),
      );
      expect(host.queries.getDeviceRuntimeStatus("device:storage")).toEqual(
        host.queries.getDeviceRuntimeStatus("storage"),
      );
      const before = readSimulationSnapshot(host);
      const beforeJson = JSON.stringify(before);
      host.actions.pause();
      await host.actions.patchRuntimeSlot({
        entityId: "storage", storageGroupId: "storage_slot_1", slotId: "slot_1",
        itemType: "item_copper_ore", count: 11, ignoreStock: false,
      });
      expect(host.queries.getDeviceRuntimeStatus("storage")?.slotItems).toContainEqual(
        expect.objectContaining({ itemType: "item_copper_ore", count: 11 }),
      );
      expect(JSON.stringify(before)).toBe(beforeJson);
      expect(host.queries.getDeviceRuntimeStatus("missing")).toBeNull();
      expect(host.queries.getDeviceOperatingStatus("missing")).toBeNull();
      expect(host.queries.getPipeFluidItemId("missing")).toBeNull();
      expect(host.queries.isPipeDeviceSlotOccupied("missing")).toBe(false);
      expect(host.queries.getDeviceActiveGasItemIds("missing")).toBeNull();
      host.actions.stop();
      expect(host.queries.getDeviceOperatingStatus("storage")).toBe("closed");
      expect(host.queries.getDeviceRuntimeStatus("storage")).toBeNull();
      expect(readSimulationSnapshot(host)).toBeNull();
      await host.actions.start();
      expect(host.queries.getDeviceOperatingStatus("storage")).toBe("idle");
      expect(host.queries.getDeviceRuntimeStatus("storage")?.slotItems).toContainEqual(
        expect.objectContaining({ itemType: "item_copper_ore", count: 7 }),
      );
    } finally {
      host.dispose();
    }
    expect(() => readSimulationSnapshot(host)).toThrow("disposed");
  });

  it("refreshes query topology and removes stale device results", async () => {
    const document = createWorldDocumentFromBlueprint(createBlueprint("engine-boundary-topology", [
      createEntity("storage", "storager_1", 0, 0),
      createEntity("power", "power_diffuser_1", 4, 0),
    ]));
    const documentStore = createSnapshotStore(document);
    const workspace = createHeadlessWorkspace(document, createRegistryContract());
    if (workspace.editor === null) throw new Error("Expected headless editor");
    workspace.editor = { ...workspace.editor, document: documentStore };
    const host = createSimulationHost(workspace, { engineKind, workerMode: "runtime" });
    try {
      await host.actions.start();
      host.actions.pause();
      expect(host.queries.getDeviceOperatingStatus("storage")).toBe("idle");
      expect(host.queries.getDeviceRuntimeStatus("storage")).not.toBeNull();
      const replacement = createEntity("replacement", "storager_1", 4, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
        "storageSlotGroups[0].slots[0].initialCount": 3,
      });
      const replacementPower = createEntity("replacement-power", "power_diffuser_1", 8, 0);
      documentStore.setSnapshot({
        ...document,
        entities: {
          [replacement.id]: replacement,
          [replacementPower.id]: replacementPower,
        },
        entityOrder: [replacement.id, replacementPower.id],
      });
      expect((await host.internalActions.refreshFromCurrentDocument()).status).toBe("started");
      expect(host.queries.getDeviceOperatingStatus("storage")).toBeNull();
      expect(host.queries.getDeviceOperatingStatus("replacement")).toBe("idle");
      expect(host.queries.getDeviceRuntimeStatus("storage")).toBeNull();
      expect(host.queries.getDeviceRuntimeStatus("replacement")?.slotItems).toContainEqual(
        expect.objectContaining({ itemType: "item_iron_ore", count: 3 }),
      );
    } finally {
      host.dispose();
    }
  });

  it("projects progressing and waiting-output recipes as normal and blocked", async () => {
    const document = createWorldDocumentFromBlueprint(createBlueprint("engine-boundary-operating-status", [
      createEntity("grinder", "grinder_1", 0, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
        "storageSlotGroups[0].slots[0].initialCount": 1,
        "storageSlotGroups[1].slots[0].initialItemType": "item_iron_powder",
        "storageSlotGroups[1].slots[0].initialCount": 50,
      }),
      createEntity("power", "power_diffuser_1", 4, 0),
    ]));
    const workspace = createHeadlessWorkspace(document, createRegistryContract());
    const host = createSimulationHost(workspace, { engineKind, workerMode: "runtime" });
    try {
      await host.actions.start();
      const topology = host.topology.getSnapshot();
      if (topology === null) throw new Error("Expected compiled topology");
      const progressingTick = resolveFirstTickNumberAtSimulationMilliseconds(
        topology.standardTickRate,
        500,
      );
      expect((await host.internalActions.syncToTick(progressingTick)).status).toBe("ready");
      expect(host.queries.getDeviceOperatingStatus("grinder")).toBe("normal");
      const completionTick = resolveFirstTickNumberAtSimulationMilliseconds(
        topology.standardTickRate,
        2_000,
      );
      expect((await host.internalActions.syncToTick(completionTick)).status).toBe("ready");
      expect(host.queries.getDeviceOperatingStatus("grinder")).toBe("blocked");
    } finally {
      host.dispose();
    }
  });
});

describe("dense projection observation", () => {
  it("materializes full snapshots only when testkit explicitly reads them", async () => {
    const materialize = vi.spyOn(DenseProjectionStore.prototype, "materializeSnapshot");
    const document = createWorldDocumentFromBlueprint(createBlueprint("dense-lazy-snapshot", [
      createEntity("storage", "storager_1", 0, 0),
    ]));
    const workspace = createHeadlessWorkspace(document, createRegistryContract());
    const host = createSimulationHost(workspace, { engineKind: "dense-v2", workerMode: "runtime" });
    try {
      await host.actions.start();
      await host.actions.advancePlaybackByDeltaMs(500);
      host.queries.getStatusRuntimeJson();
      host.queries.getDocumentRuntimeStatus();
      host.queries.getDeviceOperatingStatus("storage");
      host.queries.getDeviceRuntimeStatus("storage");
      host.queries.getWarehouseStats();
      expect(materialize).not.toHaveBeenCalled();
      const snapshot = readSimulationSnapshot(host);
      expect(snapshot?.tickNumber).toBe(host.queries.getDocumentRuntimeStatus()?.tickNumber);
      expect(materialize).toHaveBeenCalledTimes(1);
    } finally {
      host.dispose();
      materialize.mockRestore();
    }
  });
});
