import { describe, expect, it } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import {
  createStage1Registry,
  getStage1EntityDefinition,
} from "@/domain/registry/stage1-registry";
import type { EditorCore } from "@/editor/core/editor-core";
import type { EditorSession } from "@/editor/contracts/editor-session";
import {
  createMoveDraftId,
  getManagedMoveDraft,
} from "@/editor/contracts/editor-session-helpers";
import {
  createMoveInteractionMode,
  createPlacementInteractionMode,
} from "@/editor/contracts/interaction-mode";
import type { MoveDraftState } from "@/editor/contracts/move-draft";
import { createInitialEditorSession } from "@/editor/core/editor-session";
import { createEditorHost } from "@/editor/host/editor-host";

function createSelectionCollection(ids: string[]) {
  return {
    ids,
    boundsDerived: null,
    geometricCenterCellsDerived: null,
  };
}

function applyManagedMoveDraft(
  session: EditorSession,
  document: ReturnType<typeof createStage1SeedWorldDocument>,
  draft: MoveDraftState | null,
): EditorSession {
  if (!draft) {
    return {
      ...session,
      draftEntities: null,
      drafts: {
        entities: {},
      },
    };
  }

  return {
    ...session,
    currentMode: createMoveInteractionMode({
      entityId: draft.entityId,
      inputMode: draft.interactionMode,
      anchorWorldOffset: draft.anchorWorldOffset,
      previousModeKey: "select",
      entryDisplayTool: "select",
    }),
    selectedEntities: createSelectionCollection(
      draft.entities.map((entity) => entity.entityId),
    ),
    drafts: {
      entities: Object.fromEntries(
        draft.entities.map((entity) => {
          const sourceEntity = document.entities[entity.entityId]!;
          return [
            createMoveDraftId(entity.entityId),
            {
              ...sourceEntity,
              id: createMoveDraftId(entity.entityId),
              position: entity.gridPoint,
              rotation: entity.rotation,
              config: { ...sourceEntity.config },
              tags: [...sourceEntity.tags],
              sourceEntityId: entity.entityId,
              valid: draft.valid,
              invalidReason: draft.valid ? null : "move-draft-invalid",
            },
          ];
        }),
      ),
    },
    draftEntities: createSelectionCollection(
      draft.entities.map((entity) => createMoveDraftId(entity.entityId)),
    ),
  };
}

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
        ...applyManagedMoveDraft(createInitialEditorSession(), document, {
          entityId: "reactor-1",
          interactionMode: "pointer",
          originGridPoint: { x: 12, y: 6 },
          gridPoint: { x: 12, y: 6 },
          rotation: 90,
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
              rotation: 90,
            },
          ],
        }),
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
      setMoveDraft: (draft: MoveDraftState | null) => {
        snapshot = {
          ...snapshot,
          session: {
            ...applyManagedMoveDraft(snapshot.session, document, draft),
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
    expect(getManagedMoveDraft(snapshot.session, snapshot.document)).toMatchObject({
      entityId: "reactor-1",
      rotation: 180,
      valid: true,
    });
    expect(getManagedMoveDraft(snapshot.session, snapshot.document)?.gridPoint).not.toEqual({ x: 12, y: 6 });
    expect(getManagedMoveDraft(snapshot.session, snapshot.document)?.entities).toMatchObject([
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
        ...applyManagedMoveDraft(createInitialEditorSession(), document, {
          entityId: "reactor-1",
          interactionMode: "pointer",
          originGridPoint: { x: 12, y: 6 },
          gridPoint: { x: 20, y: 10 },
          rotation: 90,
          valid: true,
          rotationCenterCells: { x: 22, y: 12 },
          anchorWorldOffset: { x: 0, y: 0 },
          entities: [
            {
              entityId: "reactor-1",
              originGridPoint: { x: 12, y: 6 },
              gridPoint: { x: 20, y: 10 },
              centerCells: { x: 22, y: 12 },
              originRotation: 0,
              rotation: 90,
            },
          ],
        }),
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
        draft: MoveDraftState,
      ) => {
        snapshot = {
          ...snapshot,
          session: {
            ...applyManagedMoveDraft(snapshot.session, document, {
              ...draft,
              entityId: nextEntityId,
              interactionMode: nextInputMode,
            }),
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
    expect(getManagedMoveDraft(snapshot.session, snapshot.document)).toMatchObject({
      entityId: "reactor-1",
      gridPoint: { x: 20, y: 10 },
      rotation: 90,
      anchorWorldOffset: { x: 0, y: 0 },
    });
  });

  it("treats managed placement drafts as the active preview during update", () => {
    const registry = createStage1Registry();
    const document = createStage1SeedWorldDocument();
    const topology = compileStage1World(document, registry);
    let setPlacementPreviewCalls = 0;
    const snapshot: {
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
        currentMode: createPlacementInteractionMode({
          definitionId: "belt_straight_1x1",
          displayTool: "belt",
          inputMode: "pointer",
          rotation: 0,
          previousModeKey: "select",
          entryDisplayTool: "belt",
        }),
        drafts: {
          entities: {
            "draft:placement-preview": {
              id: "draft:placement-preview",
              definitionId: "belt_straight_1x1",
              position: { x: 8, y: 3 },
              rotation: 0,
              config: {},
              tags: [],
              sourceEntityId: null,
              valid: true,
              invalidReason: null,
            },
          },
        },
        draftEntities: {
          ids: ["draft:placement-preview"],
          boundsDerived: null,
          geometricCenterCellsDerived: null,
        },
      },
      history: {
        canUndo: false,
        canRedo: false,
        undoDepth: 0,
        redoDepth: 0,
      },
    };
    const core = {
      getSnapshot: () => snapshot,
      setPlacementPreview: () => {
        setPlacementPreviewCalls += 1;
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

    const result = host.updatePlacementPreview({
      worldPoint: {
        x: 8.5 * document.documentSettings.gridSize,
        y: 3.5 * document.documentSettings.gridSize,
      },
      gridPoint: { x: 8, y: 3 },
    });

    expect(result.changed).toBe(false);
    expect(result.preview).toMatchObject({
      definitionId: "belt_straight_1x1",
      gridPoint: { x: 8, y: 3 },
      rotation: 0,
      valid: true,
    });
    expect(setPlacementPreviewCalls).toBe(0);
  });
});