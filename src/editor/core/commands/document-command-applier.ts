import type { DocumentCommand } from "@/editor/core/commands/document-command";
import type {
  WorldDocument,
  WorldEntity,
} from "@/domain/document/world-document";

function touchWorldDocument(
  document: WorldDocument,
  patch: Partial<Omit<WorldDocument, "meta">> & {
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

function patchWorldEntity(
  document: WorldDocument,
  entityId: string,
  patch: Partial<WorldEntity>,
): WorldDocument {
  const entity = document.entities[entityId];

  if (!entity) {
    return document;
  }

  return touchWorldDocument(document, {
    entities: {
      ...document.entities,
      [entityId]: {
        ...entity,
        ...patch,
      },
    },
  });
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
      });
    }
    case "entity.move": {
      return patchWorldEntity(document, command.payload.entityId, {
        position: command.payload.position,
      });
    }
    case "entity.rotate": {
      return patchWorldEntity(document, command.payload.entityId, {
        ...(command.payload.position
          ? { position: command.payload.position }
          : {}),
        rotation: command.payload.rotation,
      });
    }
    case "entity.config.patch": {
      const entity = document.entities[command.payload.entityId];

      if (!entity) {
        return document;
      }

      return patchWorldEntity(document, command.payload.entityId, {
        config: {
          ...entity.config,
          ...command.payload.patch,
        },
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
        explicitLinks: [
          ...document.explicitLinks,
          {
            id: linkId,
            kind,
            sourceEntityId,
            targetEntityId,
          },
        ],
      });
    }
    case "link.remove": {
      const { linkId } = command.payload;

      if (!document.explicitLinks.some((link) => link.id === linkId)) {
        return document;
      }

      return touchWorldDocument(document, {
        explicitLinks: document.explicitLinks.filter((link) => link.id !== linkId),
      });
    }
    default: {
      return document;
    }
  }
}
