import { RenderContract } from "@/domain/contract/render-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";

import { Application } from "pixi.js";
import { resolveRenderResolutionFromApp } from "./render-resolution";
import { createRenderSceneOrchestrator } from "./scene/render-scene-orchestrator";
import { createRenderStateReadWrite, type RenderStateReadWrite } from "./state-impl";
import { createCustomTexture, CustomTextureKey } from "./texture/create-custom-texture";

export interface RenderHost extends RenderContract {
  workspace: WorkspaceContract;
  app: Application;
  internalState: RenderStateReadWrite;
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
  const internalState = createRenderStateReadWrite({
    resolution: renderResolution,
  });

  internalState.customTextures[CustomTextureKey.whiteScanLines] = createCustomTexture({
    key: CustomTextureKey.whiteScanLines,
    renderer: app.renderer,
    textureConfig: internalState.textureConfig,
  });

  const host: RenderHost = {
    workspace,
    app,
    internalState,
    canvas: app.canvas,
    queries: {},
    actions: {},
  };

  createRenderSceneOrchestrator(host);

  workspace.render = host;

  return host;
}
