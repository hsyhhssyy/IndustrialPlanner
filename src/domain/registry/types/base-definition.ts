import type { WorldEntity } from "../../document/world-document";
import type { GridPoint, GridRotation } from "../../shared/grid";
import type { SceneAreaDefinition } from "../../shared/scene-space";

// AI-REMOVED 2026-11-12:
// Reason: 空间改为逐区域、逐方向可无界的唯一模型。
// Trigger: REQ-048 已确认的 D1 契约迁移。
// Evidence: 旧主区域加分区结构不能表达分方向无界。
// Replacement: src/domain/shared/scene-space.ts
// Risk: 消费者必须同步迁移；保留既有有限区域身份与世界坐标。
// Human Review: Required
//
// Original code:
// export interface BaseOuterRingDefinition {
//   top: number;
//   right: number;
//   bottom: number;
//   left: number;
// }
//
// export interface BaseSubAreaDefinition {
//   readonly id: string;
//   /** 配置名牌文字时显示；未配置时不显示名牌。 */
//   readonly nameplate?: string;
//   readonly position: GridPoint;
//   readonly placeableArea: GridRectSize;
//   readonly outerRing: BaseOuterRingDefinition;
// }

export interface BaseBuiltinEntityDefinition {
  readonly id: string;
  readonly definitionId: string;
  readonly position: GridPoint;
  readonly rotation: GridRotation;
  readonly config?: Record<string, unknown>;
}

export interface BaseDefinition {
  id: string;
  name: string;
  // AI-REMOVED 2026-11-12:
  // Reason: 空间改为逐区域、逐方向可无界的唯一模型。
  // Trigger: REQ-048 已确认的 D1 契约迁移。
  // Evidence: 旧主区域加分区结构不能表达分方向无界。
  // Replacement: BaseDefinition.areas（名牌移到对应区域）
  // Risk: 消费者必须同步迁移；保留既有有限区域身份与世界坐标。
  // Human Review: Required
  //
  // Original code:
  //   /** 主区域的名牌文字，可与基地选择入口名称不同；未配置时不显示。 */
  //   readonly nameplate?: string;
  //   placeableArea: GridRectSize;
  //   outerRing: BaseOuterRingDefinition;
  //   readonly subAreas?: readonly BaseSubAreaDefinition[];
  readonly areas: readonly SceneAreaDefinition[];
  tag: string;
  /** 语义标签，如 "maxPipeLogistics=128"。新增于 2026-07-25。 */
  tags: string[];
  readonly builtinEntities?: readonly BaseBuiltinEntityDefinition[];
}

export const BASE_BUILTIN_ENTITY_ID_PREFIX = "base-builtin:";

export function buildBaseBuiltinEntityId(options: {
  readonly baseId: string;
  readonly builtinEntityId: string;
}): string {
  return `${BASE_BUILTIN_ENTITY_ID_PREFIX}${options.baseId}:${options.builtinEntityId}`;
}

export function isBaseBuiltinEntityId(entityId: string): boolean {
  return entityId.startsWith(BASE_BUILTIN_ENTITY_ID_PREFIX);
}

export function resolveBaseDefinitionById(options: {
  readonly baseDefinitions: readonly BaseDefinition[];
  readonly baseId: string;
}): BaseDefinition | null {
  return options.baseDefinitions.find((definition) =>
    definition.id === options.baseId,
  ) ?? null;
}

export function resolveBaseBuiltinEntities(options: {
  readonly baseDefinitions: readonly BaseDefinition[];
  readonly baseId: string;
}): WorldEntity[] {
  const baseDefinition = resolveBaseDefinitionById(options);
  if (baseDefinition?.builtinEntities === undefined) {
    return [];
  }

  return baseDefinition.builtinEntities.map((entity) => ({
    id: buildBaseBuiltinEntityId({
      baseId: baseDefinition.id,
      builtinEntityId: entity.id,
    }),
    definitionId: entity.definitionId,
    position: { ...entity.position },
    rotation: entity.rotation,
    config: { ...(entity.config ?? {}) },
    tags: [],
  }));
}
