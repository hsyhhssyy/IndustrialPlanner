import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import {
  areGridRectsIntersecting,
  resolveEntityGridRect,
  resolvePowerRangeGridRect,
} from "@/shared/geometry/power-range";

import { resolveListedEntities } from "../entity-resolvers";
import type { EditorStateReadWrite } from "../state-impl";

export function syncPoweredEntityCollection(options: {
  document: WorldDocument;
  state: EditorStateReadWrite;
  workspace: WorkspaceContract;
}): void {
  const definitionMap = new Map(
    options.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const entities = resolveOrderedDocumentEntities({
    document: options.document,
    workspace: options.workspace,
  });
  const powerRangeRects = entities.flatMap((entity) => {
    const definition = definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    const gridRect = resolvePowerRangeGridRect({
      entity,
      definition,
    });

    return gridRect === null ? [] : [gridRect];
  });

  if (powerRangeRects.length === 0) {
    options.state.collections[EntityCollectionType.powered].replace([]);
    return;
  }

  const poweredEntityIds = entities.flatMap((entity) => {
    const definition = definitionMap.get(entity.definitionId);
    if (definition === undefined) {
      return [];
    }

    return isEntityInPowerRange({
      entity,
      definition,
      powerRangeRects,
    }) ? [entity.id] : [];
  });

  options.state.collections[EntityCollectionType.powered].replace(poweredEntityIds);
}

function resolveOrderedDocumentEntities(options: {
  document: WorldDocument;
  workspace: WorkspaceContract;
}): readonly WorldEntity[] {
  return resolveListedEntities({
    document: options.document,
    drafts: [],
    baseDefinitions: options.workspace.registry.baseDefinitions,
  });
}

function isEntityInPowerRange(options: {
  entity: WorldEntity;
  definition: EntityDefinition;
  powerRangeRects: readonly ReturnType<typeof resolveEntityGridRect>[];
}): boolean {
  const entityGridRect = resolveEntityGridRect({
    entity: options.entity,
    definition: options.definition,
  });

  return options.powerRangeRects.some((powerRangeRect) =>
    areGridRectsIntersecting(entityGridRect, powerRangeRect),
  );
}