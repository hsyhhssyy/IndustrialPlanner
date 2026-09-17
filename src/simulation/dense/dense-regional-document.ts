import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";

const MINIMUM_BASE_PARTITION_GAP = 1_024;

/**
 * Dense 区域模式的执行文档。当前基地保留原 ID 与坐标，其余基地只在 Dense 私有执行层改名、平移。
 * 所有文档中的 warehouse 端点保持不变，因此拓扑编译器只创建一个隐藏仓库。
 */
export function createDenseRegionalDocument(options: {
  readonly currentBaseId: string;
  readonly documents: readonly WorldDocument[];
  readonly registry: RegistryContract;
}): WorldDocument {
  const currentDocument = options.documents.find(
    (document) => document.baseId === options.currentBaseId,
  );
  if (currentDocument === undefined) {
    throw new Error(`Dense regional document is missing current base "${options.currentBaseId}".`);
  }

  const orderedDocuments = [
    currentDocument,
    ...options.documents.filter((document) => document !== currentDocument),
  ];
  const partitionStride = resolvePartitionStride(orderedDocuments, options.registry);
  const entities: Record<string, WorldEntity> = {};
  const entityOrder: string[] = [];
  const slotLinks: SlotLinkDefinition[] = [];

  for (let baseIndex = 0; baseIndex < orderedDocuments.length; baseIndex += 1) {
    const document = orderedDocuments[baseIndex]!;
    const isCurrentBase = document.baseId === options.currentBaseId;
    const offsetX = isCurrentBase ? 0 : partitionStride * baseIndex;
    for (const entityId of document.entityOrder) {
      const entity = document.entities[entityId];
      if (entity === undefined) continue;
      const compositeEntityId = isCurrentBase
        ? entity.id
        : createRegionalEntityId(document.baseId, entity.id);
      if (entities[compositeEntityId] !== undefined) {
        throw new Error(`Dense regional document contains duplicate entity "${compositeEntityId}".`);
      }
      entities[compositeEntityId] = {
        ...entity,
        id: compositeEntityId,
        position: {
          x: entity.position.x + offsetX,
          y: entity.position.y,
        },
        config: { ...entity.config },
        tags: [...entity.tags],
      };
      entityOrder.push(compositeEntityId);
    }
    for (const link of document.slotLinks) {
      slotLinks.push({
        ...link,
        id: isCurrentBase
          ? link.id
          : createRegionalEntityId(document.baseId, link.id),
        source: remapLinkEndpoint(link.source, document.baseId, isCurrentBase),
        target: remapLinkEndpoint(link.target, document.baseId, isCurrentBase),
      });
    }
  }

  return {
    ...currentDocument,
    documentKey: `dense-regional:${currentDocument.documentKey}`,
    meta: { ...currentDocument.meta },
    entities,
    entityOrder,
    slotLinks,
    regions: currentDocument.regions.map((region) => ({ ...region })),
    documentSettings: {
      ...currentDocument.documentSettings,
      viewport: {
        ...currentDocument.documentSettings.viewport,
        center: { ...currentDocument.documentSettings.viewport.center },
      },
    },
  };
}

function remapLinkEndpoint(
  endpoint: SlotLinkDefinition["source"],
  baseId: string,
  isCurrentBase: boolean,
): SlotLinkDefinition["source"] {
  return {
    ...endpoint,
    entityId: isWarehouseEndpoint(endpoint.entityId) || isCurrentBase
      ? endpoint.entityId
      : createRegionalEntityId(baseId, endpoint.entityId),
  };
}

function isWarehouseEndpoint(entityId: string): boolean {
  return entityId === "warehouse" || entityId.startsWith("warehouse:");
}

function createRegionalEntityId(baseId: string, localId: string): string {
  return `dense-base:${encodeURIComponent(baseId)}:${localId}`;
}

function resolvePartitionStride(
  documents: readonly WorldDocument[],
  registry: RegistryContract,
): number {
  let minX = 0;
  let maxX = 0;
  for (const document of documents) {
    for (const entity of Object.values(document.entities)) {
      minX = Math.min(minX, entity.position.x);
      maxX = Math.max(maxX, entity.position.x);
    }
  }
  const maxFootprint = registry.entityDefinitions.reduce(
    (maximum, definition) => Math.max(
      maximum,
      definition.footprint.width,
      definition.footprint.height,
      definition.powerRange ?? 0,
    ),
    0,
  );
  const maxGasRange = registry.recipeDefinitions.reduce(
    (maximum, definition) => Math.max(
      maximum,
      definition.gasDiffusionOutput?.range ?? 0,
    ),
    0,
  );
  const gap = Math.max(
    MINIMUM_BASE_PARTITION_GAP,
    Math.ceil(maxFootprint + maxGasRange + 2),
  );
  return Math.max(1, Math.ceil(maxX - minX + 1 + gap));
}
