import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  SlotLinkDefinition,
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";
import {
  DARK_PIPE_INLET_STORAGE_GROUP_ID,
  DARK_PIPE_OUTLET_STORAGE_GROUP_ID,
  DARK_PIPE_SLOT_ID,
  findDarkPipeSlotLinkForEntity,
  resolveDarkPipeRole,
  type RegionalDarkPipeEndpoint,
  type RegionalDarkPipeLink,
} from "@/shared/dark-pipe-link";

const MINIMUM_BASE_PARTITION_GAP = 1_024;

/**
 * Dense 区域模式的执行文档。当前基地保留原 ID 与坐标，其余基地只在 Dense 私有执行层改名、平移。
 * 所有文档中的 warehouse 端点保持不变，因此拓扑编译器只创建一个隐藏仓库。
 */
// AI-CORRECTION 2026-09-20: ST2-RQ-036 起所有基地（含单基地）均使用稳定基地作用域 ID；输入顺序决定固定空间分区，当前展示基地不再参与执行文档生成。
export function createDenseRegionalDocument(options: {
  readonly documents: readonly WorldDocument[];
  readonly registry: RegistryContract;
  readonly darkPipeLinks?: readonly RegionalDarkPipeLink[];
}): WorldDocument {
  const orderedDocuments = [...options.documents];
  const rootDocument = orderedDocuments[0];
  if (rootDocument === undefined) {
    throw new Error("Dense execution document requires at least one base document.");
  }

  const partitionStride = resolvePartitionStride(orderedDocuments, options.registry);
  const entities: Record<string, WorldEntity> = {};
  const entityOrder: string[] = [];
  const slotLinks: SlotLinkDefinition[] = [];
  const documentsByBaseId = indexRegionalDocuments(orderedDocuments);

  for (let baseIndex = 0; baseIndex < orderedDocuments.length; baseIndex += 1) {
    const document = orderedDocuments[baseIndex]!;
    const offsetX = partitionStride * baseIndex;
    for (const entityId of document.entityOrder) {
      const entity = document.entities[entityId];
      if (entity === undefined) continue;
      const compositeEntityId = resolveDenseRegionalEntityId(
        document.baseId,
        entity.id,
      );
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
        id: resolveDenseRegionalEntityId(
          document.baseId,
          link.id,
        ),
        source: remapLinkEndpoint(link.source, document.baseId),
        target: remapLinkEndpoint(link.target, document.baseId),
      });
    }
  }

  appendRegionalDarkPipeLinks({
    links: options.darkPipeLinks ?? [],
    documentsByBaseId,
    entities,
    slotLinks,
  });

  const executionBaseId = createDenseExecutionBaseId(orderedDocuments);

  return {
    ...rootDocument,
    baseId: executionBaseId,
    documentKey: executionBaseId,
    meta: { ...rootDocument.meta },
    entities,
    entityOrder,
    slotLinks,
    regions: rootDocument.regions.map((region) => ({ ...region })),
    documentSettings: {
      ...rootDocument.documentSettings,
      viewport: {
        ...rootDocument.documentSettings.viewport,
        center: { ...rootDocument.documentSettings.viewport.center },
      },
    },
  };
}

function indexRegionalDocuments(
  documents: readonly WorldDocument[],
): ReadonlyMap<string, WorldDocument> {
  const documentsByBaseId = new Map<string, WorldDocument>();
  for (const document of documents) {
    if (documentsByBaseId.has(document.baseId)) {
      throw new Error(`Dense regional document contains duplicate base "${document.baseId}".`);
    }
    documentsByBaseId.set(document.baseId, document);
  }
  return documentsByBaseId;
}

