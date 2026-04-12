import { describe, expect, it } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import {
  createStage1Registry,
  getStage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import type { EditorSession } from "@/editor/contracts/editor-session";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import { createEditorHost } from "@/editor/host/editor-host";

describe("EditorHost merged entity lookup", () => {
  it("resolves world and draft entities from the shared lookup surface", () => {
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);
    const session: EditorSession = {
      ...createInitialEditorSession(),
      drafts: {
        entities: {
          "draft:manual-preview": {
            id: "draft:manual-preview",
            definitionId: "belt_straight_1x1",
            position: { x: 12, y: 6 },
            rotation: 0,
            config: {},
            tags: [],
            sourceEntityId: null,
            valid: true,
            invalidReason: null,
          },
        },
      },
    };
    const host = createEditorHost({
      document,
      session,
      getTopology: () => topology,
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });

    expect(host.getEntityById("reactor-1")).toMatchObject({
      kind: "world",
      entity: {
        id: "reactor-1",
      },
    });
    expect(host.getEntityById("draft:manual-preview")).toMatchObject({
      kind: "draft",
      entity: {
        id: "draft:manual-preview",
        definitionId: "belt_straight_1x1",
      },
    });
    expect(host.getEntityById("missing")).toBeNull();
  });
});