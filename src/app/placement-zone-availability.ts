import type { AppHost } from "@/app/host/app-host";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

const WULING_ZONE_TAG = "武陵";
const UNPLACEABLE_TAG = "不可摆放";

export function canCurrentBaseAcceptWulingOnlyEntities(appHost: AppHost): boolean {
  const currentBaseTag = resolveCurrentBaseTag(appHost);

  return currentBaseTag === null || currentBaseTag === WULING_ZONE_TAG;
}

export function canPlaceEntityDefinitionInCurrentBase(
  appHost: AppHost,
  definition: EntityDefinition,
): boolean {
  let baseId: string | null = null;
  try {
    const editor = appHost.workspace?.editor;
    baseId = editor?.document.getSnapshot().baseId ?? null;
  } catch {
    baseId = null;
  }

  return canPlaceEntityDefinitionInBase(appHost, definition, baseId);
}

export function canPlaceEntityDefinitionInBase(
  appHost: AppHost,
  definition: EntityDefinition,
  baseId: string | null,
): boolean {
  const baseTag = resolveBaseTag(appHost, baseId);

  return !isWulingOnlyEntityDefinition(definition)
    || baseTag === null
    || baseTag === WULING_ZONE_TAG;
}

export function hasPlaceableEntityDefinitionInCurrentBase(
  appHost: AppHost,
  uiGroup: EntityDefinition["uiGroup"],
): boolean {
  return appHost.workspace.registry.entityDefinitions.some((definition) =>
    definition.uiGroup === uiGroup
    && !definition.tags.includes(UNPLACEABLE_TAG)
    && canPlaceEntityDefinitionInCurrentBase(appHost, definition),
  );
}

export function canPlaceBlueprintDocumentInCurrentBase(
  appHost: AppHost,
  blueprint: BlueprintDocument,
): boolean {
  const definitionById = new Map(
    appHost.workspace.registry.entityDefinitions.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  return Object.values(blueprint.entities).every((entity) => {
    const definition = definitionById.get(entity.definitionId);

    return definition === undefined
      || canPlaceEntityDefinitionInCurrentBase(appHost, definition);
  });
}

function isWulingOnlyEntityDefinition(definition: EntityDefinition): boolean {
  return definition.tags.includes(WULING_ZONE_TAG);
}

function resolveCurrentBaseTag(appHost: AppHost): string | null {
  try {
    const editor = appHost.workspace?.editor;
    if (editor === null || editor === undefined) {
      return null;
    }

    const baseId = editor.document.getSnapshot().baseId;
    return resolveBaseTag(appHost, baseId);
  } catch {
    return null;
  }
}

function resolveBaseTag(appHost: AppHost, baseId: string | null): string | null {
  if (baseId === null) {
    return null;
  }

  try {
    const baseDefinition = appHost.workspace.registry.baseDefinitions.find((definition) =>
      definition.id === baseId,
    );

    return baseDefinition?.tag ?? null;
  } catch {
    return null;
  }
}
