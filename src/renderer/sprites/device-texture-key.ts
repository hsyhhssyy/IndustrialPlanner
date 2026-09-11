import type { AppContract } from "@/domain/app/app-contract"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"

const DEVICE_SPRITE_PREFIX = "device-sprite-"
const DEVICE_MASK_PREFIX = "device-masks-"
const BLUEPRINT_SPRITE_PREFIX = "blueprint-sprite-"
const BLUEPRINT_MASK_PREFIX = "blueprint-masks-"
// AI-REMOVED 2026-09-11:
// Reason: “显示设备图标”统一使用蓝图 avatar，不再按设备本体样式选择俯视 avatar。
// Trigger: 用户要求开启“显示设备图标”后使用设备的蓝图 avatar。
// Evidence: public/blueprint-view/avatar 已完整覆盖现有 public/3d-top-view/avatar；TextureManager 已支持 blueprint-avatar key。
// Replacement: resolveDeviceLabelIconTextureKey 中固定使用 BLUEPRINT_AVATAR_PREFIX。
// Risk: Low；设备本体保持俯视样式时，标签图标也会改为蓝图 avatar。
// Human Review: Required
//
// Original code:
// const TOP_VIEW_AVATAR_PREFIX = "top-view-avatar-"
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
  _app: AppContract | null,
): string {
  // AI-REMOVED 2026-09-11:
  // Reason: 标签图标不再跟随设备本体样式切换，统一使用蓝图 avatar。
  // Trigger: 用户要求开启“显示设备图标”后使用设备的蓝图 avatar。
  // Evidence: resolveDeviceLabelIconTextureKey 仅供设备标签使用，蓝图 avatar 资源覆盖完整。
  // Replacement: 下方固定的 BLUEPRINT_AVATAR_PREFIX 返回值。
  // Risk: Low；关闭蓝图本体样式时，标签仍会使用蓝图 avatar。
  // Human Review: Required
  //
  // Original code:
  // return `${readSimplifiedDeviceIconPreference(app)
  //   ? BLUEPRINT_AVATAR_PREFIX
  //   : TOP_VIEW_AVATAR_PREFIX}${spriteId}`
  return `${BLUEPRINT_AVATAR_PREFIX}${spriteId}`
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
