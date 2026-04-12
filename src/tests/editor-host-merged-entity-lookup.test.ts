import { describe, expect, it } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import {
  createStage1Registry,
  getStage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import type { EditorCore } from "@/editor/core/editor-core";
import type { EditorSession } from "@/editor/contracts/editor-session";
import { createMoveInteractionMode } from "@/editor/contracts/interaction-mode";
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

  it("prefers managed draft entities when rotating move drafts", () => {
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);
    let snapshot: {
      document: typeof document;
      session: EditorSession;
      history: {
        canUndo: boolean;
        canRedo: boolean;
        undoDepth: number;
        redoDepth: number;
      };
    } = {
      document,
      session: {
        ...createInitialEditorSession(),
        currentMode: createMoveInteractionMode({
          entityId: "reactor-1",
          inputMode: "pointer",
          previousModeKey: "select",
          entryDisplayTool: "select",
        }),
        selection: ["reactor-1"],
        moveDraft: {
          entityId: "reactor-1",
          interactionMode: "pointer",
          originGridPoint: { x: 12, y: 6 },
          gridPoint: { x: 12, y: 6 },
          rotation: 0,
          valid: true,
          rotationCenterCells: { x: 14, y: 8 },
          anchorWorldOffset: { x: 0, y: 0 },
          entities: [
            {
              entityId: "reactor-1",
              originGridPoint: { x: 12, y: 6 },
              gridPoint: { x: 12, y: 6 },
              centerCells: { x: 14, y: 8 },
              originRotation: 0,
              rotation: 0,
            },
          ],
        },
        drafts: {
          entities: {
            "draft:move:reactor-1": {
              id: "draft:move:reactor-1",
              definitionId: document.entities["reactor-1"]!.definitionId,
              position: { x: 20, y: 10 },
              rotation: 90,
              config: { ...document.entities["reactor-1"]!.config },
              tags: [...document.entities["reactor-1"]!.tags],
              sourceEntityId: "reactor-1",
              valid: true,
              invalidReason: null,
            },
          },
        },
        draftEntities: {
          ids: ["draft:move:reactor-1"],
          boundsDerived: null,
          geometricCenterCellsDerived: null,
        },
      } satisfies EditorSession,
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    };
    const core = {
      getSnapshot: () => snapshot,
      setMoveDraft: (draft: EditorSession["moveDraft"]) => {
        snapshot = {
          ...snapshot,
          session: {
            ...snapshot.session,
            moveDraft: draft,
          },
        };
      },
    } as unknown as EditorCore;
    const host = createEditorHost({
      document,
      session: snapshot.session,
      core,
      getTopology: () => topology,
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });

    expect(host.rotateMoveClockwise()).toBe(true);
    expect(snapshot.session.moveDraft).toMatchObject({
      entityId: "reactor-1",
      rotation: 180,
      valid: true,
    });
    expect(snapshot.session.moveDraft?.gridPoint).not.toEqual({ x: 12, y: 6 });
    expect(snapshot.session.moveDraft?.entities).toMatchObject([
      {
        entityId: "reactor-1",
        rotation: 180,
      },
    ]);
  });

  it("reanchors an existing move draft from managed draft entities", () => {
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);
    let snapshot: {
      document: typeof document;
      session: EditorSession;
      history: {
        canUndo: boolean;
        canRedo: boolean;
        undoDepth: number;
        redoDepth: number;
      };
    } = {
      document,
      session: {
        ...createInitialEditorSession(),
        currentMode: createMoveInteractionMode({
          entityId: "reactor-1",
          inputMode: "pointer",
          previousModeKey: "select",
          entryDisplayTool: "select",
        }),
        selection: ["reactor-1"],
        moveDraft: {
          entityId: "reactor-1",
          interactionMode: "pointer",
          originGridPoint: { x: 12, y: 6 },
          gridPoint: { x: 12, y: 6 },
          rotation: 0,
          valid: true,
          rotationCenterCells: { x: 14, y: 8 },
          anchorWorldOffset: { x: 0, y: 0 },
          entities: [
            {
              entityId: "reactor-1",
              originGridPoint: { x: 12, y: 6 },
              gridPoint: { x: 12, y: 6 },
              centerCells: { x: 14, y: 8 },
              originRotation: 0,
              rotation: 0,
            },
          ],
        },
        drafts: {
          entities: {
            "draft:move:reactor-1": {
              id: "draft:move:reactor-1",
              definitionId: document.entities["reactor-1"]!.definitionId,
              position: { x: 20, y: 10 },
              rotation: 90,
              config: { ...document.entities["reactor-1"]!.config },
              tags: [...document.entities["reactor-1"]!.tags],
              sourceEntityId: "reactor-1",
              valid: true,
              invalidReason: null,
            },
          },
        },
        draftEntities: {
          ids: ["draft:move:reactor-1"],
          boundsDerived: null,
          geometricCenterCellsDerived: null,
        },
      } satisfies EditorSession,
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    };
    const core = {
      getSnapshot: () => snapshot,
      beginMove: (
        nextEntityId: string,
        nextInputMode: "pointer" | "touch",
        draft: NonNullable<EditorSession["moveDraft"]>,
      ) => {
        snapshot = {
          ...snapshot,
          session: {
            ...snapshot.session,
            currentMode: createMoveInteractionMode({
              entityId: nextEntityId,
              inputMode: nextInputMode,
              previousModeKey: "select",
              entryDisplayTool: "select",
            }),
            moveDraft: draft,
          },
        };
      },
    } as unknown as EditorCore;
    const host = createEditorHost({
      document,
      session: snapshot.session,
      core,
      getTopology: () => topology,
      getDefinition: (definitionId) =>
        getStage1EntityDefinition(registry, definitionId),
    });

    expect(
      host.beginMove("reactor-1", "pointer", {
        worldPoint: { x: 20 * document.documentSettings.gridSize, y: 10 * document.documentSettings.gridSize },
        gridPoint: { x: 20, y: 10 },
      }),
    ).toBe(true);
    expect(snapshot.session.moveDraft).toMatchObject({
      entityId: "reactor-1",
      gridPoint: { x: 20, y: 10 },
      rotation: 90,
      anchorWorldOffset: { x: 0, y: 0 },
    });
  });
});