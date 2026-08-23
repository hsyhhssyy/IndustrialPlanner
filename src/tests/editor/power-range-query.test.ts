// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorldDocument, type WorldEntity } from "@/domain/document/world-document";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";

describe("EditorQuery.listPowerRangeProvidersCoveringGridRect", () => {
  let editorHost: ReturnType<typeof createEditorHost> | null = null;

  afterEach(() => {
    editorHost?.dispose();
    editorHost = null;
    localStorage.clear();
  });

  it("returns every power pole whose range intersects the queried footprint", () => {
    const workspace = createWorkspace();
    editorHost = createEditorHost(workspace);
    const entities = [
      createEntity("power-a", "power_diffuser_1", 0, 0),
      createEntity("power-b", "power_diffuser_1", 8, 0),
      createEntity("power-outside", "power_diffuser_1", 24, 0),
      createEntity("storage", "storager_1", 5, 0),
    ];
    const document = createWorldDocument();
    document.entities = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
    document.entityOrder = entities.map((entity) => entity.id);
    editorHost.internalDocument.setSnapshot(document);

    expect(editorHost.queries.listPowerRangeProvidersCoveringGridRect({
      x: 5,
      y: 0,
      width: 3,
      height: 3,
    }).map((entity) => entity.id)).toEqual(["power-a", "power-b"]);
  });
});

function createWorkspace(): WorkspaceContract {
  return {
    state: createWorkspaceState(),
    registry: createRegistryContract(),
    app: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
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
