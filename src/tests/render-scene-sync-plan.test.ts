import { describe, expect, it } from "vitest";
import { compileStage1World } from "@/domain/compiler/stage1-compiler";
import { createStage1SeedWorldDocument } from "@/domain/document/stage1-seed-world-document";
import { createStage1Registry } from "@/domain/registry/stage1-registry";
import { getRenderSceneSyncPlan } from "@/renderer/host/render-scene-sync-plan";
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
      selectedEntityIds: [],
      placementPreview: null,
      movePreview: null,
      dragPreviewEntityId: null,
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