function appendRegionalDarkPipeLinks(options: {
  readonly links: readonly RegionalDarkPipeLink[];
  readonly documentsByBaseId: ReadonlyMap<string, WorldDocument>;
  readonly entities: Readonly<Record<string, WorldEntity>>;
  readonly slotLinks: SlotLinkDefinition[];
}): void {
  const occupiedEndpoints = new Set<string>();
  const occupiedLinkIds = new Set(options.slotLinks.map((link) => link.id));

  for (const link of options.links) {
    if (occupiedLinkIds.has(link.id)) {
      throw new Error(`Dense regional dark-pipe link ID "${link.id}" is duplicated.`);
    }
    if (link.inlet.baseId === link.outlet.baseId) {
      throw new Error(`Dense regional dark-pipe link "${link.id}" must connect different bases.`);
    }

    const inletEntity = resolveRegionalDarkPipeEntity(
      link.id,
      "inlet",
      link.inlet,
      options.documentsByBaseId,
    );
    const outletEntity = resolveRegionalDarkPipeEntity(
      link.id,
      "outlet",
      link.outlet,
      options.documentsByBaseId,
    );
    const inletDocument = options.documentsByBaseId.get(link.inlet.baseId)!;
    const outletDocument = options.documentsByBaseId.get(link.outlet.baseId)!;
    const inletKey = createRegionalDarkPipeEndpointKey(link.inlet);
    const outletKey = createRegionalDarkPipeEndpointKey(link.outlet);
    if (occupiedEndpoints.has(inletKey) || occupiedEndpoints.has(outletKey)) {
      throw new Error(`Dense regional dark-pipe link "${link.id}" reuses an occupied endpoint.`);
    }
    if (
      findDarkPipeSlotLinkForEntity(inletDocument, inletEntity.id) !== null
      || findDarkPipeSlotLinkForEntity(outletDocument, outletEntity.id) !== null
    ) {
      throw new Error(`Dense regional dark-pipe link "${link.id}" conflicts with a local dark-pipe link.`);
    }

    const sourceEntityId = remapRegionalEntityId(
      link.outlet,
    );
    const targetEntityId = remapRegionalEntityId(
      link.inlet,
    );
    if (options.entities[sourceEntityId] === undefined || options.entities[targetEntityId] === undefined) {
      throw new Error(`Dense regional dark-pipe link "${link.id}" could not resolve its composite endpoints.`);
    }

    options.slotLinks.push({
      id: link.id,
      linkType: "share-all",
      source: {
        entityId: sourceEntityId,
        storageSlotGroupId: DARK_PIPE_OUTLET_STORAGE_GROUP_ID,
        slotId: DARK_PIPE_SLOT_ID,
      },
      target: {
        entityId: targetEntityId,
        storageSlotGroupId: DARK_PIPE_INLET_STORAGE_GROUP_ID,
        slotId: DARK_PIPE_SLOT_ID,
      },
    });
    occupiedLinkIds.add(link.id);
    occupiedEndpoints.add(inletKey);
    occupiedEndpoints.add(outletKey);
  }
}

function resolveRegionalDarkPipeEntity(
  linkId: string,
  expectedRole: "inlet" | "outlet",
  endpoint: RegionalDarkPipeEndpoint,
  documentsByBaseId: ReadonlyMap<string, WorldDocument>,
): WorldEntity {
  const document = documentsByBaseId.get(endpoint.baseId);
  if (document === undefined) {
    throw new Error(
      `Dense regional dark-pipe link "${linkId}" references missing base "${endpoint.baseId}".`,
    );
  }
  const entity = document.entities[endpoint.entityId];
  if (entity === undefined) {
    throw new Error(
      `Dense regional dark-pipe link "${linkId}" references missing entity "${endpoint.entityId}" in base "${endpoint.baseId}".`,
    );
  }
  if (resolveDarkPipeRole(entity.definitionId) !== expectedRole) {
    throw new Error(
      `Dense regional dark-pipe link "${linkId}" ${expectedRole} endpoint has incompatible definition "${entity.definitionId}".`,
    );
  }
  return entity;
}

function createRegionalDarkPipeEndpointKey(endpoint: RegionalDarkPipeEndpoint): string {
  return `${endpoint.baseId}\u0000${endpoint.entityId}`;
}

function remapRegionalEntityId(
  endpoint: RegionalDarkPipeEndpoint,
): string {
  return resolveDenseRegionalEntityId(
    endpoint.baseId,
    endpoint.entityId,
  );
}

function remapLinkEndpoint(
  endpoint: SlotLinkDefinition["source"],
  baseId: string,
): SlotLinkDefinition["source"] {
  return {
    ...endpoint,
    entityId: isWarehouseEndpoint(endpoint.entityId)
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

export function resolveDenseRegionalEntityId(
  baseId: string,
  localId: string,
): string {
  return createRegionalEntityId(baseId, localId);
}

function createDenseExecutionBaseId(documents: readonly WorldDocument[]): string {
  return `dense-region:${documents
    .map((document) => encodeURIComponent(document.baseId))
    .join("+")}`;
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
