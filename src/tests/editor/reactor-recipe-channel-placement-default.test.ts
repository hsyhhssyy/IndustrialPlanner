import { describe, expect, it } from "vitest";

import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createEditorHost } from "@/editor/editor-host";
import { createRegistryContract } from "@/registry";
import { RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY } from "@/shared/recipe-channel-behavior";

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

describe("反应池放置默认值", () => {
  it.each(["mix_pool_1", "mix_pool_2"])(
    "newly placed %s starts in automatic Recipe Channel mode",
    (definitionId) => {
      const editor = createEditorHost(createWorkspace());

      editor.actions.createSinglePlacementDraft(definitionId, { x: 10, y: 10 });

      const draft = editor.internalState.drafts.find(
        (candidate) => candidate.definitionId === definitionId,
      );
      expect(draft?.config).toMatchObject({
        [RECIPE_CHANNEL_AUTOMATIC_MODE_CONFIG_KEY]: true,
      });
    },
  );
});
