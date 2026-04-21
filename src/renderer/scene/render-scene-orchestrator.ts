import {
  Container,
  Graphics,
  UPDATE_PRIORITY,
} from "pixi.js";
import type { RenderHost } from "../renderer-host";

import { DummyBoxSprite } from "../sprites/dummy-box-sprite";
import {
  RenderLayerMap,
  RenderSprite,
  RenderSpriteId,
} from "../sprites/render-sprite";

const VIEWPORT_FRAME_MARGIN = 10;
const VIEWPORT_FRAME_STROKE_WIDTH = 5;
const VIEWPORT_FRAME_COLOR = 0xffffff;
const DUMMY_BOX_WIDTH = 160;
const DUMMY_BOX_HEIGHT = 120;
const DUMMY_BOX_MIN_MARGIN = 24;

export interface RenderSceneOrchestrator {
  destroy(): void;
}

export function createRenderSceneOrchestrator(
  renderHost: RenderHost,
): RenderSceneOrchestrator {
  const app = renderHost.app;
  const layers = createRenderLayers();
  const viewportFrame = new Graphics();
  const dummySprite = createSpriteById("dummy-box");
  let hasDrawnInitialFrame = false;
  let lastViewportSize = {
    width: app.renderer.width,
    height: app.renderer.height,
  };

  const flushViewport = (): void => {
    const nextViewportSize = readViewportSize(renderHost);

    if (
      hasDrawnInitialFrame
      &&
      nextViewportSize.width === lastViewportSize.width
      && nextViewportSize.height === lastViewportSize.height
    ) {
      return;
    }

    hasDrawnInitialFrame = true;
    lastViewportSize = nextViewportSize;
    applyViewportSize(app, nextViewportSize);

    const bounds = resolveViewportFrameBounds(app);

    viewportFrame
      .clear()
      .rect(bounds.left, bounds.top, bounds.width, bounds.height)
      .stroke({
        width: VIEWPORT_FRAME_STROKE_WIDTH,
        color: VIEWPORT_FRAME_COLOR,
      });

    const width = Math.min(
      DUMMY_BOX_WIDTH,
      Math.max(48, bounds.width - DUMMY_BOX_MIN_MARGIN * 2),
    );
    const height = Math.min(
      DUMMY_BOX_HEIGHT,
      Math.max(48, bounds.height - DUMMY_BOX_MIN_MARGIN * 2),
    );
    const x = bounds.left + Math.max(
      DUMMY_BOX_MIN_MARGIN,
      (bounds.width - width) / 2,
    );
    const y = bounds.top + Math.max(
      DUMMY_BOX_MIN_MARGIN,
      (bounds.height - height) / 2,
    );

    dummySprite.syncLayout({
      x,
      y,
      width,
      height,
    });
  };

  app.stage.addChild(layers.background, layers.entity, layers.overlay);
  layers.overlay.addChild(viewportFrame);
  dummySprite.attach(layers);
  app.ticker.add(flushViewport, undefined, UPDATE_PRIORITY.HIGH);

  const host: RenderSceneOrchestrator = {
    destroy: () => {
      app.ticker.remove(flushViewport);
      dummySprite.destroy();
      viewportFrame.destroy();
      layers.background.destroy({ children: true });
      layers.entity.destroy({ children: true });
      layers.overlay.destroy({ children: true });
    },
  };

  return host;
}

function createRenderLayers(): RenderLayerMap {
  return {
    background: new Container(),
    entity: new Container(),
    overlay: new Container(),
  };
}

function createSpriteById(spriteId: RenderSpriteId): RenderSprite {
  switch (spriteId) {
    case "dummy-box":
    default:
      return new DummyBoxSprite();
  }
}

function applyViewportSize(
  app: RenderHost["app"],
  viewportSize: {
    width: number;
    height: number;
  },
): void {
  if (
    app.renderer.width === viewportSize.width
    && app.renderer.height === viewportSize.height
  ) {
    return;
  }

  app.renderer.resize(viewportSize.width, viewportSize.height);
}

function readViewportSize(renderHost: RenderHost): {
  width: number;
  height: number;
} {
  const editor = renderHost.workspace.editor;
  if (editor === null) {
    return {
      width: renderHost.app.renderer.width,
      height: renderHost.app.renderer.height,
    };
  }

  return {
    width: resolveViewportAxisSize(
      editor.state.viewport.clientRect.width,
      renderHost.app.renderer.width,
    ),
    height: resolveViewportAxisSize(
      editor.state.viewport.clientRect.height,
      renderHost.app.renderer.height,
    ),
  };
}

function resolveViewportAxisSize(
  value: number,
  fallback: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function resolveViewportFrameBounds(app: RenderHost["app"]): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const halfStrokeWidth = VIEWPORT_FRAME_STROKE_WIDTH / 2;
  const frameInset = VIEWPORT_FRAME_MARGIN + halfStrokeWidth;

  return {
    left: frameInset,
    top: frameInset,
    width: Math.max(0, app.renderer.width - frameInset * 2),
    height: Math.max(0, app.renderer.height - frameInset * 2),
  };
}