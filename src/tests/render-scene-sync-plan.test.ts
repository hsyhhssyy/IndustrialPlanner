import { describe, expect, it } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { getRenderSceneSyncPlan } from "@/renderer/host/render-scene-sync-plan";
import { buildRenderScene as buildRenderSceneBase } from "@/renderer/scene/build-render-scene";
import type { RenderSceneInput } from "@/renderer/scene/types";
import { createInitialCanvasViewState } from "@/workspace/workspace-state";

function buildRenderScene(input: RenderSceneInput & { runtimeSnapshot?: unknown }) {
  const { runtimeSnapshot: _runtimeSnapshot, ...nextInput } = input;
  return buildRenderSceneBase(nextInput);
}

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
}

describe("render scene sync plan", () => {
  it("redraws only the preview layer when placement preview changes", () => {
    const scene = createBaseRenderScene();
    const previewScene = {
      ...scene,
      placementPreview: {
        definitionId: "belt_straight_1x1",
        interactionMode: "pointer" as const,
        label: "传送带",
        x: 24 * scene.gridSize,
        y: 12 * scene.gridSize,
        width: scene.gridSize,
        height: scene.gridSize,
        rotation: 0 as const,
        renderKind: "belt-track" as const,
        fill: "#544a72",
        textureSrc: null,
        textureWidth: 0,
        textureHeight: 0,
        textureCenterOffsetX: 0,
        textureCenterOffsetY: 0,
        valid: true,
      },
    };

    expect(getRenderSceneSyncPlan(scene, previewScene)).toEqual({
      redrawStaticLayers: false,
      redrawPreviewLayer: true,
    });
  });

  it("redraws only the preview layer when move preview changes in place", () => {
    const scene = createBaseRenderScene();
    const previewScene = {
      ...scene,
      movePreview: {
        entityId: "reactor-1",
        definitionId: "item_port_mix_pool_1",
        interactionMode: "pointer" as const,
        label: "反应池",
        x: 20 * scene.gridSize,
        y: 10 * scene.gridSize,
        width: 6 * scene.gridSize,
        height: 4 * scene.gridSize,
        rotation: 90 as const,
        renderKind: "sprite-device" as const,
        fill: "#6b503d",
        textureSrc: "/sprites/item_port_mix_pool_1.webp",
        textureWidth: 320,
        textureHeight: 256,
        textureCenterOffsetX: 0,
        textureCenterOffsetY: 0,
        valid: true,
      },
      movePreviews: [
        {
          entityId: "reactor-1",
          definitionId: "item_port_mix_pool_1",
          interactionMode: "pointer" as const,
          label: "反应池",
          x: 20 * scene.gridSize,
          y: 10 * scene.gridSize,
          width: 6 * scene.gridSize,
          height: 4 * scene.gridSize,
          rotation: 90 as const,
          renderKind: "sprite-device" as const,
          fill: "#6b503d",
          textureSrc: "/sprites/item_port_mix_pool_1.webp",
          textureWidth: 320,
          textureHeight: 256,
          textureCenterOffsetX: 0,
          textureCenterOffsetY: 0,
          valid: true,
        },
      ],
    };

    expect(getRenderSceneSyncPlan(scene, previewScene)).toEqual({
      redrawStaticLayers: false,
      redrawPreviewLayer: true,
    });
  });

  it("keeps static and preview layers intact when only the viewport offset changes", () => {
    const scene = createBaseRenderScene();
    const pannedScene = {
      ...scene,
      viewportOffset: {
        x: 64,
        y: 32,
      },
    };

    expect(getRenderSceneSyncPlan(scene, pannedScene)).toEqual({
      redrawStaticLayers: false,
      redrawPreviewLayer: false,
    });
  });

  it("requests a static redraw when rendered entity content changes", () => {
    const scene = createBaseRenderScene();
    const updatedScene = {
      ...scene,
      entities: scene.entities.map((entity) =>
        entity.entityId === "reactor-1"
          ? {
              ...entity,
              status: "running" as const,
            }
          : entity,
      ),
    };

    expect(getRenderSceneSyncPlan(scene, updatedScene)).toEqual({
      redrawStaticLayers: true,
      redrawPreviewLayer: true,
    });
  });
});
