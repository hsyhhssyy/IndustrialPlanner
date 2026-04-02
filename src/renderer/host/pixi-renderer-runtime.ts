import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
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
  fontFamily:
    '"IBM Plex Sans", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontSize: 12,
  fontWeight: "600",
  align: "center",
  wordWrap: true,
  wordWrapWidth: 108,
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
const SPRITE_SURFACE_FILL: FillInput = {
  color: 0x111822,
  alpha: 0.42,
};
const BELT_TRACK_OUTER_FILL: FillInput = {
  color: 0x1a232d,
  alpha: 0.94,
};
const BELT_TRACK_INNER_FILL: FillInput = {
  color: 0x6d7b8c,
  alpha: 0.92,
};
const PIPE_TRACK_OUTER_FILL: FillInput = {
  color: 0x172430,
  alpha: 0.96,
};
const PIPE_TRACK_INNER_FILL: FillInput = {
  color: 0x2f6d86,
  alpha: 0.92,
};
const PIPE_TRACK_CORE_FILL: FillInput = {
  color: 0x9de6ff,
  alpha: 0.86,
};
const SELECTION_STROKE_STYLE: StrokeInput = {
  width: 2,
  color: 0xf7d06a,
  alpha: 0.98,
};
const PIXI_DISPLAY_OBJECT_DESTROY_OPTIONS: DestroyOptions = {
  children: true,
  context: true,
  style: true,
  texture: false,
  textureSource: false,
};

interface PixiSceneLayers {
  camera: Container;
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
): StrokeInput {
  switch (status) {
    case "running":
      return {
        width: 1.5,
        color: 0x7fe0b0,
        alpha: 0.82,
      };
    case "blocked":
      return {
        width: 1.5,
        color: 0xffc86a,
        alpha: 0.82,
      };
    default:
      return {
        width: 1.5,
        color: 0x8ea0b7,
        alpha: 0.44,
      };
  }
}

function getInsetBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  inset: number,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: x + inset,
    y: y + inset,
    width: Math.max(0, width - inset * 2),
    height: Math.max(0, height - inset * 2),
  };
}

function addEntitySelectionOutline(
  container: Container,
  entity: RenderEntitySprite,
  x: number,
  y: number,
  entityWidth: number,
  entityHeight: number,
): void {
  if (!entity.selected) {
    return;
  }

  const selectionBounds = getInsetBounds(x, y, entityWidth, entityHeight, 2);
  const selectionOutline = new Graphics()
    .rect(
      selectionBounds.x,
      selectionBounds.y,
      selectionBounds.width,
      selectionBounds.height,
    )
    .stroke(SELECTION_STROKE_STYLE);
  container.addChild(selectionOutline);
}

function clearContainer(container: Container): void {
  const children = container.removeChildren();

  for (const child of children) {
    child.destroy(PIXI_DISPLAY_OBJECT_DESTROY_OPTIONS);
  }
}

