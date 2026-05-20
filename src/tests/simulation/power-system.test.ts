import { describe, expect, it } from "vitest";

import {
  createWorldDocumentFromBlueprint,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import type { WorldDocument } from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { runBlueprintSimulation } from "@/simulation/blueprint-runner";
import { createSimulationHost } from "@/simulation/simulation-host";
import { STANDARD_TICK_RATE_PER_SECOND } from "@/simulation/tick-rate";
import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";
import {
  createBlueprint,
  createEntity,
  findSlot,
  getDevice,
  getTick,
} from "./blueprint-test-helpers";

describe("REQ-084: simulation power system", () => {
  it("runs powered recipes and exposes total power demand through topology and snapshots", async () => {
    const completionTick = 2 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const report = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("powered-grinder", 4),
      maxTickNumber: completionTick,
    });

    expect(report.topology.totalPowerDemand).toBe(5);
    expect(getTick(report, 0).totalPowerDemand).toBe(5);
    expect(getDevice(report, 1, "grinder")).toMatchObject({
      recipeId: "r_crusher_iron_powder_from_iron_nugget_basic",
      progressSeconds: 0,
      desiredSeconds: 2,
    });
    expect(findSlot(report, completionTick, "grinder", "item_output_buffer", "output_slot_1"))
      .toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
  });

  it("keeps out-of-range devices from starting new recipes", async () => {
    const completionTick = 2 * STANDARD_TICK_RATE_PER_SECOND + 1;
    const report = await runBlueprintSimulation({
      blueprint: createGrinderBlueprint("unpowered-grinder", 40),
      maxTickNumber: completionTick,
    });

    expect(report.topology.totalPowerDemand).toBe(0);
    expect(getTick(report, completionTick).totalPowerDemand).toBe(0);
    expect(getDevice(report, completionTick, "grinder")).toMatchObject({
      recipeId: null,
      progressSeconds: null,
      desiredSeconds: null,
    });
    expect(findSlot(report, completionTick, "grinder", "item_input_buffer", "input_slot_1"))
      .toMatchObject({
        itemType: "item_iron_nugget",
        count: 1,
      });
  });

  it("freezes running recipe progress while unpowered and resumes after topology migration restores power", async () => {
    const documentStore = createSnapshotStore(createWorldDocumentFromBlueprint(
      createGrinderBlueprint("migration-power-on", 4),
    ));
    const workspace = createHeadlessWorkspace(documentStore);
    const host = createSimulationHost(workspace, {
      workerMode: "runtime",
    });

    try {
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      await expectReady(host.internalActions.syncToTick(10));
      const poweredProgressSeconds = readGrinderProgressSeconds(host);

      documentStore.setSnapshot(createWorldDocumentFromBlueprint(
        createGrinderBlueprint("migration-power-off", 40),
      ));
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      expect(host.topology.getSnapshot()?.devices["device:grinder"]?.powerStatus)
        .toBe("out-of-power-range");
      expect(host.topology.getSnapshot()?.totalPowerDemand).toBe(0);

      await expectReady(host.internalActions.syncToTick(30));
      expect(readGrinderProgressSeconds(host)).toBe(poweredProgressSeconds);

      documentStore.setSnapshot(createWorldDocumentFromBlueprint(
        createGrinderBlueprint("migration-power-restored", 4),
      ));
      await expectStarted(host.internalActions.refreshFromCurrentDocument());
      expect(host.topology.getSnapshot()?.devices["device:grinder"]?.powerStatus)
        .toBe("in-power-range");
      expect(host.topology.getSnapshot()?.totalPowerDemand).toBe(5);

      await expectReady(host.internalActions.syncToTick(70));
      expect(readGrinderSlot(host, "item_output_buffer", "output_slot_1")).toMatchObject({
        itemType: "item_iron_powder",
        count: 1,
      });
    } finally {
      host.dispose();
    }
  });
});

function createGrinderBlueprint(
  name: string,
  powerX: number,
): BlueprintDocument {
  return createBlueprint(name, [
    createEntity("grinder", "item_port_grinder_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_iron_nugget",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    }),
    createEntity("power", "item_port_power_diffuser_1", powerX, 0),
  ]);
}

function createHeadlessWorkspace(
  documentSnapshot: SnapshotStoreReadWrite<WorldDocument>,
): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: {
      document: documentSnapshot,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
  };
}

async function expectStarted(
  promise: Promise<{ readonly status: "started" | "failed"; readonly error?: string }>,
): Promise<void> {
  const result = await promise;
  if (result.status !== "started") {
    throw new Error(result.error ?? "Expected simulation to start.");
  }
}

async function expectReady(
  promise: Promise<{ readonly status: string }>,
): Promise<void> {
  const result = await promise;
  if (result.status !== "ready") {
    throw new Error(`Expected tick to be ready, received ${result.status}.`);
  }
}

function readGrinderProgressSeconds(
  host: ReturnType<typeof createSimulationHost>,
): number {
  const progressSeconds = host.queries.getDeviceRuntimeStatus("grinder")?.progressSeconds;
  if (progressSeconds === null || progressSeconds === undefined) {
    throw new Error("Expected grinder recipe to be running.");
  }

  return progressSeconds;
}

function readGrinderSlot(
  host: ReturnType<typeof createSimulationHost>,
  storageGroupId: string,
  slotId: string,
) {
  const slot = host.queries.getDeviceRuntimeStatus("grinder")?.slotItems.find((candidate) =>
    candidate.storageGroupId === storageGroupId
    && candidate.slotId === slotId,
  );
  if (slot === undefined) {
    throw new Error(`Expected grinder slot ${storageGroupId}:${slotId}.`);
  }

  return slot;
}
