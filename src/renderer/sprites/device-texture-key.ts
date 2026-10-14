import type { AppContract } from "@/domain/app/app-contract"
import type { EntityDefinition } from "@/domain/registry/types/entity-definition"
import type { WorkspaceContract } from "@/domain/document/workspace-contract"
import { EntityCollectionType } from "@/domain/editor/types/editor-types"

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
// AI-CORRECTION 2026-09-12: 标签 avatar 已按用户要求改由 public/3d-top-view/avatar 提供白色右下投影版本。
const TOP_VIEW_AVATAR_PREFIX = "top-view-avatar-"
// AI-REMOVED 2026-09-12:
// Reason: 蓝图 avatar 保持灰色蓝图语义，不再承担通用设备标签图标职责。
// Trigger: 用户要求将白色右下投影版本放入现有 3D View avatar 目录并用于设备标签。
// Evidence: TextureManager 的 top-view-avatar key 已直接映射 public/3d-top-view/avatar；新发布脚本为该目录生成完整资源。
// Replacement: TOP_VIEW_AVATAR_PREFIX 与 public/3d-top-view/avatar。
// Risk: Low；标签图标不再读取 public/blueprint-view/avatar。
// Human Review: Required
//
// Original code:
// const BLUEPRINT_AVATAR_PREFIX = "blueprint-avatar-"

export function readSimplifiedDeviceIconPreference(app: AppContract | null): boolean {
  return app?.state.settings.gameUseBlueprintStyleDeviceImages ?? false
}

export function isDeviceLogisticsEndpoint(entityId: string, workspace: Pick<WorkspaceContract, "editor">): boolean {
  const draft = workspace.editor?.queries?.resolveLogisticsDraftState?.()
  return (draft?.source?.type === "device-port" && draft.source.entityId === entityId)
    || (draft?.target?.type === "device-port" && draft.target.entityId === entityId)
}

/** 物流设备的预览及连线端点统一使用蓝图素材，不包含传送带节和管道节。 */
export function shouldForceBlueprintDeviceTexture(
  entityId: string,
  definitionId: string,
  queries: WorkspaceContract["registry"]["queries"],
  workspace: Pick<WorkspaceContract, "editor">,
): boolean {
  if (!queries.isBeltLogistics(definitionId) && !queries.isPipeLogistics(definitionId)) {
    return false
  }
  return (workspace.editor?.state.collections[EntityCollectionType.preview]?.contains(entityId) ?? false)
    || isDeviceLogisticsEndpoint(entityId, workspace)
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
  // AI-CORRECTION 2026-09-12: 标签固定使用 3D View 目录内的白色右下投影 avatar，不再跟随蓝图本体样式。
  return `${TOP_VIEW_AVATAR_PREFIX}${spriteId}`
}

/** 本体素材与动画资格由同一入口决定，蓝图图片始终优先。 */
/** AI-CORRECTION 2026-10-06: 同时返回对应素材的绘图范围，避免强制蓝图预览套用俯视素材的扩展画布。 */
export function resolveDeviceBodyPresentation(
  definition: EntityDefinition,
  app: AppContract | null,
  options: { forceBlueprint: boolean; allowAnimation: boolean; visualKey?: string | null },
) {
  const blueprint = options.forceBlueprint || readSimplifiedDeviceIconPreference(app)
  const stateSpriteId = options.visualKey ? `${definition.spriteId}--${options.visualKey}` : definition.spriteId
  return {
    blueprint,
    spriteOffset: blueprint ? definition.spriteOffset?.blueprint : definition.spriteOffset?.topView,
    bodyTextureKey: blueprint
      ? `${BLUEPRINT_SPRITE_PREFIX}${definition.spriteId}`
      : `${DEVICE_SPRITE_PREFIX}${stateSpriteId}`,
    maskTextureKey: blueprint
      ? `${BLUEPRINT_MASK_PREFIX}${definition.spriteId}`
      : `${DEVICE_MASK_PREFIX}${stateSpriteId}`,
    animation: !blueprint && options.allowAnimation && app?.state.settings.gamePlayDeviceAnimations
      ? definition.spriteAnimation ?? null
      : null,
  }
}
