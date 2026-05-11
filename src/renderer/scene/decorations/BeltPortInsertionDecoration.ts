import {
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js"

import { resolveAppThemeColorNumber } from "@/shared/theme/app-theme-color"

import type { DecorationLayer } from "./DecorationLayer"
import type { DecorationSyncContext } from "./DecorationSyncContext"
import {
  resolveBeltPortExtensionEntries,
  resolveViewportPoint,
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

  const ensureTexture = (ctx: DecorationSyncContext): void => {
    if (textureLoadStarted || texture !== null) {
      return
    }

    const textureManager = ctx.workspace.render?.textureManager
    if (textureManager === undefined) {
      return
    }

    textureLoadStarted = true
    void textureManager.getTexture(BELT_STRAIGHT_TEXTURE_KEY).then((loadedTexture) => {
      if (destroyed) {
        return
      }

      texture = loadedTexture
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

      const entries = resolveBeltPortExtensionEntries(ctx)
      if (entries.length === 0) {
        hideAll()
        return
      }

      ensureTexture(ctx)
      container.visible = true

      const gridCellSize = ctx.viewportState.gridCellPixelSize
      const tint = resolveBeltPortExtensionTint(ctx)

      entries.forEach((entry, index) => {
        const view = ensureSpriteView(index)
        const boundary = resolveViewportPoint({
          point: entry.boundary,
          viewportBounds: ctx.viewportBounds,
          viewportState: ctx.viewportState,
        })

        view.root.visible = texture !== null
        view.root.x = boundary.x
        view.root.y = boundary.y
        view.root.rotation = entry.angleRadians

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
        view.sprite.tint = tint
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

function resolveBeltPortExtensionTint(ctx: DecorationSyncContext): number {
  const theme = ctx.workspace.app?.state.theme
  if (theme === undefined) {
    return 0xf59e0b
  }

  return resolveAppThemeColorNumber(theme, theme.renderer.beltTileStrokeColorKey)
}
