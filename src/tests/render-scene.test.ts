import { describe, expect, it } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { applyWorldDocumentCommand } from "@/editor/core/commands/document-command-applier";
import type { DocumentCommand } from "@/editor/core/commands/document-command";
import { buildRenderScene } from "@/renderer/scene/build-render-scene";
import { createInitialCanvasViewState } from "@/workbench/workspace-state";

function createBaseRenderScene() {
  const document = createStage1SeedWorldDocument();
  const registry = createStage1Registry();
  const topology = compileStage1World(document, registry);

  return buildRenderScene({
    locale: "zh-CN",
    document,
    topology,
    registry,
    canvasView: createInitialCanvasViewState(),
    interaction: {
      selectedEntityIds: ["reactor-1"],
      placementPreview: null,
      moveDraft: null,
      pendingLinkSourceEntityId: null,
    },
    runtimeSnapshot: {
      tick: 0,
      status: "idle",
      entityViews: {},
      patchedEntityIds: [],
    },
  });
}

describe("Render scene model", () => {
  it("builds sprite metadata for Stage1 machine devices", () => {
    const scene = createBaseRenderScene();
    const reactor = scene.entities.find((entity) => entity.entityId === "reactor-1");

    expect(reactor?.renderKind).toBe("sprite-device");
    expect(reactor?.textureSrc).toBe("/sprites/item_port_mix_pool_1.webp");
    expect(reactor?.label).toBe("反应池");
    expect(reactor?.showLabel).toBe(true);
    expect(reactor?.selected).toBe(true);
    expect("subtitle" in (reactor ?? {})).toBe(false);
    expect("progress" in (reactor ?? {})).toBe(false);
  });

  it("uses localized device labels for the active locale", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const scene = buildRenderScene({
      locale: "en-US",
      document,
      topology,
      registry,
      canvasView: createInitialCanvasViewState(),
      interaction: {
        selectedEntityIds: [],
        placementPreview: null,
        moveDraft: null,
        pendingLinkSourceEntityId: null,
      },
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
    });

    const reactor = scene.entities.find((entity) => entity.entityId === "reactor-1");

    expect(reactor?.label).toBe("Reactor Pool");
  });

  it("keeps straight belt and pipe segments on geometry-based track rendering", () => {
    const seedDocument = createStage1SeedWorldDocument();
    const withTracks = applyWorldDocumentCommand(
      applyWorldDocumentCommand(
        seedDocument,
        {
          type: "entity.place",
          payload: {
            entityId: "test-belt-1",
            definitionId: "belt_straight_1x1",
            position: { x: 24, y: 8 },
            rotation: 0,
            config: {},
            tags: ["test"],
          },
        } satisfies DocumentCommand,
      ),
      {
        type: "entity.place",
        payload: {
          entityId: "test-pipe-1",
          definitionId: "pipe_straight_1x1",
          position: { x: 24, y: 10 },
          rotation: 90,
          config: {},
          tags: ["test"],
        },
      } satisfies DocumentCommand,
    );
    const registry = createStage1Registry();
    const topology = compileStage1World(withTracks, registry);
    const scene = buildRenderScene({
      locale: "zh-CN",
      document: withTracks,
      topology,
      registry,
      canvasView: createInitialCanvasViewState(),
      interaction: {
        selectedEntityIds: [],
        placementPreview: null,
        moveDraft: null,
        pendingLinkSourceEntityId: null,
      },
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
    });

    const belt = scene.entities.find((entity) => entity.entityId === "test-belt-1");
    const pipe = scene.entities.find((entity) => entity.entityId === "test-pipe-1");

    expect(belt?.renderKind).toBe("belt-track");
    expect(belt?.textureSrc).toBeNull();
    expect(belt?.showLabel).toBe(false);
    expect(pipe?.renderKind).toBe("pipe-track");
    expect(pipe?.textureSrc).toBeNull();
    expect(pipe?.showLabel).toBe(false);
  });

  it("builds a placement preview with sprite metadata and validity state", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const definition = registry.entityDefinitions.find(
      (entityDefinition) => entityDefinition.id === "item_port_mix_pool_1",
    );
    const scene = buildRenderScene({
      locale: "zh-CN",
      document,
      topology,
      registry,
      canvasView: createInitialCanvasViewState(),
      interaction: {
        selectedEntityIds: [],
        placementPreview: {
          definitionId: "item_port_mix_pool_1",
          interactionMode: "pointer",
          gridPoint: { x: 24, y: 12 },
          rotation: 0,
          valid: true,
        },
        moveDraft: null,
        pendingLinkSourceEntityId: null,
      },
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
    });

    expect(definition).toBeTruthy();
    expect(scene.placementPreview).toMatchObject({
      definitionId: "item_port_mix_pool_1",
      interactionMode: "pointer",
      x: 24 * document.documentSettings.gridSize,
      y: 12 * document.documentSettings.gridSize,
      width:
        (definition?.footprint.width ?? 0) * document.documentSettings.gridSize,
      height:
        (definition?.footprint.height ?? 0) * document.documentSettings.gridSize,
      valid: true,
      textureSrc: "/sprites/item_port_mix_pool_1.webp",
    });
  });

  it("swaps non-square placement preview bounds when rotated", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const scene = buildRenderScene({
      locale: "zh-CN",
      document,
      topology,
      registry,
      canvasView: createInitialCanvasViewState(),
      interaction: {
        selectedEntityIds: [],
        placementPreview: {
          definitionId: "item_port_unloader_1",
          interactionMode: "touch",
          gridPoint: { x: 24, y: 12 },
          rotation: 90,
          valid: true,
        },
        moveDraft: null,
        pendingLinkSourceEntityId: null,
      },
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
    });

    expect(scene.placementPreview).toMatchObject({
      definitionId: "item_port_unloader_1",
      interactionMode: "touch",
      width: document.documentSettings.gridSize,
      height: document.documentSettings.gridSize * 3,
      rotation: 90,
    });
  });

  it("ghosts the source entity and builds a move preview from move draft state", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const sourceEntity = document.entities["reactor-1"];

    expect(sourceEntity).toBeTruthy();

    const scene = buildRenderScene({
      locale: "zh-CN",
      document,
      topology,
      registry,
      canvasView: createInitialCanvasViewState(),
      interaction: {
        selectedEntityIds: ["reactor-1"],
        placementPreview: null,
        moveDraft: {
          entityId: "reactor-1",
          interactionMode: "touch",
          originGridPoint: sourceEntity!.position,
          gridPoint: { x: 20, y: 10 },
          rotation: sourceEntity!.rotation,
          valid: true,
          anchorWorldOffset: { x: 8, y: 8 },
          entities: [
            {
              entityId: "reactor-1",
              originGridPoint: sourceEntity!.position,
              gridPoint: { x: 20, y: 10 },
              originRotation: sourceEntity!.rotation,
              rotation: sourceEntity!.rotation,
            },
          ],
        },
        pendingLinkSourceEntityId: null,
      },
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
    });

    expect(
      scene.entities.find((entity) => entity.entityId === "reactor-1"),
    ).toMatchObject({
      selected: true,
      ghosted: true,
      x: sourceEntity!.position.x * document.documentSettings.gridSize,
      y: sourceEntity!.position.y * document.documentSettings.gridSize,
    });
    expect(scene.movePreview).toMatchObject({
      entityId: "reactor-1",
      definitionId: sourceEntity!.definitionId,
      interactionMode: "touch",
      x: 20 * document.documentSettings.gridSize,
      y: 10 * document.documentSettings.gridSize,
      valid: true,
    });
    expect(scene.movePreviews).toHaveLength(1);
  });

  it("uses move draft rotation when building non-square move previews", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const sourceEntity = document.entities["filler-1"];

    expect(sourceEntity).toBeTruthy();

    const scene = buildRenderScene({
      locale: "zh-CN",
      document,
      topology,
      registry,
      canvasView: createInitialCanvasViewState(),
      interaction: {
        selectedEntityIds: ["filler-1"],
        placementPreview: null,
        moveDraft: {
          entityId: "filler-1",
          interactionMode: "touch",
          originGridPoint: sourceEntity!.position,
          gridPoint: { x: 19, y: 11 },
          rotation: 180,
          valid: true,
          anchorWorldOffset: { x: 8, y: 8 },
          entities: [
            {
              entityId: "filler-1",
              originGridPoint: sourceEntity!.position,
              gridPoint: { x: 19, y: 11 },
              originRotation: sourceEntity!.rotation,
              rotation: 180,
            },
          ],
        },
        pendingLinkSourceEntityId: null,
      },
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
    });

    expect(scene.movePreview).toMatchObject({
      entityId: "filler-1",
      definitionId: sourceEntity!.definitionId,
      interactionMode: "touch",
      rotation: 180,
      width: document.documentSettings.gridSize * 6,
      height: document.documentSettings.gridSize * 4,
      x: 19 * document.documentSettings.gridSize,
      y: 11 * document.documentSettings.gridSize,
      valid: true,
    });
  });

  it("builds one move preview per selected entity while ghosting the whole moving group", () => {
    const document = createStage1SeedWorldDocument();
    const registry = createStage1Registry();
    const topology = compileStage1World(document, registry);
    const reactor = document.entities["reactor-1"];
    const filler = document.entities["filler-1"];

    expect(reactor).toBeTruthy();
    expect(filler).toBeTruthy();

    const scene = buildRenderScene({
      locale: "zh-CN",
      document,
      topology,
      registry,
      canvasView: createInitialCanvasViewState(),
      interaction: {
        selectedEntityIds: ["reactor-1", "filler-1"],
        placementPreview: null,
        moveDraft: {
          entityId: "reactor-1",
          interactionMode: "pointer",
          originGridPoint: reactor!.position,
          gridPoint: { x: 20, y: 10 },
          rotation: reactor!.rotation,
          valid: true,
          anchorWorldOffset: { x: 8, y: 8 },
          entities: [
            {
              entityId: "reactor-1",
              originGridPoint: reactor!.position,
              gridPoint: { x: 20, y: 10 },
              originRotation: reactor!.rotation,
              rotation: reactor!.rotation,
            },
            {
              entityId: "filler-1",
              originGridPoint: filler!.position,
              gridPoint: { x: filler!.position.x + 2, y: filler!.position.y + 1 },
              originRotation: filler!.rotation,
              rotation: filler!.rotation,
            },
          ],
        },
        pendingLinkSourceEntityId: null,
      },
      runtimeSnapshot: {
        tick: 0,
        status: "idle",
        entityViews: {},
        patchedEntityIds: [],
      },
    });

    expect(scene.movePreviews).toHaveLength(2);
    expect(
      scene.entities.filter((entity) => entity.ghosted).map((entity) => entity.entityId),
    ).toEqual(["reactor-1", "filler-1"]);
  });
});
