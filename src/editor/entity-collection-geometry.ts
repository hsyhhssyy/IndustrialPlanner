import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type {
  EntityCollection,
  EntityCollectionGeometry,
} from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { resolveEntityGridGeometry } from "@/shared/geometry/entity-grid-geometry";

// AI-REMOVED 2026-09-11:
// Reason: 实体 definition 查找、旋转占地与包围盒计算已提取为共享几何能力。
// Trigger: 修复蓝图属性面板只按锚点跨度计算尺寸的问题，并统一各调用方的包围盒语义。
// Evidence: resolveEntityGridGeometry 同时覆盖原 getRotatedGridFootprint 与 getGridBoundingBox 调用链。
// Replacement: src/shared/geometry/entity-grid-geometry.ts resolveEntityGridGeometry
// Risk: Low
// Human Review: Required
//
// Original code:
// import {
//   getGridBoundingBox,
//   getRotatedGridFootprint,
// } from "@/shared/geometry/grid";

import { resolveEntityById } from "./entity-resolvers";

const EPSILON = 1e-9;

export interface EntityCollectionGeometryEntry<EntityT extends WorldEntity = WorldEntity> {
  readonly entity: EntityT;
  readonly definition: EntityDefinition;
  readonly gridRect: GridRect;
}

export interface ResolvedEntityCollectionGeometry extends EntityCollectionGeometry {
  readonly entries: readonly EntityCollectionGeometryEntry[];
}

export function resolveEntityCollectionGeometry(options: {
  collection: EntityCollection | readonly string[];
  document: WorldDocument;
  drafts: readonly WorldEntity[];
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>;
}): ResolvedEntityCollectionGeometry | null {
  const entities: WorldEntity[] = [];

  for (const entityId of options.collection) {
    const entity = resolveEntityById({
      entityId,
      document: options.document,
      drafts: options.drafts,
    });

    if (entity === null) {
      continue;
    }

    entities.push(entity);
  }

  const geometry = resolveEntityGridGeometry({
    entities,
    entityDefinitionMap: options.entityDefinitionMap,
  });
  if (geometry === null) {
    return null;
  }

  const entries: EntityCollectionGeometryEntry[] = geometry.entries.map((entry) => ({
    entity: entry.entity,
    definition: entry.definition,
    gridRect: {
      x: entry.gridArea.position.x,
      y: entry.gridArea.position.y,
      width: entry.gridArea.footprint.width,
      height: entry.gridArea.footprint.height,
    },
  }));

  const boundingBox = {
    x: geometry.boundingBox.left,
    y: geometry.boundingBox.top,
    width: geometry.boundingBox.width,
    height: geometry.boundingBox.height,
  };
  const centerPoint = {
    x: boundingBox.x + boundingBox.width / 2,
    y: boundingBox.y + boundingBox.height / 2,
  };
  const pivotPhaseEntity = resolvePivotPhaseEntity({
    entries,
    document: options.document,
  });

  return {
    boundingBox,
    centerPoint,
    pivotCell: resolvePivotCell({
      centerPoint,
      phase: pivotPhaseEntity?.rotation ?? 0,
    }),
    entries,
  };
}

function resolvePivotPhaseEntity(options: {
  entries: readonly EntityCollectionGeometryEntry[];
  document: WorldDocument;
}): WorldEntity | null {
  const firstEntry = options.entries[0];
  if (firstEntry === undefined) {
    return null;
  }

  const documentOrderIndex = new Map(
    options.document.entityOrder.map((entityId, index) => [entityId, index]),
  );
  const canUseDocumentOrder = options.entries.every(({ entity }) =>
    documentOrderIndex.has(entity.id),
  );

  if (!canUseDocumentOrder) {
    return firstEntry.entity;
  }

  let orderedFirst = firstEntry;
  let orderedFirstIndex = documentOrderIndex.get(firstEntry.entity.id) ?? 0;

  for (const entry of options.entries.slice(1)) {
    const orderIndex = documentOrderIndex.get(entry.entity.id) ?? Number.POSITIVE_INFINITY;
    if (orderIndex < orderedFirstIndex) {
      orderedFirst = entry;
      orderedFirstIndex = orderIndex;
    }
  }

  return orderedFirst.entity;
}

function resolvePivotCell(options: {
  centerPoint: { readonly x: number; readonly y: number };
  phase: WorldEntity["rotation"];
}): GridPoint {
  // pivotCell 是 cell index；cell center 的几何坐标是 index + 0.5。
  const xCandidates = resolveNearestIntegerCandidates(options.centerPoint.x - 0.5);
  const yCandidates = resolveNearestIntegerCandidates(options.centerPoint.y - 0.5);
  const preferRight = options.phase === 90 || options.phase === 180;
  const preferBottom = options.phase === 180 || options.phase === 270;

  return {
    x: pickAxisCandidate(xCandidates, preferRight),
    y: pickAxisCandidate(yCandidates, preferBottom),
  };
}

function resolveNearestIntegerCandidates(value: number): readonly [number] | readonly [number, number] {
  if (isIntegerLike(value)) {
    return [normalizeZero(Math.round(value))];
  }

  return [Math.floor(value), Math.ceil(value)];
}

function pickAxisCandidate(
  candidates: readonly [number] | readonly [number, number],
  preferGreater: boolean,
): number {
  if (candidates.length === 1) {
    return candidates[0];
  }

  return preferGreater
    ? Math.max(candidates[0], candidates[1])
    : Math.min(candidates[0], candidates[1]);
}

function isIntegerLike(value: number): boolean {
  return Math.abs(value - Math.round(value)) < EPSILON;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
