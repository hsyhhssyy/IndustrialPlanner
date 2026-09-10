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
import { createBlueprint, createEntity, createWorldDocumentFromBlueprint } from "./blueprint-test-helpers";
import { describeSimulationEngineMatrix } from "./simulation-engine-matrix";

describeSimulationEngineMatrix("simulation engine boundary", (engineKind) => {
  it("keeps public state free of snapshots while queries follow runtime edits and restart", async () => {
    const document = createWorldDocumentFromBlueprint(createBlueprint("engine-boundary-storage", [
      createEntity("storage", "storager_1", 0, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_copper_ore",
        "storageSlotGroups[0].slots[0].initialCount": 7,
      }),
    ]));
    const workspace = createHeadlessWorkspace(document, createRegistryContract());
    const host = createSimulationHost(workspace, { engineKind, workerMode: "runtime" });
    try {
      expect(host.queries.getDeviceRuntimeStatus("storage")).toBeNull();
      expect(readSimulationSnapshot(host)).toBeNull();
      await host.actions.start();
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
      expect(host.queries.getPipeFluidItemId("missing")).toBeNull();
      expect(host.queries.isPipeDeviceSlotOccupied("missing")).toBe(false);
      expect(host.queries.getDeviceActiveGasItemIds("missing")).toBeNull();
      host.actions.stop();
      expect(host.queries.getDeviceRuntimeStatus("storage")).toBeNull();
      expect(readSimulationSnapshot(host)).toBeNull();
      await host.actions.start();
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
    ]));
    const documentStore = createSnapshotStore(document);
    const workspace = createHeadlessWorkspace(document, createRegistryContract());
    if (workspace.editor === null) throw new Error("Expected headless editor");
    workspace.editor = { ...workspace.editor, document: documentStore };
    const host = createSimulationHost(workspace, { engineKind, workerMode: "runtime" });
    try {
      await host.actions.start();
      host.actions.pause();
      expect(host.queries.getDeviceRuntimeStatus("storage")).not.toBeNull();
      const replacement = createEntity("replacement", "storager_1", 4, 0, 0, {
        "storageSlotGroups[0].slots[0].initialItemType": "item_iron_ore",
        "storageSlotGroups[0].slots[0].initialCount": 3,
      });
      documentStore.setSnapshot({
        ...document, entities: { [replacement.id]: replacement }, entityOrder: [replacement.id],
      });
      expect((await host.internalActions.refreshFromCurrentDocument()).status).toBe("started");
      expect(host.queries.getDeviceRuntimeStatus("storage")).toBeNull();
      expect(host.queries.getDeviceRuntimeStatus("replacement")?.slotItems).toContainEqual(
        expect.objectContaining({ itemType: "item_iron_ore", count: 3 }),
      );
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
