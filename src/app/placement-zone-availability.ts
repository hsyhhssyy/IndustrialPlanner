import type { AppHost } from "@/app/host/app-host";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { ALL_REGION_ENTITIES_BASE_TAG } from "@/shared/base-tags";

// AI-REMOVED 2026-09-25:
// Reason: 地区建筑限制由基地定义与所有已注册地区共同决定，不再由武陵特判。
// Trigger: 草稿箱需接纳现有及未来地区的独有建筑。
// Evidence: BaseDefinition.tag 已标识地区；EntityDefinition.tags 携带武陵地区归属。
// Replacement: canPlaceEntityDefinitionInBase 的通用地区判定。
// Risk: 未标注地区归属的新建筑仍被视为通用建筑。
// Human Review: Required
// Original code:
// const WULING_ZONE_TAG = "武陵";
const UNPLACEABLE_TAG = "不可摆放";

// AI-REMOVED 2026-09-25:
// Reason: 管道工具现在查询当前基地真实可摆放的管道设备。
// Trigger: 草稿箱与未来地区不能依赖武陵专用开关。
// Evidence: hasPlaceableEntityDefinitionInCurrentBase 已统一检查 uiGroup、不可摆放与地区规则。
// Replacement: 各调用方使用 hasPlaceableEntityDefinitionInCurrentBase(appHost, "pipeLogistics")。
// Risk: Low
// Human Review: Required
// Original code:
// export function canCurrentBaseAcceptWulingOnlyEntities(appHost: AppHost): boolean {
//   const currentBaseTag = resolveCurrentBaseTag(appHost);
//
//   return currentBaseTag === null || currentBaseTag === WULING_ZONE_TAG;
// }

export function canPlaceEntityDefinitionInCurrentBase(
  appHost: AppHost,
  definition: EntityDefinition,
): boolean {
  let baseId: string | null = null;
  try {
    const editor = appHost.workspace?.editor;
    baseId = editor?.document.getSnapshot().baseId ?? null;
  } catch {
    baseId = null;
  }

  return canPlaceEntityDefinitionInBase(appHost, definition, baseId);
}

export function canPlaceEntityDefinitionInBase(
  appHost: AppHost,
  definition: EntityDefinition,
  baseId: string | null,
): boolean {
  const baseDefinitions = appHost.workspace.registry.baseDefinitions;
  const baseDefinition = baseDefinitions.find((candidate) => candidate.id === baseId);
  if (baseDefinition === undefined || baseDefinition.tags.includes(ALL_REGION_ENTITIES_BASE_TAG)) {
    return true;
  }

  const regionTags = new Set(baseDefinitions.map((candidate) => candidate.tag));
  const entityRegions = definition.tags.filter((tag) => regionTags.has(tag));
  return entityRegions.length === 0 || entityRegions.includes(baseDefinition.tag);
}

export function hasPlaceableEntityDefinitionInCurrentBase(
  appHost: AppHost,
  uiGroup: EntityDefinition["uiGroup"],
): boolean {
  return appHost.workspace.registry.entityDefinitions.some((definition) =>
    definition.uiGroup === uiGroup
    && !definition.tags.includes(UNPLACEABLE_TAG)
    && canPlaceEntityDefinitionInCurrentBase(appHost, definition),
  );
}

export function canPlaceBlueprintDocumentInCurrentBase(
  appHost: AppHost,
  blueprint: BlueprintDocument,
): boolean {
  const definitionById = new Map(
    appHost.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  return Object.values(blueprint.entities).every((entity) => {
    const definition = definitionById.get(entity.definitionId);

    return definition === undefined
      || canPlaceEntityDefinitionInCurrentBase(appHost, definition);
  });
}

// AI-REMOVED 2026-09-25:
// Reason: 通用地区判定直接按 baseId 获取基地与已注册地区，不再需要武陵专用查询链。
// Trigger: 草稿箱支持所有地区建筑及未来地区自动接入。
// Evidence: canPlaceEntityDefinitionInBase 已使用完整 BaseDefinition。
// Replacement: canPlaceEntityDefinitionInBase。
// Risk: Low
// Human Review: Required
// Original code:
// function isWulingOnlyEntityDefinition(definition: EntityDefinition): boolean {
//   return definition.tags.includes(WULING_ZONE_TAG);
// }
//
// function resolveCurrentBaseTag(appHost: AppHost): string | null {
//   try {
//     const editor = appHost.workspace?.editor;
//     if (editor === null || editor === undefined) {
//       return null;
//     }
//
//     const baseId = editor.document.getSnapshot().baseId;
//     return resolveBaseTag(appHost, baseId);
//   } catch {
//     return null;
//   }
// }
//
// function resolveBaseTag(appHost: AppHost, baseId: string | null): string | null {
//   if (baseId === null) {
//     return null;
//   }
//
//   try {
//     const baseDefinition = appHost.workspace.registry.baseDefinitions.find((definition) =>
//       definition.id === baseId,
//     );
//
//     return baseDefinition?.tag ?? null;
//   } catch {
//     return null;
//   }
// }
