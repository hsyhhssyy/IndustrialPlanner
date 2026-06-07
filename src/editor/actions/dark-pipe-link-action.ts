import type { EditorAction } from "@/domain/editor/editor-action";
import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import {
  createDarkPipeSlotLink,
  findDarkPipeSlotLinkForEntity,
  getDarkPipeManualRecipeOnlyPatch,
  isEntityInDarkPipeLink,
  resolveDarkPipeRole,
} from "@/shared/dark-pipe-link";
import { action } from "mobx";

import type { EditorActionsContext } from "./types";

type EditorDarkPipeLinkActions = Pick<EditorAction, "createDarkPipeLink" | "removeDarkPipeLink">;

export function createEditorDarkPipeLinkActions({
  document,
  documentWriter,
  workspace,
}: EditorActionsContext): EditorDarkPipeLinkActions {
  return {
    createDarkPipeLink: action((options) => {
      const currentDocument = document.getSnapshot();
      const resolved = resolveDarkPipeLinkPair({
        document: currentDocument,
        sourceEntityId: options.sourceEntityId,
        targetEntityId: options.targetEntityId,
      });

      if (resolved === null) {
        return false;
      }

      const inletDefinition = workspace.registry.entityDefinitions.find(
        (definition) => definition.id === resolved.inlet.definitionId,
      );
      if (inletDefinition === undefined) {
        return false;
      }

      const nextLink = createDarkPipeSlotLink({
        inletEntityId: resolved.inlet.id,
        outletEntityId: resolved.outlet.id,
      });
      const nextInletConfig = getDarkPipeManualRecipeOnlyPatch(inletDefinition);

      const committedDocument = documentWriter.commit({
        action: {
          type: "document.unknown",
          label: "创建暗管链接",
          detail: `${resolved.outlet.id} -> ${resolved.inlet.id}`,
          entityIds: [resolved.outlet.id, resolved.inlet.id],
          definitionIds: [resolved.outlet.definitionId, resolved.inlet.definitionId],
          count: 1,
        },
        update: (documentSnapshot) => {
          const snapshotResolved = resolveDarkPipeLinkPair({
            document: documentSnapshot,
            sourceEntityId: options.sourceEntityId,
            targetEntityId: options.targetEntityId,
          });
          if (snapshotResolved === null) {
            return documentSnapshot;
          }

          const inlet = documentSnapshot.entities[snapshotResolved.inlet.id];
          const outlet = documentSnapshot.entities[snapshotResolved.outlet.id];
          if (inlet === undefined || outlet === undefined) {
            return documentSnapshot;
          }

          return {
            ...documentSnapshot,
            entities: {
              ...documentSnapshot.entities,
              [inlet.id]: {
                ...inlet,
                config: nextInletConfig,
              },
              [outlet.id]: {
                ...outlet,
                config: {},
              },
            },
            slotLinks: [
              ...documentSnapshot.slotLinks,
              nextLink,
            ],
          };
        },
      });

      return committedDocument !== null;
    }),

    removeDarkPipeLink: action((entityId) => {
      const currentDocument = document.getSnapshot();
      const link = findDarkPipeSlotLinkForEntity(currentDocument, entityId);
      if (link === null) {
        return false;
      }

      const sourceEntity = currentDocument.entities[link.source.entityId];
      const targetEntity = currentDocument.entities[link.target.entityId];
      if (sourceEntity === undefined || targetEntity === undefined) {
        return false;
      }

      const committedDocument = documentWriter.commit({
        action: {
          type: "document.unknown",
          label: "断开暗管链接",
          detail: `${link.source.entityId} -> ${link.target.entityId}`,
          entityIds: [link.source.entityId, link.target.entityId],
          definitionIds: [sourceEntity.definitionId, targetEntity.definitionId],
          count: 1,
        },
        update: (documentSnapshot) => {
          const snapshotLink = findDarkPipeSlotLinkForEntity(documentSnapshot, entityId);
          if (snapshotLink === null) {
            return documentSnapshot;
          }

          const snapshotSource = documentSnapshot.entities[snapshotLink.source.entityId];
          const snapshotTarget = documentSnapshot.entities[snapshotLink.target.entityId];
          if (snapshotSource === undefined || snapshotTarget === undefined) {
            return documentSnapshot;
          }

          return {
            ...documentSnapshot,
            entities: {
              ...documentSnapshot.entities,
              [snapshotSource.id]: {
                ...snapshotSource,
                config: {},
              },
              [snapshotTarget.id]: {
                ...snapshotTarget,
                config: {},
              },
            },
            slotLinks: documentSnapshot.slotLinks.filter((slotLink) => slotLink.id !== snapshotLink.id),
          };
        },
      });

      return committedDocument !== null;
    }),
  };
}

function resolveDarkPipeLinkPair(options: {
  document: WorldDocument;
  sourceEntityId: string;
  targetEntityId: string;
}): {
  inlet: WorldEntity;
  outlet: WorldEntity;
} | null {
  if (options.sourceEntityId === options.targetEntityId) {
    return null;
  }

  const source = options.document.entities[options.sourceEntityId];
  const target = options.document.entities[options.targetEntityId];
  if (source === undefined || target === undefined) {
    return null;
  }

  const sourceRole = resolveDarkPipeRole(source.definitionId);
  const targetRole = resolveDarkPipeRole(target.definitionId);
  if (sourceRole === null || targetRole === null || sourceRole === targetRole) {
    return null;
  }

  if (
    isEntityInDarkPipeLink(options.document, source.id)
    || isEntityInDarkPipeLink(options.document, target.id)
  ) {
    return null;
  }

  return sourceRole === "inlet"
    ? { inlet: source, outlet: target }
    : { inlet: target, outlet: source };
}
