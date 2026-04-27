import { RenderContract } from "@/domain/contract/render-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";

import { Application } from "pixi.js";
import { resolveRenderResolutionFromApp } from "./render-resolution";
import {
  createRenderSceneOrchestrator,
  type RenderSceneOrchestrator,
} from "./scene/render-scene-orchestrator";
import {
  createRenderTextureManager,
  type RenderTextureManager,
} from "./texture/texture-manager";

export interface RenderHost extends RenderContract {
  workspace: WorkspaceContract;
  app: Application;
  textureManager: RenderTextureManager;
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
  const textureManager = createRenderTextureManager({
    renderer: app.renderer,
    app: workspace.app,
    initialResolution: renderResolution,
  });
  let orchestrator: RenderSceneOrchestrator | null = null;

  const host: RenderHost = {
    workspace,
    app,
    textureManager,
    canvas: app.canvas,
    queries: {},
    actions: {},
    destroy: () => {
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
