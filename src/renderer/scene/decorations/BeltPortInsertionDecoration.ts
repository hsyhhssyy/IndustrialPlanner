import {
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js"

import { resolveDedicatedLogisticTintColor } from "@/renderer/sprites/dedicated-logistic-sprite"
import { resolveDisplayRotationRadians } from "@/shared/geometry/viewport-transform"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  resolveBeltPortExtensionEntries,
  resolveViewportPoint,
  resolveVisibleWorldRect,
  isWorldEntityVisible,
  createEntityDefinitionMap,
} from "./BeltVisualGeometry"

const BELT_STRAIGHT_TEXTURE_KEY = "device-sprite-belt_straight_1x1"

interface BeltInsertionSpriteView {
  readonly root: Container;
  readonly mask: Graphics;
  readonly sprite: Sprite;
}

export function createBeltPortInsertionDecoration(): DecorationLayer {
  const container = new Container()
  const spriteViews: BeltInsertionSpriteView[] = []
  let destroyed = false
  let texture: Texture | null = null
  let textureLoadStarted = false
  let forceSync = true
  let lastDocumentVersion = -1
  let lastViewportVersion = -1
  let lastCollectionVersion = -1
  let lastPresentationVersion = -1

  const ensureTexture = (ctx: DecorationSyncContext): void => {
    if (textureLoadStarted || texture !== null) {
      return
    }

    textureLoadStarted = true
    void ctx.renderHost.textureManager.getTexture(BELT_STRAIGHT_TEXTURE_KEY).then((loadedTexture) => {
      if (destroyed) {
        return
      }

      texture = loadedTexture
      forceSync = true
    })
  }

  const ensureSpriteView = (index: number): BeltInsertionSpriteView => {
    let view = spriteViews[index]
    if (view !== undefined) {
      return view
    }

    const root = new Container()
    const mask = new Graphics({ roundPixels: true })
    const sprite = new Sprite(Texture.EMPTY)
    sprite.anchor.set(0.5)
    sprite.roundPixels = true
    root.mask = mask
    root.addChild(mask)
    root.addChild(sprite)
    container.addChild(root)

    view = {
      root,
      mask,
      sprite,
    }
    spriteViews.push(view)
    return view
  }

  const hideAll = (): void => {
    container.visible = false

    for (const view of spriteViews) {
      view.root.visible = false
    }
  }

  return {
    container,

    sync(ctx: DecorationSyncContext): void {
      if (destroyed) {
        return
      }

      const versions = ctx.versions
      if (
        versions !== undefined
        && !forceSync
        && lastDocumentVersion === versions.document
        && lastViewportVersion === versions.viewport
        && lastCollectionVersion === versions.collections
        && lastPresentationVersion === versions.presentation
      ) {
        return
      }
      forceSync = false
      if (versions !== undefined) {
        lastDocumentVersion = versions.document
        lastViewportVersion = versions.viewport
        lastCollectionVersion = versions.collections
        lastPresentationVersion = versions.presentation
      }

      const allEntries = resolveBeltPortExtensionEntries(ctx)
      if (allEntries.length === 0) {
        hideAll()
        return
      }

      // 过滤：只保留 belt 或 device 任一在视口内的 extension
      const editor = ctx.renderHost.workspace.editor
      const definitionMap = createEntityDefinitionMap(ctx)
      const visibleRect = resolveVisibleWorldRect(ctx.viewportState, ctx.viewportBounds)
      const entityById = editor !== null
        ? new Map(editor.queries.listEntities().map((e) => [e.id, e]))
        : new Map()

      const entries = allEntries.filter((entry) => {
        const beltEntity = entityById.get(entry.beltEntityId)
        const deviceEntity = entityById.get(entry.deviceEntityId)
        const beltDef = beltEntity ? definitionMap.get(beltEntity.definitionId) : undefined
        const deviceDef = deviceEntity ? definitionMap.get(deviceEntity.definitionId) : undefined
        return (beltEntity !== undefined && beltDef !== undefined && isWorldEntityVisible(beltEntity, beltDef.footprint, visibleRect))
          || (deviceEntity !== undefined && deviceDef !== undefined && isWorldEntityVisible(deviceEntity, deviceDef.footprint, visibleRect))
      })

      if (entries.length === 0) {
        hideAll()
        return
      }

      ensureTexture(ctx)
      container.visible = true

      const gridCellSize = ctx.viewportState.gridCellPixelSize
      entries.forEach((entry, visibleIndex) => {
        const view = ensureSpriteView(visibleIndex)
        const boundary = resolveViewportPoint({
          point: entry.boundary,
          viewportBounds: ctx.viewportBounds,
          viewportState: ctx.viewportState,
        })

        view.root.visible = texture !== null
        view.root.x = boundary.x
        view.root.y = boundary.y
        view.root.rotation = entry.angleRadians
          + resolveDisplayRotationRadians(ctx.viewportState.displayRotation)

        const localStartX = entry.localStartCells * gridCellSize
        const localEndX = entry.localEndCells * gridCellSize
        view.mask
          .clear()
          .rect(
            localStartX,
            -gridCellSize / 2,
            localEndX - localStartX,
            gridCellSize,
          )
          .fill(0xffffff)

        view.sprite.texture = texture ?? Texture.EMPTY
        view.sprite.x = entry.spriteCenterXCells * gridCellSize
        view.sprite.y = 0
        view.sprite.width = gridCellSize
        view.sprite.height = gridCellSize
        view.sprite.rotation = 0
        view.sprite.tint = resolveBeltPortExtensionTint(ctx, entry.beltEntityId)
      })

      for (let index = entries.length; index < spriteViews.length; index += 1) {
        const view = spriteViews[index]
        if (view !== undefined) {
          view.root.visible = false
        }
      }
    },

    destroy(): void {
      destroyed = true

      for (const view of spriteViews) {
        view.root.destroy({ children: true })
      }

      spriteViews.length = 0
      container.destroy({ children: true })
    },
  }
}

function resolveBeltPortExtensionTint(
  ctx: DecorationSyncContext,
  beltEntityId: string,
): number {
  return resolveDedicatedLogisticTintColor({
    entityId: beltEntityId,
    spriteId: "belt_straight_1x1",
    theme: ctx.theme,
    workspace: ctx.renderHost.workspace,
  })
}
