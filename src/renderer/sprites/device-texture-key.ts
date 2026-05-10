import type { AppContract } from "@/domain/app/app-contract"

const DEVICE_SPRITE_PREFIX = "device-sprite-"
const DEVICE_MASK_PREFIX = "device-masks-"
const BLUEPRINT_SPRITE_PREFIX = "blueprint-sprite-"
const BLUEPRINT_MASK_PREFIX = "blueprint-masks-"
const TOP_VIEW_AVATAR_PREFIX = "top-view-avatar-"
const BLUEPRINT_AVATAR_PREFIX = "blueprint-avatar-"

export function readSimplifiedDeviceIconPreference(app: AppContract | null): boolean {
  return app?.state.settings.gameUseSimplifiedDeviceIcons ?? false
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
  entityDefinitionId: string,
  app: AppContract | null,
): string {
  return `${readSimplifiedDeviceIconPreference(app)
    ? BLUEPRINT_AVATAR_PREFIX
    : TOP_VIEW_AVATAR_PREFIX}${entityDefinitionId}`
}