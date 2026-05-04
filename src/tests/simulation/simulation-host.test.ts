import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkspaceContract } from "@/domain/contract/workspace-contract"
import type { WorldDocument } from "@/domain/entity/world-document"
import { createWorkspaceState } from "@/domain/state/workspace-state"
import { createDummyWorldDocument } from "@/editor/dummy-document"
import { createRegistryContract } from "@/registry"
import { createSnapshotStore } from "@/shared/snapshot/snapshot-store"
import { createSimulationHost } from "@/simulation/simulation-host"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createSimulationHost", () => {
  it("exposes the compiled topology through the public contract", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    expect(host.topology.getSnapshot()).toBeNull()

    const result = await host.actions.start()
    const topology = host.topology.getSnapshot()

    expect(result.status).toBe("started")
    expect(topology).not.toBeNull()
    expect(topology?.topologyId).toBe(result.topologyId)
    expect(workspace.simulation).toBe(host)

    host.dispose()
  })

  it("refreshes the exposed topology after document recompilation", async () => {
    vi.stubGlobal("Worker", undefined)

    const { workspace, document } = createWorkspace(createDummyWorldDocument())
    const host = createSimulationHost(workspace)

    await host.actions.start()
    const firstTopology = host.topology.getSnapshot()

    expect(firstTopology).not.toBeNull()

    document.setSnapshot(createMovedDummyDocument())
    await flushMicrotasks(8)

    const secondTopology = host.topology.getSnapshot()

    expect(secondTopology).not.toBeNull()
    expect(secondTopology?.topologyId).not.toBe(firstTopology?.topologyId)
    expect(secondTopology?.documentHash).not.toBe(firstTopology?.documentHash)

    host.dispose()
  })
})

function createWorkspace(documentSnapshot: WorldDocument): {
  workspace: WorkspaceContract;
  document: ReturnType<typeof createSnapshotStore<WorldDocument>>;
} {
  const document = createSnapshotStore(documentSnapshot)
  const workspace: WorkspaceContract = {
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

  return {
    workspace,
    document,
  }
}

function createMovedDummyDocument(): WorldDocument {
  const document = createDummyWorldDocument()
  const entity = document.entities["dummy-entity-1"]

  if (entity === undefined) {
    throw new Error("Expected dummy belt entity to exist.")
  }

  document.entities[entity.id] = {
    ...entity,
    position: {
      x: entity.position.x + 1,
      y: entity.position.y,
    },
  }

  return document
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve()
  }
}