import { RenderContract } from "@/domain/contract/render-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { reaction } from "mobx";

import { Application, Graphics } from "pixi.js";

export interface RenderHost extends RenderContract {
  workspace: WorkspaceContract;
  app: Application;
}

const DEFAULT_VIEWPORT_WIDTH = 800;
const DEFAULT_VIEWPORT_HEIGHT = 600;
const VIEWPORT_FRAME_MARGIN = 10;
const VIEWPORT_FRAME_STROKE_WIDTH = 5;
const VIEWPORT_FRAME_COLOR = 0xffffff;

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function resizeApplicationToViewport(options: {
  app: Application;
  width: number;
  height: number;
}): void {
  const width = resolveViewportAxisSize(
    options.width,
    options.app.renderer.width,
  );
  const height = resolveViewportAxisSize(
    options.height,
    options.app.renderer.height,
  );

  options.app.renderer.resize(width, height);
  options.app.render();
}


export async function createRenderHost(
  workspace: WorkspaceContract
): Promise<RenderHost> {
  const editor = workspace.editor;
  if (editor === null) {
    throw new Error("Editor host must be initialized before render host.");
  }

  const app = new Application();
  const { pixelSize } = editor.state.viewport;
  const viewportFrame = new Graphics();

  await app.init({
    width: resolveViewportAxisSize(pixelSize.width, DEFAULT_VIEWPORT_WIDTH),
    height: resolveViewportAxisSize(pixelSize.height, DEFAULT_VIEWPORT_HEIGHT),
    backgroundColor: 0x1099bb,
    antialias: true,
    resolution: 1,
    preference: "webgl",
  });

  reaction(
    () => ({
      width: editor.state.viewport.pixelSize.width,
      height: editor.state.viewport.pixelSize.height,
    }),
    ({ width, height }) => {
      resizeApplicationToViewport({
        app,
        width,
        height,
      });
    },
  );

  app.stage.addChild(viewportFrame);

  const host: RenderHost = {
    workspace,
    app,
    canvas: app.canvas,
    queries: {},
    actions: {},
  };

  workspace.render = host;

  host.app.ticker.add(() => {
    const halfStrokeWidth = VIEWPORT_FRAME_STROKE_WIDTH / 2;
    const frameInset = VIEWPORT_FRAME_MARGIN + halfStrokeWidth;
    const frameWidth = Math.max(0, app.renderer.width - frameInset * 2);
    const frameHeight = Math.max(0, app.renderer.height - frameInset * 2);

    viewportFrame
      .clear()
      .rect(frameInset, frameInset, frameWidth, frameHeight)
      .stroke({
        width: VIEWPORT_FRAME_STROKE_WIDTH,
        color: VIEWPORT_FRAME_COLOR,
      });
  });

  return host;
}
