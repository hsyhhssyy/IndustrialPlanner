import type { RenderAction, RenderContract } from "@/domain/renderer";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

import { Application } from "pixi.js";
import { createBlueprintPreviewManager } from "./blueprint-preview/blueprint-preview-manager";
import { resolveRenderResolutionFromApp } from "./render-resolution";
import { resolveMainRendererAntialias } from "./pixi-render-diagnostics";
import {
  createRenderSceneOrchestrator,
  type RenderSceneOrchestrator,
} from "./scene/render-scene-orchestrator";
import {
  createTextureActions,
} from "./texture/texture-manager";
import "./renderer-host.css";

interface RenderHostDomElements {
  placementGlowOverlay: HTMLDivElement;
  blueprintGlowOverlay: HTMLDivElement;
  marqueeGlowOverlay: HTMLDivElement;
}

export interface RenderHost extends RenderContract {
  workspace: WorkspaceContract;
  app: Application;
  dom: RenderHostDomElements;
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

function createRendererContainer(app: Application): {
  container: HTMLDivElement;
  dom: RenderHostDomElements;
} {
  const container = document.createElement("div");
  container.className = "industrial-planner-renderer";

  app.canvas.classList.add("industrial-planner-renderer__canvas");

  const placementGlowOverlay = document.createElement("div");
  placementGlowOverlay.className = [
    "industrial-planner-renderer__glow-overlay",
    "industrial-planner-renderer__placement-glow",
  ].join(" ");

  const blueprintGlowOverlay = document.createElement("div");
  blueprintGlowOverlay.className = [
    "industrial-planner-renderer__glow-overlay",
    "industrial-planner-renderer__blueprint-glow",
  ].join(" ");

  const marqueeGlowOverlay = document.createElement("div");
  marqueeGlowOverlay.className = [
    "industrial-planner-renderer__glow-overlay",
    "industrial-planner-renderer__marquee-glow",
  ].join(" ");

  container.append(app.canvas, placementGlowOverlay, blueprintGlowOverlay, marqueeGlowOverlay);

  return {
    container,
    dom: {
      placementGlowOverlay,
      blueprintGlowOverlay,
      marqueeGlowOverlay,
    },
  };
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
  const renderAntialias = resolveMainRendererAntialias(
    workspace.app?.state.settings?.debugMode === true,
  );

  await app.init({
    width: resolveViewportAxisSize(clientRect.width, DEFAULT_VIEWPORT_WIDTH),
    height: resolveViewportAxisSize(clientRect.height, DEFAULT_VIEWPORT_HEIGHT),
    backgroundAlpha: 0,
    antialias: renderAntialias,
    autoDensity: true,
    resolution: renderResolution,
    preference: "webgl",
  });

  (app.stage as unknown as RoundPixelsStageLike).roundPixels = true;
  const internalState: RenderHost["internalState"] = {
    textureConfig: null,
  };
  const rendererDom = createRendererContainer(app);
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
  const actions: RenderAction = {
    ...blueprintPreviewManager.actions,
  };

  const host: RenderHost = {
    workspace,
    app,
    container: rendererDom.container,
    dom: rendererDom.dom,
    textureManager,
    internalState,
    queries: blueprintPreviewManager.queries,
    actions,
    destroy: () => {
      blueprintPreviewManager.destroy();
      orchestrator?.destroy();
      orchestrator = null;
      textureManager.destroy();
      app.destroy();
      rendererDom.container.remove();
    },
  };

  orchestrator = createRenderSceneOrchestrator(host);

  workspace.render = host;

  return host;
}
