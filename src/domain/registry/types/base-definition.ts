import type { WorldEntity } from "../../document/world-document";
import type { GridPoint, GridRectSize, GridRotation } from "../../shared/grid";

export interface BaseOuterRingDefinition {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

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
  placeableArea: GridRectSize;
  outerRing: BaseOuterRingDefinition;
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
