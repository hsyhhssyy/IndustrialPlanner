import type {
  RenderExplicitLink,
  RenderEntitySprite,
  RenderMovePreview,
  RenderPlacementPreview,
  RenderSceneModel,
} from "@/renderer/scene/types";

export interface RenderSceneSyncPlan {
  redrawStaticLayers: boolean;
  redrawPreviewLayer: boolean;
}

function isSameRenderEntitySprite(
  left: RenderEntitySprite,
  right: RenderEntitySprite,
): boolean {
  return (
    left.entityId === right.entityId &&
    left.definitionId === right.definitionId &&
    left.label === right.label &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation &&
    left.renderKind === right.renderKind &&
    left.fill === right.fill &&
    left.textureSrc === right.textureSrc &&
    left.textureWidth === right.textureWidth &&
    left.textureHeight === right.textureHeight &&
    left.textureCenterOffsetX === right.textureCenterOffsetX &&
    left.textureCenterOffsetY === right.textureCenterOffsetY &&
    left.showLabel === right.showLabel &&
    left.status === right.status &&
    left.selected === right.selected &&
    left.ghosted === right.ghosted &&
    left.pendingLinkSource === right.pendingLinkSource &&
    left.patched === right.patched
  );
}

function isSameRenderEntitySprites(
  left: RenderEntitySprite[],
  right: RenderEntitySprite[],
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((entity, index) => isSameRenderEntitySprite(entity, right[index]!));
}

function isSameRenderExplicitLink(
  left: RenderExplicitLink,
  right: RenderExplicitLink,
): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.x1 === right.x1 &&
    left.y1 === right.y1 &&
    left.x2 === right.x2 &&
    left.y2 === right.y2 &&
    left.selected === right.selected
  );
}

function isSameRenderExplicitLinks(
  left: RenderExplicitLink[],
  right: RenderExplicitLink[],
): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((link, index) => isSameRenderExplicitLink(link, right[index]!));
}

function isSameRenderPlacementPreview(
  left: RenderPlacementPreview | null,
  right: RenderPlacementPreview | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.definitionId === right.definitionId &&
    left.interactionMode === right.interactionMode &&
    left.label === right.label &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation &&
    left.renderKind === right.renderKind &&
    left.fill === right.fill &&
    left.textureSrc === right.textureSrc &&
    left.textureWidth === right.textureWidth &&
    left.textureHeight === right.textureHeight &&
    left.textureCenterOffsetX === right.textureCenterOffsetX &&
    left.textureCenterOffsetY === right.textureCenterOffsetY &&
    left.valid === right.valid
  );
}

function isSameRenderMovePreview(
  left: RenderMovePreview | null,
  right: RenderMovePreview | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.entityId === right.entityId &&
    isSameRenderPlacementPreview(left, right)
  );
}

export function getRenderSceneSyncPlan(
  previousScene: RenderSceneModel | null,
  nextScene: RenderSceneModel,
): RenderSceneSyncPlan {
  if (!previousScene) {
    return {
      redrawStaticLayers: true,
      redrawPreviewLayer: true,
    };
  }

  const redrawStaticLayers =
    previousScene.zoom !== nextScene.zoom ||
    previousScene.gridSize !== nextScene.gridSize ||
    previousScene.worldWidth !== nextScene.worldWidth ||
    previousScene.worldHeight !== nextScene.worldHeight ||
    !isSameRenderEntitySprites(previousScene.entities, nextScene.entities) ||
    !isSameRenderExplicitLinks(previousScene.explicitLinks, nextScene.explicitLinks);

  return {
    redrawStaticLayers,
    redrawPreviewLayer:
      redrawStaticLayers ||
      !isSameRenderMovePreview(
        previousScene.movePreview,
        nextScene.movePreview,
      ) ||
      !isSameRenderPlacementPreview(
        previousScene.placementPreview,
        nextScene.placementPreview,
      ),
  };
}
