import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { GridPoint } from "@/domain/shared/grid";
import type { LogisticsKind, LogisticsPortDirection } from "@/domain/shared/logistics";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

import {
  resolveDevicePortEndpoints,
  resolveEntityGridRect,
  isGridPointInsideRect,
} from "../logistics/logistics-utils";
import { syncPoweredEntityCollection } from "./powered-collection";
import type { EditorActionsContext } from "./types";

type EditorTransportActions = Pick<
  EditorAction,
  "removeTransportComponent" | "removeTransportComponentUpstream" | "removeTransportComponentDownstream"
>;

/**
 * 收集从指定严格物流设备出发、沿同种类链路可达的所有严格物流设备 ID。
 * 使用 BFS 遍历，通过设备端口端点查找邻接的同种类严格物流设备。
 * belt 系与 pipe 系隔离，绝不跨种类传播。
 * @param directions 遍历方向：["input"] 只沿上游，["output"] 只沿下游，["input","output"] 双向遍历
 */
function collectConnectedStrictLogistics(
  startEntityId: string,
  startEntity: WorldEntity,
  kind: LogisticsKind,
  document: WorldDocument,
  entityDefinitionMap: ReadonlyMap<string, EntityDefinition>,
  isDedicatedLogisticsDevice: (definitionId: string) => boolean,
  resolveDedicatedLogisticsKind: (definitionId: string) => LogisticsKind | null,
  directions: readonly LogisticsPortDirection[] = ["input", "output"],
): ReadonlySet<string> {
  const visited = new Set<string>();
  const toDelete = new Set<string>();
  const queue: string[] = [startEntityId];
  visited.add(startEntityId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const entity = currentId === startEntityId
      ? startEntity
      : document.entities[currentId];

    if (entity === undefined) {
      continue;
    }

    if (!isDedicatedLogisticsDevice(entity.definitionId)) {
      continue;
    }
    if (resolveDedicatedLogisticsKind(entity.definitionId) !== kind) {
      continue;
    }

    toDelete.add(currentId);

    const definition = entityDefinitionMap.get(entity.definitionId);
    if (definition === undefined) {
      continue;
    }

    // 收集指定方向的端口端点
    const adjacentCells = new Set<string>();

    for (const direction of directions) {
      const endpoints = resolveDevicePortEndpoints({
        entity,
        definition,
        kind,
        direction,
        pointerGridPoint: entity.position,
      });

      for (const endpoint of endpoints) {
        const key = `${endpoint.outsideGridPoint.x},${endpoint.outsideGridPoint.y}`;
        adjacentCells.add(key);
      }
    }

    // 检查每个邻接格是否有同种类严格物流设备
    for (const key of adjacentCells) {
      const [cx, cy] = key.split(",").map(Number) as [number, number];
      const cellPoint: GridPoint = { x: cx, y: cy };

      for (const [otherId, otherEntity] of Object.entries(document.entities)) {
        if (visited.has(otherId)) {
          continue;
        }

        if (!isDedicatedLogisticsDevice(otherEntity.definitionId)) {
          continue;
        }
        if (resolveDedicatedLogisticsKind(otherEntity.definitionId) !== kind) {
          continue;
        }

        const otherDefinition = entityDefinitionMap.get(otherEntity.definitionId);
        if (otherDefinition === undefined) {
          continue;
        }

        // 检查该实体是否占据 cellPoint
        if (
          isGridPointInsideRect(
            cellPoint,
            resolveEntityGridRect({ entity: otherEntity, definition: otherDefinition }),
          )
        ) {
          visited.add(otherId);
          queue.push(otherId);
        }
      }
    }
  }

  return toDelete;
}

export function createEditorTransportActions(
  context: EditorActionsContext,
): EditorTransportActions {
  const { document, documentWriter, state, workspace } = context;

  const entityDefinitionMap = new Map(
    workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  const removeEntityIdsFromCollections = (entityIds: ReadonlySet<string>) => {
    for (const collectionType of Object.values(EntityCollectionType)) {
      const collection = state.collections[collectionType];

      if (collection.length === 0) {
        continue;
      }

      const nextEntityIds = collection.filter((entityId) => !entityIds.has(entityId));

      if (nextEntityIds.length === collection.length) {
        continue;
      }

      collection.replace(nextEntityIds);
    }
  };

  const removeDirectedTransportComponent = (
    entityId: string,
    directions: readonly LogisticsPortDirection[],
    label: string,
  ) => {
    const currentDocument = document.getSnapshot();
    const entity = currentDocument.entities[entityId];

    if (entity === undefined) {
      return;
    }

    if (!workspace.registry.queries.isDedicatedLogisticsDevice(entity.definitionId)) {
      return;
    }

    const kind = workspace.registry.queries.resolveDedicatedLogisticsKind(
      entity.definitionId,
    );

    if (kind === null) {
      return;
    }

    const toDelete = collectConnectedStrictLogistics(
      entityId,
      entity,
      kind,
      currentDocument,
      entityDefinitionMap,
      workspace.registry.queries.isDedicatedLogisticsDevice.bind(
        workspace.registry.queries,
      ),
      workspace.registry.queries.resolveDedicatedLogisticsKind.bind(
        workspace.registry.queries,
      ),
      directions,
    );

    if (toDelete.size === 0) {
      return;
    }

    const nextEntities = { ...currentDocument.entities };

    for (const deleteId of toDelete) {
      if (nextEntities[deleteId] !== undefined) {
        delete nextEntities[deleteId];
      }
    }

    const committedDocument = documentWriter.commit({
      action: {
        type: "entity.delete",
        label,
        entityIds: Array.from(toDelete),
        definitionIds: [],
        count: toDelete.size,
      },
      update: (documentSnapshot) => ({
        ...documentSnapshot,
        entities: nextEntities,
      }),
    });

    if (committedDocument !== null) {
      syncPoweredEntityCollection({
        document: committedDocument,
        state,
        workspace,
      });
    }

    // 从所有集合中移除已删除的实体
    removeEntityIdsFromCollections(toDelete);
  };

  return {
    removeTransportComponent: (entityId) => {
      removeDirectedTransportComponent(entityId, ["input", "output"], "删除整段");
    },
    removeTransportComponentUpstream: (entityId) => {
      removeDirectedTransportComponent(entityId, ["input"], "删除前段");
    },
    removeTransportComponentDownstream: (entityId) => {
      removeDirectedTransportComponent(entityId, ["output"], "删除后段");
    },
  };
}
