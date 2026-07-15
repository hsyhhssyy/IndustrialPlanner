import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import type { LogisticsKind, LogisticsPortDirection } from "@/domain/shared/logistics";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import { collectConnectedStrictLogisticsEntityIds } from "@/shared/transport-component";

import { action } from "mobx";
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
  return collectConnectedStrictLogisticsEntityIds({
    startEntityId,
    startEntity,
    kind,
    document,
    entityDefinitionMap,
    isDedicatedLogisticsDevice,
    resolveDedicatedLogisticsKind,
    directions,
  });
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

    documentWriter.commit({
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

    // 从所有集合中移除已删除的实体
    removeEntityIdsFromCollections(toDelete);
  };

  return {
    removeTransportComponent: action((entityId) => {
      removeDirectedTransportComponent(entityId, ["input", "output"], "删除整段");
    }),
    removeTransportComponentUpstream: action((entityId) => {
      removeDirectedTransportComponent(entityId, ["input"], "删除前段");
    }),
    removeTransportComponentDownstream: action((entityId) => {
      removeDirectedTransportComponent(entityId, ["output"], "删除后段");
    }),
  };
}
