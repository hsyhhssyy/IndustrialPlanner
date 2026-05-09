import { RenderContract } from "@/domain/renderer/render-contract";
import { WorkspaceContract } from "@/domain/document/workspace-contract";

import { Application } from "pixi.js";
import { createBlueprintPreviewManager } from "./blueprint-preview/blueprint-preview-manager";
import { resolveRenderResolutionFromApp } from "./render-resolution";
import {
  createRenderSceneOrchestrator,
  type RenderSceneOrchestrator,
} from "./scene/render-scene-orchestrator";
import {
  createTextureActions,
} from "./texture/texture-manager";

export interface RenderHost extends RenderContract {
  workspace: WorkspaceContract;
  app: Application;
  textureManager: ReturnType<typeof createTextureActions>;
  internalState: {
    textureConfig: unknown | null;
  };
}

interface RoundPixelsStageLike {
  roundPixels: boolean;
}

const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}


export async function createRenderHost(
  workspace: WorkspaceContract
): Promise<RenderHost> {
  const editor = workspace.editor;
  if (editor === null) {
    throw new Error("Editor host must be initialized before render host.");
  }

  const app = new Application();
  const { clientRect } = editor.state.viewport;
  const renderResolution = resolveRenderResolutionFromApp(workspace.app);

  await app.init({
    width: resolveViewportAxisSize(clientRect.width, DEFAULT_VIEWPORT_WIDTH),
    height: resolveViewportAxisSize(clientRect.height, DEFAULT_VIEWPORT_HEIGHT),
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: renderResolution,
    preference: "webgl",
  });

  (app.stage as unknown as RoundPixelsStageLike).roundPixels = true;
  const internalState: RenderHost["internalState"] = {
    textureConfig: null,
  };
  const blueprintPreviewManager = createBlueprintPreviewManager({
    workspace,
  });
  const textureManager = createTextureActions({
    renderer: app.renderer,
    app: workspace.app,
    syncTextureConfigState: (textureConfig) => {
      internalState.textureConfig = textureConfig;
    },
  });
  let orchestrator: RenderSceneOrchestrator | null = null;

  const host: RenderHost = {
    workspace,
    app,
    textureManager,
    internalState,
    canvas: app.canvas,
    queries: blueprintPreviewManager.queries,
    actions: blueprintPreviewManager.actions,
    destroy: () => {
      blueprintPreviewManager.destroy();
      orchestrator?.destroy();
      orchestrator = null;
      textureManager.destroy();
      app.destroy();
    },
  };

  orchestrator = createRenderSceneOrchestrator(host);

  workspace.render = host;

  return host;
}
