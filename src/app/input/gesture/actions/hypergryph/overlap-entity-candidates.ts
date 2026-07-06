import type { AppHost } from "@/app/host/app-host";
import type { GesturePosition } from "@/app/input/gesture/adapter";
import type { WorldEntity } from "@/domain/document/world-document";
import type { EditorContract } from "@/domain/editor/editor-contract";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { GridPoint } from "@/domain/shared/grid";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";

type EntityCandidateFilter = (entity: WorldEntity) => boolean;

export function resolveOverlappingEntityCandidatesAtClientPoint(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
  pointerEntity: WorldEntity | null;
  filterCandidate?: EntityCandidateFilter;
}): readonly WorldEntity[] {
  const listEntities = resolveListEntitiesFn(options.editor);
  if (listEntities === null) {
    return options.pointerEntity !== null
      && (options.filterCandidate?.(options.pointerEntity) ?? true)
      ? [options.pointerEntity]
      : [];
  }

  const gridCell = options.editor.queries.findGridCellForClientPixelPoint(options.position);
  if (gridCell === null) {
    return [];
  }

  const entityDefinitions = resolveEntityDefinitions(options.appHost);
  if (entityDefinitions === null) {
    return options.pointerEntity !== null
      && (options.filterCandidate?.(options.pointerEntity) ?? true)
      ? [options.pointerEntity]
      : [];
  }

  const entityDefinitionMap = new Map(
    entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );
  const listedEntities = listEntities();
  const candidates: WorldEntity[] = [];

  for (let index = listedEntities.length - 1; index >= 0; index -= 1) {
    const entity = listedEntities[index];
    if (entity === undefined || !(options.filterCandidate?.(entity) ?? true)) {
      continue;
    }

    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    if (!isGridCellInsideEntity({ cell: gridCell, entity, footprint: definition.footprint })) {
      continue;
    }

    if (isSuppressedDedicatedLogisticsEntity(options.appHost, entity.definitionId)) {
      continue;
    }

    candidates.push(entity);
  }

  return candidates;
}

export function openOverlapEntityMenuIfNeeded(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
  pointerEntity: WorldEntity | null;
  filterCandidate?: EntityCandidateFilter;
  onSelect: (entity: WorldEntity) => void;
}): boolean {
  if (resolveOverlapEntityMenu(options.appHost) === null) {
    return false;
  }

  const candidates = resolveOverlappingEntityCandidatesAtClientPoint(options);
  return openOverlapEntityMenuForCandidates({
    appHost: options.appHost,
    editor: options.editor,
    position: options.position,
    candidates,
    onSelect: options.onSelect,
  });
}

export function openOverlapEntityMenuForCandidates(options: {
  appHost: AppHost;
  editor: EditorContract;
  position: GesturePosition;
  candidates: readonly WorldEntity[];
  onSelect: (entity: WorldEntity) => void;
}): boolean {
  const menu = resolveOverlapEntityMenu(options.appHost);
  if (menu === null) {
    return false;
  }

  const candidates = options.candidates;
  if (candidates.length <= 1) {
    return false;
  }

  menu.open({
    position: options.position,
    candidates: candidates.map((entity) => ({
      entityId: entity.id,
      definitionId: entity.definitionId,
    })),
    onSelect: (entityId) => {
      const entity = options.editor.queries.getEntityById(entityId);
      if (entity === null) {
        return;
      }

      options.onSelect(entity);
    },
  });

  return true;
}

function resolveOverlapEntityMenu(
  appHost: AppHost,
): AppHost["overlapEntityMenu"] | null {
  const candidate = (appHost as AppHost & {
    overlapEntityMenu?: AppHost["overlapEntityMenu"];
  }).overlapEntityMenu;

  return candidate !== undefined && typeof candidate.open === "function"
    ? candidate
    : null;
}

function resolveEntityDefinitions(appHost: AppHost): readonly EntityDefinition[] | null {
  const registry = appHost.workspace.registry as AppHost["workspace"]["registry"] & {
    entityDefinitions?: readonly EntityDefinition[];
  };

  return Array.isArray(registry.entityDefinitions) ? registry.entityDefinitions : null;
}

function resolveListEntitiesFn(
  editor: EditorContract,
): (() => readonly WorldEntity[]) | null {
  const queries = (editor as EditorContract & {
    queries?: EditorContract["queries"] & {
      listEntities?: () => readonly WorldEntity[];
    };
  }).queries;

  if (queries === undefined) {
    return null;
  }

  const queriesWithList = queries as EditorContract["queries"] & {
    listEntities?: () => readonly WorldEntity[];
  };

  return typeof queriesWithList.listEntities === "function" ? queriesWithList.listEntities : null;
}

function isSuppressedDedicatedLogisticsEntity(
  appHost: AppHost,
  definitionId: string,
): boolean {
  const editor = appHost.workspace.editor;
  if (editor === null || !appHost.workspace.registry.queries.isDedicatedLogisticsDevice(definitionId)) {
    return false;
  }

  const kind = appHost.workspace.registry.queries.resolveDedicatedLogisticsKind(definitionId);
  return (
    (kind === "belt" && editor.state.suppressBelts)
    || (kind === "pipe" && editor.state.suppressPipes)
  );
}

function isGridCellInsideEntity(options: {
  cell: GridPoint;
  entity: WorldEntity;
  footprint: EntityDefinition["footprint"];
}): boolean {
  const footprint = getRotatedGridFootprint(
    options.footprint,
    options.entity.rotation,
  );

  return (
    options.cell.x >= options.entity.position.x
    && options.cell.x < options.entity.position.x + footprint.width
    && options.cell.y >= options.entity.position.y
    && options.cell.y < options.entity.position.y + footprint.height
  );
}
