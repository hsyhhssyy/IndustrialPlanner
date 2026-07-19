import { describe, expect, it } from "vitest"

import { createWorldDocumentFromBlueprint } from "./blueprint-test-helpers"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import { createWorkspaceState } from "@/domain/document/workspace-state"
import { createRegistryContract } from "@/registry"
import { createSimulationHost } from "@/simulation/simulation-host"
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store"

import {
  createBlueprint,
  createEntity,
} from "./blueprint-test-helpers"

describe("Simulation pipe fluid query", () => {
  it("returns filled strict-pipe fluid while running or paused and hides after stop", async () => {
    const workspace = createWorkspace()
    const host = createSimulationHost(workspace, {
      workerMode: "runtime",
    })

    try {
      await host.actions.start()
      // AI-CORRECTION 2026-05-18: dedicated pipe 只在 10 标准 tick 相位接收液体。
      const tickStatus = await host.internalActions.syncToTick(10)

      expect(tickStatus.status).toBe("ready")
      expect(host.queries.getPipeFluidItemId("pipe")).toBe("item_liquid_water")
      expect(host.queries.getPipeFluidItemId("source-liquid-storage")).toBeNull()

      host.actions.pause()
      expect(host.queries.getPipeFluidItemId("pipe")).toBe("item_liquid_water")

      host.actions.stop()
      expect(host.queries.getPipeFluidItemId("pipe")).toBeNull()
    } finally {
      host.dispose()
    }
  })
})

function createWorkspace(): WorkspaceContract {
  const blueprint = createBlueprint("pipe-fluid-query", [
    createEntity("source-liquid-storage", "liquid_storager_1", 0, 0, 0, {
      "storageSlotGroups[0].slots[0].initialItemType": "item_liquid_water",
      "storageSlotGroups[0].slots[0].initialCount": 1,
    }),
    createEntity("pipe", "pipe_straight_1x1", 3, 1),
    createEntity("sink-liquid-storage", "liquid_storager_1", 4, 0),
  ])
  const document = createSnapshotStore(createWorldDocumentFromBlueprint(blueprint))

  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: {
      document,
      state: {} as never,
      queries: {} as never,
      actions: {} as never,
    },
    render: null,
    simulation: null,
  }
}
