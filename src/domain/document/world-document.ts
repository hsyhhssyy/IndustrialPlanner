import type { DocumentCommand } from "@/domain/document/document-command";

export type GridRotation = 0 | 90 | 180 | 270;

export interface GridPoint {
  x: number;
  y: number;
}

export interface WorldEntity {
  id: string;
  definitionId: string;
  position: GridPoint;
  rotation: GridRotation;
  config: Record<string, unknown>;
  tags: string[];
}

export interface ExplicitLink {
  id: string;
  kind: "dark-pipe";
  sourceEntityId: string;
  targetEntityId: string;
}

export interface WorldDocument {
  schemaVersion: number;
  meta: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  entities: Record<string, WorldEntity>;
  entityOrder: string[];
  explicitLinks: ExplicitLink[];
  documentSettings: {
    gridSize: number;
    showDiagnostics: boolean;
  };
}

const STAGE1_BOOTSTRAP_TIMESTAMP = "2026-03-30T00:00:00.000Z";

function touchWorldDocument(
  document: WorldDocument,
  patch: Omit<WorldDocument, "meta"> & {
    meta?: Partial<WorldDocument["meta"]>;
  },
): WorldDocument {
  return {
    ...document,
    ...patch,
    meta: {
      ...document.meta,
      ...patch.meta,
      updatedAt: new Date().toISOString(),
    },
  };
}