function createSceneLayers(stage: Container): PixiSceneLayers {
  const camera = new Container();
  const grid = new Container();
  const links = new Container();
  const entities = new Container();

  camera.addChild(grid);
  camera.addChild(links);
  camera.addChild(entities);
  stage.addChild(camera);

  return {
    camera,
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

function addEntityDecorators(
  container: Container,
  entity: RenderEntitySprite,
  x: number,
  y: number,
  entityWidth: number,
  entityHeight: number,
): void {
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
}

function drawEntityTrack(
  scene: RenderSceneModel,
  entity: RenderEntitySprite,
): Container {
  const container = new Container();
  const x = entity.x * scene.zoom;
  const y = entity.y * scene.zoom;
  const entityWidth = entity.width * scene.zoom;
  const entityHeight = entity.height * scene.zoom;
  const vertical = entity.rotation === 90 || entity.rotation === 270;
  const laneLength = vertical ? entityHeight * 0.84 : entityWidth * 0.84;
  const laneThickness = Math.max(
    10,
    Math.min(entityWidth, entityHeight) *
      (entity.renderKind === "belt-track" ? 0.34 : 0.26),
  );
  const laneX = vertical ? x + (entityWidth - laneThickness) / 2 : x + entityWidth * 0.08;
  const laneY = vertical ? y + entityHeight * 0.08 : y + (entityHeight - laneThickness) / 2;
  const laneWidth = vertical ? laneThickness : laneLength;
  const laneHeight = vertical ? laneLength : laneThickness;
  const innerInset = entity.renderKind === "belt-track" ? 4 : 3;
  const frameBounds = getInsetBounds(x, y, entityWidth, entityHeight, 2);

  const cellFrame = new Graphics()
    .rect(
      frameBounds.x,
      frameBounds.y,
      frameBounds.width,
      frameBounds.height,
    )
    .fill({ color: 0x111821, alpha: 0.18 })
    .stroke(getStatusStrokeStyle(entity.status));
  container.addChild(cellFrame);

  const outerLane = new Graphics()
    .roundRect(laneX, laneY, laneWidth, laneHeight, laneThickness / 2)
    .fill(
      entity.renderKind === "belt-track"
        ? BELT_TRACK_OUTER_FILL
        : PIPE_TRACK_OUTER_FILL,
    );
  container.addChild(outerLane);

  const innerLane = new Graphics()
    .roundRect(
      laneX + innerInset,
      laneY + innerInset,
      Math.max(0, laneWidth - innerInset * 2),
      Math.max(0, laneHeight - innerInset * 2),
      Math.max(2, laneThickness / 2 - innerInset),
    )
    .fill(
      entity.renderKind === "belt-track"
        ? BELT_TRACK_INNER_FILL
        : PIPE_TRACK_INNER_FILL,
    );
  container.addChild(innerLane);

  if (entity.renderKind === "pipe-track") {
    const coreInset = innerInset + 4;
    const coreLane = new Graphics()
      .roundRect(
        laneX + coreInset,
        laneY + coreInset,
        Math.max(0, laneWidth - coreInset * 2),
        Math.max(0, laneHeight - coreInset * 2),
        Math.max(2, laneThickness / 2 - coreInset),
      )
      .fill(PIPE_TRACK_CORE_FILL);
    container.addChild(coreLane);
  }

  addEntitySelectionOutline(container, entity, x, y, entityWidth, entityHeight);
  addEntityDecorators(container, entity, x, y, entityWidth, entityHeight);
  return container;
}

function drawEntityTexture(
  container: Container,
  scene: RenderSceneModel,
  entity: RenderEntitySprite,
  textureCache: Map<string, Texture>,
  x: number,
  y: number,
  entityWidth: number,
  entityHeight: number,
): void {
  if (!entity.textureSrc) {
    return;
  }

  const texture = textureCache.get(entity.textureSrc);

  if (!texture) {
    return;
  }

  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x =
    x + entityWidth / 2 + entity.textureCenterOffsetX * scene.zoom;
  sprite.y =
    y + entityHeight / 2 + entity.textureCenterOffsetY * scene.zoom;
  sprite.width = entity.textureWidth * scene.zoom;
  sprite.height = entity.textureHeight * scene.zoom;
  sprite.rotation = (entity.rotation * Math.PI) / 180;
  sprite.alpha = 0.98;
  container.addChild(sprite);
}

function addEntityLabel(
  container: Container,
  entity: RenderEntitySprite,
  x: number,
  y: number,
  entityWidth: number,
  entityHeight: number,
): void {
  if (!entity.showLabel) {
    return;
  }

  const label = new Text({
    text: entity.label,
    style: LABEL_TEXT_STYLE,
  });
  label.anchor.set(0.5);
  label.x = x + entityWidth / 2;
  label.y = y + entityHeight / 2;
  label.style.wordWrapWidth = Math.max(28, entityWidth - 12);
  container.addChild(label);
}

function drawSpriteEntity(
  scene: RenderSceneModel,
  entity: RenderEntitySprite,
  textureCache: Map<string, Texture>,
): Container {
  const container = new Container();
  const x = entity.x * scene.zoom;
  const y = entity.y * scene.zoom;
  const entityWidth = entity.width * scene.zoom;
  const entityHeight = entity.height * scene.zoom;
  const surfaceBounds = getInsetBounds(x, y, entityWidth, entityHeight, 2);

  const baseShape = new Graphics()
    .rect(
      surfaceBounds.x,
      surfaceBounds.y,
      surfaceBounds.width,
      surfaceBounds.height,
    )
    .fill(entity.textureSrc ? SPRITE_SURFACE_FILL : { color: entity.fill })
    .stroke(getStatusStrokeStyle(entity.status));
  container.addChild(baseShape);

  drawEntityTexture(container, scene, entity, textureCache, x, y, entityWidth, entityHeight);

  if (!entity.textureSrc) {
    const fallbackTexture = new Graphics()
      .rect(x + 6, y + 6, Math.max(12, entityWidth - 12), Math.max(12, entityHeight - 12))
      .fill({ color: entity.fill, alpha: 0.9 });
    container.addChild(fallbackTexture);
  }

  addEntitySelectionOutline(container, entity, x, y, entityWidth, entityHeight);
  addEntityLabel(container, entity, x, y, entityWidth, entityHeight);
  addEntityDecorators(container, entity, x, y, entityWidth, entityHeight);
  return container;
}

function drawEntitySprite(
  scene: RenderSceneModel,
  entity: RenderEntitySprite,
  textureCache: Map<string, Texture>,
): Container {
  if (entity.renderKind === "belt-track" || entity.renderKind === "pipe-track") {
    return drawEntityTrack(scene, entity);
  }

  return drawSpriteEntity(scene, entity, textureCache);
}

function renderSceneToLayers(
  layers: PixiSceneLayers,
  scene: RenderSceneModel,
  textureCache: Map<string, Texture>,
): void {
  clearContainer(layers.grid);
  clearContainer(layers.links);
  clearContainer(layers.entities);

  layers.grid.addChild(drawGridLayer(scene));

  for (const explicitLink of scene.explicitLinks) {
    layers.links.addChild(drawExplicitLinkSprite(scene, explicitLink));
  }

  for (const entity of scene.entities) {
    layers.entities.addChild(drawEntitySprite(scene, entity, textureCache));
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

function collectSceneTexturePaths(scene: RenderSceneModel): string[] {
  return Array.from(
    new Set(
      scene.entities
        .map((entity) => entity.textureSrc)
        .filter((path): path is string => Boolean(path)),
    ),
  );
}

export function createPixiRendererRuntime(
  hostElement: HTMLDivElement,
): PixiRendererRuntime {
  const app = new Application();
  const layers = createSceneLayers(app.stage);
  const textureCache = new Map<string, Texture>();
  const pendingTexturePaths = new Set<string>();

  let destroyed = false;
  let initialized = false;
  let latestScene: RenderSceneModel | null = null;
  const resizeObserver = new ResizeObserver(() => {
    renderLatestScene();
  });

  function unloadManagedTextures(): void {
    const loadedTexturePaths = Array.from(textureCache.keys());
    textureCache.clear();

    if (loadedTexturePaths.length === 0) {
      return;
    }

    void Promise.all(
      loadedTexturePaths.map(async (path) => {
        try {
          await Assets.unload(path);
        } catch {
          // Ignore unload errors during renderer teardown.
        }
      }),
    );
  }

  function renderLatestScene(): void {
    if (!initialized || destroyed || !latestScene) {
      return;
    }

    const { resolution } = getSceneScreenSize(latestScene);
    const width = Math.max(1, Math.floor(hostElement.clientWidth));
    const height = Math.max(1, Math.floor(hostElement.clientHeight));
    app.renderer.resize(width, height, resolution);
    layers.camera.position.set(
      -latestScene.viewportOffset.x * latestScene.zoom,
      -latestScene.viewportOffset.y * latestScene.zoom,
    );
    renderSceneToLayers(layers, latestScene, textureCache);
    app.render();
  }

  function ensureTexture(path: string): void {
    if (textureCache.has(path) || pendingTexturePaths.has(path)) {
      return;
    }

    pendingTexturePaths.add(path);

    void Assets.load<Texture>(path)
      .then((texture) => {
        pendingTexturePaths.delete(path);

        if (destroyed) {
          return;
        }

        textureCache.set(path, texture);
        renderLatestScene();
      })
      .catch((error: unknown) => {
        pendingTexturePaths.delete(path);

        if (!destroyed) {
          console.error(`Failed to load renderer sprite "${path}".`, error);
        }
      });
  }

  function ensureSceneAssets(scene: RenderSceneModel): void {
    for (const texturePath of collectSceneTexturePaths(scene)) {
      ensureTexture(texturePath);
    }
  }

  void app
    .init({
      autoDensity: true,
      autoStart: false,
      antialias: true,
      backgroundColor: RENDERER_BACKGROUND_COLOR,
      height: 1,
      preference: "webgl",
      resolution: window.devicePixelRatio || 1,
      width: 1,
    })
    .then(() => {
      if (destroyed) {
        app.destroy({ removeView: true }, PIXI_DISPLAY_OBJECT_DESTROY_OPTIONS);
        unloadManagedTextures();
        return;
      }

      app.canvas.className = "renderer-canvas";
      hostElement.appendChild(app.canvas);
      resizeObserver.observe(hostElement);
      initialized = true;
      renderLatestScene();
    })
    .catch((error: unknown) => {
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
      ensureSceneAssets(scene);
      renderLatestScene();
    },
    destroy() {
      destroyed = true;
      resizeObserver.disconnect();

      if (initialized) {
        app.destroy(
          { removeView: true },
          PIXI_DISPLAY_OBJECT_DESTROY_OPTIONS,
        );
      }

      unloadManagedTextures();
    },
  };
}
