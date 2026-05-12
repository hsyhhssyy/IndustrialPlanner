import {
  createBlueprintDocument,
  type BlueprintDocument,
} from "@/domain/document/blueprint-document";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { convertLegacyBlueprintJson } from "@/shared/storage";

export function serializeBlueprintDocumentForTransfer(blueprint: BlueprintDocument): string {
  return JSON.stringify(toPortableBlueprintDocument(blueprint), null, 2);
}

export function parseBlueprintTransferText(text: string): BlueprintDocument | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;

    return normalizeBlueprintDocument(parsed) ?? convertLegacyBlueprintJson(parsed);
  } catch {
    return null;
  }
}

export function createImportedBlueprintDocument(blueprint: BlueprintDocument): BlueprintDocument {
  const portableBlueprint = toPortableBlueprintDocument(blueprint);

  return createBlueprintDocument({
    version: portableBlueprint.version,
    name: portableBlueprint.name,
    description: portableBlueprint.description,
    baseId: portableBlueprint.baseId,
    initialGridPoint: {
      ...portableBlueprint.initialGridPoint,
    },
    entities: cloneBlueprintEntities(portableBlueprint.entities),
    entityOrder: portableBlueprint.entityOrder,
    slotLinks: portableBlueprint.slotLinks.map(cloneSlotLinkDefinition),
  });
}

export function downloadBlueprintDocumentForTransfer(blueprint: BlueprintDocument): void {
  if (
    typeof Blob === "undefined"
    || typeof document === "undefined"
    || document.body === null
    || typeof URL?.createObjectURL !== "function"
  ) {
    throw new Error("Blueprint file download is unavailable in the current environment.");
  }

  const blob = new Blob([serializeBlueprintDocumentForTransfer(blueprint)], {
    type: "application/json;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = resolveBlueprintTransferFileName(blueprint.name);
  anchor.rel = "noopener";
  anchor.style.display = "none";

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL?.(objectUrl);
}

function toPortableBlueprintDocument(blueprint: BlueprintDocument): BlueprintDocument {
  return {
    schemaVersion: blueprint.schemaVersion,
    blueprintId: blueprint.blueprintId,
    version: blueprint.version,
    name: blueprint.name,
    description: blueprint.description,
    baseId: blueprint.baseId,
    initialGridPoint: {
      ...blueprint.initialGridPoint,
    },
    entities: cloneBlueprintEntities(blueprint.entities),
    entityOrder: [...blueprint.entityOrder],
    slotLinks: blueprint.slotLinks.map(cloneSlotLinkDefinition),
    createdAt: blueprint.createdAt,
    updatedAt: blueprint.updatedAt,
  };
}

function cloneBlueprintEntities(
  entities: BlueprintDocument["entities"],
): Record<string, WorldEntity> {
  const nextEntities: Record<string, WorldEntity> = {};

  for (const [entityId, entity] of Object.entries(entities)) {
    nextEntities[entityId] = cloneWorldEntity(entity);
  }

  return nextEntities;
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

function resolveBlueprintTransferFileName(name: string): string {
  const normalizedStem = name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) <= 0x1F ? "_" : character))
    .join("")
    .replace(/\.+$/g, "");

  return `${normalizedStem.length > 0 ? normalizedStem : "blueprint"}.json`;
}