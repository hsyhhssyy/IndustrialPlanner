import type { AppContract } from "@/domain/app/app-contract"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"

const DEVICE_SPRITE_PREFIX = "device-sprite-"
const DEVICE_MASK_PREFIX = "device-masks-"
const BLUEPRINT_SPRITE_PREFIX = "blueprint-sprite-"
const BLUEPRINT_MASK_PREFIX = "blueprint-masks-"
const TOP_VIEW_AVATAR_PREFIX = "top-view-avatar-"
const BLUEPRINT_AVATAR_PREFIX = "blueprint-avatar-"

export function readSimplifiedDeviceIconPreference(app: AppContract | null): boolean {
  return app?.state.settings.gameUseBlueprintStyleDeviceImages ?? false
}

export function resolveDeviceBodyTextureKey(
  spriteId: string,
  app: AppContract | null,
): string {
  return `${readSimplifiedDeviceIconPreference(app)
    ? BLUEPRINT_SPRITE_PREFIX
    : DEVICE_SPRITE_PREFIX}${spriteId}`
}

export function resolveDeviceMaskTextureKey(
  spriteId: string,
  app: AppContract | null,
): string {
  return `${readSimplifiedDeviceIconPreference(app)
    ? BLUEPRINT_MASK_PREFIX
    : DEVICE_MASK_PREFIX}${spriteId}`
}

export function resolveDeviceLabelIconTextureKey(
  spriteId: string,
  app: AppContract | null,
): string {
  return `${readSimplifiedDeviceIconPreference(app)
    ? BLUEPRINT_AVATAR_PREFIX
    : TOP_VIEW_AVATAR_PREFIX}${spriteId}`
}

/** 本体素材与动画资格由同一入口决定，蓝图图片始终优先。 */
export function resolveDeviceBodyPresentation(
  definition: EntityDefinition,
  app: AppContract | null,
  options: { forceBlueprint: boolean; allowAnimation: boolean },
) {
  const blueprint = options.forceBlueprint || readSimplifiedDeviceIconPreference(app)
  return {
    bodyTextureKey: blueprint
      ? `${BLUEPRINT_SPRITE_PREFIX}${definition.spriteId}`
      : `${DEVICE_SPRITE_PREFIX}${definition.spriteId}`,
    maskTextureKey: blueprint
      ? `${BLUEPRINT_MASK_PREFIX}${definition.spriteId}`
      : `${DEVICE_MASK_PREFIX}${definition.spriteId}`,
    animation: !blueprint && options.allowAnimation && app?.state.settings.gamePlayDeviceAnimations
      ? definition.spriteAnimation ?? null
      : null,
  }
}
