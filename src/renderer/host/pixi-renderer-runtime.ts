import {
  Application,
  Container,
  Graphics,
  Text,
} from "pixi.js";
import type {
  DestroyOptions,
  FillInput,
  StrokeInput,
  TextStyleOptions,
} from "pixi.js";
import type {
  RenderEntitySprite,
  RenderExplicitLink,
  RenderSceneModel,
} from "@/renderer/scene/types";

const RENDERER_BACKGROUND_COLOR = 0x0d1218;
const GRID_STROKE_STYLE: StrokeInput = {
  width: 1,
  color: 0xffffff,
  alpha: 0.05,
};
const LABEL_TEXT_STYLE: TextStyleOptions = {
  fill: 0xf3f6fb,
  fontFamily: '"IBM Plex Sans", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontSize: 12,
  fontWeight: "600",
};
const SUBTITLE_TEXT_STYLE: TextStyleOptions = {
  fill: "rgba(243, 246, 251, 0.7)",
  fontFamily: '"IBM Plex Sans", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontSize: 12,
};
const PROGRESS_TRACK_FILL: FillInput = {
  color: 0xffffff,
  alpha: 0.12,
};
const PROGRESS_FILL: FillInput = {
  color: 0x7fe0b0,
};
const PENDING_LINK_STROKE_STYLE: StrokeInput = {
  width: 2,
  color: 0x63b4da,
};
const PATCHED_STROKE_STYLE: StrokeInput = {
  width: 2,
  color: 0xffc86a,
  alpha: 0.88,
};
const PIXI_DESTROY_OPTIONS: DestroyOptions = {
  children: true,
  context: true,
  style: true,
  texture: true,
  textureSource: true,
};

interface PixiSceneLayers {
  grid: Container;
  links: Container;
  entities: Container;
}

export interface PixiRendererRuntime {
  syncScene: (scene: RenderSceneModel) => void;
  destroy: () => void;
}

function getStatusStrokeStyle(
  status: RenderEntitySprite["status"],
  selected: boolean,
): StrokeInput {
  if (selected) {
    return {
      width: 3,
      color: 0x7fe0b0,
    };
  }

  switch (status) {
    case "running":
      return {
        width: 1.5,
        color: 0x7fe0b0,
      };
    case "blocked":
      return {
        width: 1.5,
        color: 0xffc86a,
      };
    default:
      return {
        width: 1.5,
        color: 0x8ea0b7,
      };
  }
}

function clearContainer(container: Container): void {
  const children = container.removeChildren();

  for (const child of children) {
    child.destroy(PIXI_DESTROY_OPTIONS);
  }
}

function createSceneLayers(stage: Container): PixiSceneLayers {
  const grid = new Container();
  const links = new Container();
  const entities = new Container();

  stage.addChild(grid);
  stage.addChild(links);
  stage.addChild(entities);

  return {
    grid,
    links,
    entities,
  };
}

function drawDashedLine(
  graphics: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLength: number,
  gapLength: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) {
    return;
  }

  const stepX = dx / distance;
  const stepY = dy / distance;

  for (
    let progress = 0;
    progress < distance;
    progress += dashLength + gapLength
  ) {
    const dashEnd = Math.min(distance, progress + dashLength);

    graphics.moveTo(x1 + stepX * progress, y1 + stepY * progress);
    graphics.lineTo(x1 + stepX * dashEnd, y1 + stepY * dashEnd);
  }
}

function drawDashedRect(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  dashLength: number,
  gapLength: number,
): void {
  drawDashedLine(graphics, x, y, x + width, y, dashLength, gapLength);
  drawDashedLine(
    graphics,
    x + width,
    y,
    x + width,
    y + height,
    dashLength,
    gapLength,
  );
  drawDashedLine(
    graphics,
    x + width,
    y + height,
    x,
    y + height,
    dashLength,
    gapLength,
  );
  drawDashedLine(graphics, x, y + height, x, y, dashLength, gapLength);
}

function drawGridLayer(scene: RenderSceneModel): Graphics {
  const graphics = new Graphics();
  const width = Math.max(1, Math.floor(scene.worldWidth * scene.zoom));
  const height = Math.max(1, Math.floor(scene.worldHeight * scene.zoom));
  const scaledGrid = scene.gridSize * scene.zoom;

  for (let x = 0; x <= width; x += scaledGrid) {
    graphics.moveTo(x, 0);
    graphics.lineTo(x, height);
  }

  for (let y = 0; y <= height; y += scaledGrid) {
    graphics.moveTo(0, y);
    graphics.lineTo(width, y);
  }

  graphics.stroke(GRID_STROKE_STYLE);

  return graphics;
}

function drawExplicitLinkSprite(
  scene: RenderSceneModel,
  explicitLink: RenderExplicitLink,
): Graphics {
  const graphics = new Graphics();
  const strokeStyle: StrokeInput = explicitLink.selected
    ? {
      width: 3,
      color: 0x7fe0b0,
      alpha: 0.92,
    }
    : {
      width: 2,
      color: 0x63b4da,
      alpha: 0.78,
    };

  drawDashedLine(
    graphics,
    explicitLink.x1 * scene.zoom,
    explicitLink.y1 * scene.zoom,
    explicitLink.x2 * scene.zoom,
    explicitLink.y2 * scene.zoom,
    10,
    7,
  );
  graphics.stroke(strokeStyle);

  return graphics;
}