function toIdPrefix(definitionId: string): string {
  return definitionId
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function createWorldEntityId(
  document: WorldDocument,
  definitionId: string,
): string {
  const prefix = toIdPrefix(definitionId);
  let index = 1;

  while (document.entities[`${prefix}-${index}`]) {
    index += 1;
  }

  return `${prefix}-${index}`;
}

export function createExplicitLinkId(
  document: WorldDocument,
  kind: ExplicitLink["kind"],
): string {
  const prefix = `${kind}-link`;
  let index = 1;

  while (document.explicitLinks.some((link) => link.id === `${prefix}-${index}`)) {
    index += 1;
  }

  return `${prefix}-${index}`;
}

export function getEntityLinks(
  document: WorldDocument,
  entityId: string,
): ExplicitLink[] {
  return document.explicitLinks.filter(
    (link) =>
      link.sourceEntityId === entityId || link.targetEntityId === entityId,
  );
}

export function getExplicitLinkBetween(
  document: WorldDocument,
  sourceEntityId: string,
  targetEntityId: string,
): ExplicitLink | null {
  return (
    document.explicitLinks.find(
      (link) =>
        link.sourceEntityId === sourceEntityId &&
        link.targetEntityId === targetEntityId,
    ) ?? null
  );
}

export function applyWorldDocumentCommand(
  document: WorldDocument,
  command: DocumentCommand,
): WorldDocument {
  switch (command.type) {
    case "entity.place": {
      const { entityId, definitionId, position, rotation, config, tags } =
        command.payload;

      if (document.entities[entityId]) {
        return document;
      }

      return touchWorldDocument(document, {
        entities: {
          ...document.entities,
          [entityId]: {
            id: entityId,
            definitionId,
            position,
            rotation,
            config: { ...config },
            tags: [...tags],
          },
        },
        entityOrder: [...document.entityOrder, entityId],
        explicitLinks: document.explicitLinks,
        documentSettings: document.documentSettings,
        schemaVersion: document.schemaVersion,
      });
    }
    case "entity.remove": {
      const { entityId } = command.payload;

      if (!document.entities[entityId]) {
        return document;
      }

      const nextEntities = { ...document.entities };
      delete nextEntities[entityId];

      return touchWorldDocument(document, {
        entities: nextEntities,
        entityOrder: document.entityOrder.filter((id) => id !== entityId),
        explicitLinks: document.explicitLinks.filter(
          (link) =>
            link.sourceEntityId !== entityId && link.targetEntityId !== entityId,
        ),
        documentSettings: document.documentSettings,
        schemaVersion: document.schemaVersion,
      });
    }
    case "entity.move": {
      const { entityId, position } = command.payload;
      const entity = document.entities[entityId];

      if (!entity) {
        return document;
      }

      return touchWorldDocument(document, {
        entities: {
          ...document.entities,
          [entityId]: {
            ...entity,
            position,
          },
        },
        entityOrder: document.entityOrder,
        explicitLinks: document.explicitLinks,
        documentSettings: document.documentSettings,
        schemaVersion: document.schemaVersion,
      });
    }
    case "entity.rotate": {
      const { entityId, rotation } = command.payload;
      const entity = document.entities[entityId];

      if (!entity) {
        return document;
      }

      return touchWorldDocument(document, {
        entities: {
          ...document.entities,
          [entityId]: {
            ...entity,
            rotation,
          },
        },
        entityOrder: document.entityOrder,
        explicitLinks: document.explicitLinks,
        documentSettings: document.documentSettings,
        schemaVersion: document.schemaVersion,
      });
    }
    case "entity.config.patch": {
      const { entityId, patch } = command.payload;
      const entity = document.entities[entityId];

      if (!entity) {
        return document;
      }

      return touchWorldDocument(document, {
        entities: {
          ...document.entities,
          [entityId]: {
            ...entity,
            config: {
              ...entity.config,
              ...patch,
            },
          },
        },
        entityOrder: document.entityOrder,
        explicitLinks: document.explicitLinks,
        documentSettings: document.documentSettings,
        schemaVersion: document.schemaVersion,
      });
    }
    case "link.create": {
      const { linkId, kind, sourceEntityId, targetEntityId } = command.payload;

      if (
        sourceEntityId === targetEntityId ||
        !document.entities[sourceEntityId] ||
        !document.entities[targetEntityId] ||
        document.explicitLinks.some(
          (link) =>
            link.sourceEntityId === sourceEntityId &&
            link.targetEntityId === targetEntityId &&
            link.kind === kind,
        )
      ) {
        return document;
      }

      return touchWorldDocument(document, {
        entities: document.entities,
        entityOrder: document.entityOrder,
        explicitLinks: [
          ...document.explicitLinks,
          {
            id: linkId,
            kind,
            sourceEntityId,
            targetEntityId,
          },
        ],
        documentSettings: document.documentSettings,
        schemaVersion: document.schemaVersion,
      });
    }
    case "link.remove": {
      const { linkId } = command.payload;

      if (!document.explicitLinks.some((link) => link.id === linkId)) {
        return document;
      }

      return touchWorldDocument(document, {
        entities: document.entities,
        entityOrder: document.entityOrder,
        explicitLinks: document.explicitLinks.filter((link) => link.id !== linkId),
        documentSettings: document.documentSettings,
        schemaVersion: document.schemaVersion,
      });
    }
    default: {
      return document;
    }
  }
}

export function createStage1SeedWorldDocument(): WorldDocument {
  const entities: Record<string, WorldEntity> = {
    "storage-1": {
      id: "storage-1",
      definitionId: "item_port_storager_1",
      position: { x: 3, y: 4 },
      rotation: 0,
      config: {
        submitToWarehouse: true,
      },
      tags: ["stage1-seed"],
    },
    "bus-source-1": {
      id: "bus-source-1",
      definitionId: "item_port_log_hongs_bus_source",
      position: { x: 7, y: 4 },
      rotation: 0,
      config: {},
      tags: ["stage1-seed"],
    },
    "reactor-1": {
      id: "reactor-1",
      definitionId: "item_port_mix_pool_1",
      position: { x: 12, y: 6 },
      rotation: 0,
      config: {
        selectedRecipeIds: [
          "r_mix_pool_liquid_plant_grass_2_from_powder_and_water_basic",
        ],
      },
      tags: ["stage1-seed"],
    },
    "filler-1": {
      id: "filler-1",
      definitionId: "item_port_liquid_filling_pd_mc_1",
      position: { x: 18, y: 6 },
      rotation: 90,
      config: {},
      tags: ["stage1-seed"],
    },
    "dark-outlet-1": {
      id: "dark-outlet-1",
      definitionId: "item_port_udpipe_unloader_1",
      position: { x: 12, y: 2 },
      rotation: 180,
      config: {
        selectedLiquidItemId: "item_liquid_water",
      },
      tags: ["stage1-seed"],
    },
  };

  return {
    schemaVersion: 1,
    meta: {
      id: "stage1-seed",
      name: "Stage1 Scaffold Seed",
      createdAt: STAGE1_BOOTSTRAP_TIMESTAMP,
      updatedAt: STAGE1_BOOTSTRAP_TIMESTAMP,
    },
    entities,
    entityOrder: Object.keys(entities),
    explicitLinks: [],
    documentSettings: {
      gridSize: 56,
      showDiagnostics: true,
    },
  };
}
