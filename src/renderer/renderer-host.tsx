import type { RenderAction, RenderContract, RenderQuery } from "@/domain/renderer";
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
import type { RenderSurfaceContext } from "./render-surface-context";
import {
  createRenderScheduler,
  createRenderSurface,
  createRenderSurfaceRegistry,
} from "./surface";
import "./renderer-host.css";

interface RenderHostDomElements {
  placementGlowOverlay: HTMLDivElement;
  blueprintGlowOverlay: HTMLDivElement;
  marqueeGlowOverlay: HTMLDivElement;
}

export interface RenderHost extends RenderContract, RenderSurfaceContext {
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
    autoStart: false,
    resolution: renderResolution,
    preference: "webgl",
  });

  (app.stage as unknown as RoundPixelsStageLike).roundPixels = true;
  const internalState: RenderHost["internalState"] = {
    textureConfig: null,
  };
  const rendererDom = createRendererContainer(app);
  const surfaceRegistry = createRenderSurfaceRegistry();
  const textureManager = createTextureActions({
    renderer: app.renderer,
    app: workspace.app,
    syncTextureConfigState: (textureConfig) => {
      internalState.textureConfig = textureConfig;
    },
  });
  const actions = {} as RenderAction;
  const queries = {} as RenderQuery;
  const scheduler = createRenderScheduler({
    listActiveSurfaces: surfaceRegistry.listActive,
    advanceHostFrame: (frameTime) => {
      void workspace.simulation?.actions.advancePlaybackByDeltaMs(frameTime.deltaMs)
    },
  });
  let blueprintPreviewManager: ReturnType<typeof createBlueprintPreviewManager> | null = null;
  let destroyed = false;

  const host: RenderHost = {
    workspace,
    app,
    container: rendererDom.container,
    dom: rendererDom.dom,
    textureManager,
    internalState,
    queries,
    actions,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      scheduler.destroy();
      try {
        blueprintPreviewManager?.destroy();
      } finally {
        blueprintPreviewManager = null;
        try {
          surfaceRegistry.destroy();
        } finally {
          rendererDom.container.remove();
          if (workspace.render === host) {
            workspace.render = null;
          }
        }
      }
    },
  };

  blueprintPreviewManager = createBlueprintPreviewManager({
    workspace,
    surfaceRegistry,
  });
  Object.assign(actions, blueprintPreviewManager.actions);
  Object.assign(queries, blueprintPreviewManager.queries);

  let mainSurfaceOwnsResources = false;
  try {
    const orchestrator: RenderSceneOrchestrator = createRenderSceneOrchestrator(
      host,
      textureManager.performanceDiagnostics,
    );
    surfaceRegistry.beginInitializing("main");
    const mainSurface = createRenderSurface({
      id: "main",
      app,
      scene: orchestrator,
      destroyResources: () => {
        textureManager.destroy();
        app.destroy();
      },
    });
    mainSurfaceOwnsResources = true;
    if (!surfaceRegistry.activate(mainSurface)) {
      throw new Error("Main render surface was disposed during initialization.");
    }

    workspace.render = host;
    scheduler.start();
    return host;
  } catch (error) {
    scheduler.destroy();
    blueprintPreviewManager?.destroy();
    blueprintPreviewManager = null;
    surfaceRegistry.destroy();
    if (!mainSurfaceOwnsResources) {
      textureManager.destroy();
      app.destroy();
    }
    rendererDom.container.remove();
    throw error;
  }
}