function drawEntitySprite(
  scene: RenderSceneModel,
  entity: RenderEntitySprite,
): Container {
  const container = new Container();
  const x = entity.x * scene.zoom;
  const y = entity.y * scene.zoom;
  const entityWidth = entity.width * scene.zoom;
  const entityHeight = entity.height * scene.zoom;
  const progressTrackWidth = Math.max(0, entityWidth - 24);

  const baseShape = new Graphics()
    .rect(x, y, entityWidth, entityHeight)
    .fill({ color: entity.fill })
    .stroke(getStatusStrokeStyle(entity.status, entity.selected));

  container.addChild(baseShape);

  if (entity.pendingLinkSource) {
    const pendingLinkShape = new Graphics();
    drawDashedRect(
      pendingLinkShape,
      x + 4,
      y + 4,
      Math.max(0, entityWidth - 8),
      Math.max(0, entityHeight - 8),
      6,
      5,
    );
    pendingLinkShape.stroke(PENDING_LINK_STROKE_STYLE);
    container.addChild(pendingLinkShape);
  }

  if (entity.patched) {
    const patchedShape = new Graphics();
    drawDashedRect(
      patchedShape,
      x + 8,
      y + 8,
      Math.max(0, entityWidth - 16),
      Math.max(0, entityHeight - 16),
      4,
      4,
    );
    patchedShape.stroke(PATCHED_STROKE_STYLE);
    container.addChild(patchedShape);
  }

  const label = new Text({
    text: entity.label,
    style: LABEL_TEXT_STYLE,
  });
  label.x = x + 12;
  label.y = y + 10;
  container.addChild(label);

  const subtitle = new Text({
    text: entity.subtitle,
    style: SUBTITLE_TEXT_STYLE,
  });
  subtitle.x = x + 12;
  subtitle.y = y + 28;
  container.addChild(subtitle);

  const progressTrack = new Graphics()
    .rect(x + 12, y + entityHeight - 18, progressTrackWidth, 6)
    .fill(PROGRESS_TRACK_FILL);
  container.addChild(progressTrack);

  const progressFill = new Graphics()
    .rect(
      x + 12,
      y + entityHeight - 18,
      Math.max(0, progressTrackWidth * entity.progress),
      6,
    )
    .fill(PROGRESS_FILL);
  container.addChild(progressFill);

  return container;
}

function renderSceneToLayers(
  layers: PixiSceneLayers,
  scene: RenderSceneModel,
): void {
  clearContainer(layers.grid);
  clearContainer(layers.links);
  clearContainer(layers.entities);

  layers.grid.addChild(drawGridLayer(scene));

  for (const explicitLink of scene.explicitLinks) {
    layers.links.addChild(drawExplicitLinkSprite(scene, explicitLink));
  }

  for (const entity of scene.entities) {
    layers.entities.addChild(drawEntitySprite(scene, entity));
  }
}

function getSceneScreenSize(scene: RenderSceneModel): {
  width: number;
  height: number;
  resolution: number;
} {
  return {
    width: Math.max(1, Math.floor(scene.worldWidth * scene.zoom)),
    height: Math.max(1, Math.floor(scene.worldHeight * scene.zoom)),
    resolution: window.devicePixelRatio || 1,
  };
}

export function createPixiRendererRuntime(
  hostElement: HTMLDivElement,
): PixiRendererRuntime {
  const app = new Application();
  const layers = createSceneLayers(app.stage);

  let destroyed = false;
  let initialized = false;
  let latestScene: RenderSceneModel | null = null;

  void app.init({
    autoDensity: true,
    autoStart: false,
    antialias: true,
    backgroundColor: RENDERER_BACKGROUND_COLOR,
    height: 1,
    preference: "webgl",
    resolution: window.devicePixelRatio || 1,
    width: 1,
  }).then(() => {
    if (destroyed) {
      app.destroy({ removeView: true }, PIXI_DESTROY_OPTIONS);
      return;
    }

    app.canvas.className = "renderer-canvas";
    hostElement.appendChild(app.canvas);
    initialized = true;

    if (latestScene) {
      const { width, height, resolution } = getSceneScreenSize(latestScene);
      app.renderer.resize(width, height, resolution);
      renderSceneToLayers(layers, latestScene);
      app.render();
    }
  }).catch((error: unknown) => {
    if (!destroyed) {
      console.error("Failed to initialize Pixi renderer host.", error);
    }
  });

  return {
    syncScene(scene) {
      if (destroyed) {
        return;
      }

      latestScene = scene;

      if (!initialized) {
        return;
      }

      const { width, height, resolution } = getSceneScreenSize(scene);

      app.renderer.resize(width, height, resolution);
      renderSceneToLayers(layers, scene);
      app.render();
    },
    destroy() {
      destroyed = true;

      if (initialized) {
        app.destroy({ removeView: true }, PIXI_DESTROY_OPTIONS);
      }
    },
  };
}
