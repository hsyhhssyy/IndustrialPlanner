import {
  Rectangle,
  Texture,
} from "pixi.js"

/** 物品图标从源纹理四边向内裁切的整像素数。显示尺寸仍由世界缩放决定。 */
export const ITEM_ICON_TEXTURE_INSET_PX = 2

/**
 * 统一裁掉物品图标源纹理四周的透明留白。
 *
 * 裁切只改变 Texture frame，不修改底层纹理资源；调用方仍负责设置最终世界显示尺寸。
 */
export function createInsetItemIconTexture(texture: Texture): Texture {
  const frame = texture.frame
  if (
    frame === undefined
    || !Number.isFinite(frame.width)
    || !Number.isFinite(frame.height)
  ) {
    return texture
  }

  const normalizedInsetPx = Math.max(0, Math.round(ITEM_ICON_TEXTURE_INSET_PX))
  const maxHorizontalInset = Math.max(0, Math.floor((frame.width - 1) / 2))
  const maxVerticalInset = Math.max(0, Math.floor((frame.height - 1) / 2))
  const safeInset = Math.min(normalizedInsetPx, maxHorizontalInset, maxVerticalInset)
  if (safeInset <= 0) {
    return texture
  }

  const width = frame.width - safeInset * 2
  const height = frame.height - safeInset * 2

  return new Texture({
    source: texture.source,
    label: texture.label,
    frame: new Rectangle(
      frame.x + safeInset,
      frame.y + safeInset,
      width,
      height,
    ),
    orig: new Rectangle(0, 0, width, height),
    defaultAnchor: texture.defaultAnchor,
    defaultBorders: texture.defaultBorders,
    rotate: texture.rotate,
  })
}
