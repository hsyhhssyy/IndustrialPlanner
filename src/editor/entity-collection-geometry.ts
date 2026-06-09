import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type {
  EntityCollection,
  EntityCollectionGeometry,
} from "@/domain/editor/types/editor-types";
import type { GridPoint, GridRect } from "@/domain/shared/grid";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  getGridBoundingBox,
  getRotatedGridFootprint,
} from "@/shared/geometry/grid";

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
  const entries: EntityCollectionGeometryEntry[] = [];

  for (const entityId of options.collection) {
    const entity = resolveEntityById({
      entityId,
      document: options.document,
      drafts: options.drafts,
    });

    if (entity === null) {
      continue;
    }

    const definition = options.entityDefinitionMap.get(entity.definitionId);

    if (definition === undefined) {
      continue;
    }

    const footprint = getRotatedGridFootprint(
      definition.footprint,
      entity.rotation,
    );

    entries.push({
      entity,
      definition,
      gridRect: {
        x: entity.position.x,
        y: entity.position.y,
        width: footprint.width,
        height: footprint.height,
      },
    });
  }

  const bounds = getGridBoundingBox(
    entries.map(({ gridRect }) => ({
      position: {
        x: gridRect.x,
        y: gridRect.y,
      },
      footprint: {
        width: gridRect.width,
        height: gridRect.height,
      },
    })),
  );

  if (bounds === null) {
    return null;
  }

  const boundingBox = {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
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
  const xCandidates = resolveNearestIntegerCandidates(options.centerPoint.x);
  const yCandidates = resolveNearestIntegerCandidates(options.centerPoint.y);
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