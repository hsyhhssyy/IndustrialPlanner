import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorHost } from "@/editor/editor-host";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import {
  createWorldDocument,
  type WorldDocument,
  type WorldEntity,
} from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
  };
}

function createEntity(
  id: string,
  definitionId: string,
  x: number,
  y: number,
): WorldEntity {
  return {
    id,
    definitionId,
    position: { x, y },
    rotation: 0,
    config: {},
    tags: [],
  };
}

function createDocumentWithEntities(
  entities: readonly WorldEntity[],
): WorldDocument {
  return {
    ...createWorldDocument(),
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    entityOrder: entities.map((entity) => entity.id),
  };
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("invalid placement simulation compile", () => {
  it("treats invalid placement entities as absent when compiling topology", async () => {
    const workspace = createWorkspace();
    const editorHost = createEditorHost(workspace);
    const document = createDocumentWithEntities([
      createEntity("outside-belt", "belt_straight_1x1", -1, 0),
      createEntity("valid-pipe", "pipe_straight_1x1", 4, 0),
    ]);

    editorHost.internalDocument.setSnapshot(document);

    expect(
      editorHost.state.collections[EntityCollectionType.invalidPlacement],
    ).toEqual(["outside-belt"]);

    const simulationHost = createSimulationHost(workspace, {
      workerMode: "runtime",
    });

    try {
      const result = await simulationHost.internalActions.refreshFromCurrentDocument();
      const topology = simulationHost.topology.getSnapshot();

      expect(result.status).toBe("started");
      expect(topology?.devices["device:outside-belt"]).toBeUndefined();
      expect(topology?.devices["device:valid-pipe"]).toBeDefined();
    } finally {
      simulationHost.dispose();
    }
  });
});
