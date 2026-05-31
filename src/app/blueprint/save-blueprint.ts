import {
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { getGridBoundsCenterCells } from "@/shared/geometry/grid";
import {
  saveBlueprintDocument,
  type BlueprintRecord,
  type SaveBlueprintOptions,
} from "@/shared/storage";

export function canSaveSelectionAsBlueprint(workspace: WorkspaceContract): boolean {
  return (workspace.editor?.state.collections.selection.length ?? 0) > 1;
}

export function createSelectionBlueprintDocument(options: {
  workspace: WorkspaceContract;
  name: string;
  description?: string;
}): BlueprintDocument | null {
  const editor = options.workspace.editor;
  if (editor === null) {
    return null;
  }

  const selectionIds = [...editor.state.collections.selection];
  if (selectionIds.length === 0) {
    return null;
  }

  const selectionRect = editor.queries.findEntityCollectionGridRect(EntityCollectionType.selection);
  if (selectionRect === null) {
    return null;
  }

  const currentDocument = editor.document.getSnapshot();
  const selectedIdSet = new Set(selectionIds);
  const entities: Record<string, WorldEntity> = {};
  const entityOrder: string[] = [];

  for (const entityId of currentDocument.entityOrder) {
    if (!selectedIdSet.has(entityId)) {
      continue;
    }

    // 2026-05-31: 防御 entityOrder 重复条目——若当前 entityId 已被前序循环处理过则跳过。
    if (entities[entityId] !== undefined) {
      continue;
    }

    const entity = currentDocument.entities[entityId];
    if (entity === undefined) {
      continue;
    }

    entities[entityId] = cloneWorldEntity(entity);
    entityOrder.push(entityId);
  }

  for (const entityId of selectionIds) {
    if (entities[entityId] !== undefined) {
      continue;
    }

    const entity = editor.queries.getEntityById(entityId);
    if (entity === null || currentDocument.entities[entity.id] === undefined) {
      continue;
    }

    entities[entity.id] = cloneWorldEntity(entity);
    entityOrder.push(entity.id);
  }

  if (entityOrder.length === 0) {
    return null;
  }

  const centerCells = getGridBoundsCenterCells({
    left: selectionRect.x,
    top: selectionRect.y,
    width: selectionRect.width,
    height: selectionRect.height,
  });

  return createBlueprintDocument({
    name: options.name,
    description: options.description,
    baseId: currentDocument.baseId,
    initialGridPoint: {
      x: Math.round(centerCells.x),
      y: Math.round(centerCells.y),
    },
    entities,
    entityOrder,
    slotLinks: currentDocument.slotLinks
      .filter((slotLink) => (
        selectedIdSet.has(slotLink.source.entityId)
        && selectedIdSet.has(slotLink.target.entityId)
      ))
      .map(cloneSlotLinkDefinition),
  });
}

export async function saveSelectionBlueprint(options: {
  workspace: WorkspaceContract;
  name: string;
  description?: string;
  storageOptions?: SaveBlueprintOptions;
}): Promise<BlueprintRecord | null> {
  const blueprintDocument = createSelectionBlueprintDocument({
    workspace: options.workspace,
    name: options.name,
    description: options.description,
  });

  if (blueprintDocument === null) {
    return null;
  }

  return await saveBlueprintDocument(blueprintDocument, options.storageOptions);
}

function cloneWorldEntity(entity: WorldEntity): WorldEntity {
  return {
    ...entity,
    position: {
      ...entity.position,
    },
    config: {
      ...entity.config,
    },
    tags: [...entity.tags],
  };
}

function cloneSlotLinkDefinition(slotLink: SlotLinkDefinition): SlotLinkDefinition {
  return {
    ...slotLink,
    source: {
      ...slotLink.source,
    },
    target: {
      ...slotLink.target,
    },
  };
}