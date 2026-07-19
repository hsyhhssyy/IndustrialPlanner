import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

const ALTER_BASE_TAG_PREFIX = "alter:";
const ALTER_VARIANT_TAG_PREFIX = "alter-variant:";
export const MAIN_CRAFT_GROUP_TAG = "MainCraftGroup";

export function resolveEntityCraftGroupKey(
  definition: Pick<EntityDefinition, "tags">,
): string | null {
  return definition.tags.find((tag) => tag.startsWith(ALTER_BASE_TAG_PREFIX))
    ?.slice(ALTER_BASE_TAG_PREFIX.length) ?? null;
}

export function resolveEntityVariantName(
  definition: Pick<EntityDefinition, "tags">,
): string | null {
  return definition.tags.find((tag) => tag.startsWith(ALTER_VARIANT_TAG_PREFIX))
    ?.slice(ALTER_VARIANT_TAG_PREFIX.length) ?? null;
}

export function resolveEntityVariantDefinitions(options: {
  readonly definitionId: string;
  readonly definitions: readonly EntityDefinition[];
}): readonly EntityDefinition[] {
  const definitionById = new Map(
    options.definitions.map((definition) => [definition.id, definition]),
  );
  const currentDefinition = definitionById.get(options.definitionId);
  if (currentDefinition === undefined) {
    return [];
  }

  const craftGroupKey = resolveEntityCraftGroupKey(currentDefinition);
  if (craftGroupKey === null) {
    return [];
  }

  const variants = options.definitions
    .filter((definition) => resolveEntityCraftGroupKey(definition) === craftGroupKey)
    .sort((left, right) =>
      left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
    );

  return variants.length > 1 ? variants : [];
}

export function resolveMainEntityVariantDefinition(options: {
  readonly definitionId: string;
  readonly definitions: readonly EntityDefinition[];
}): EntityDefinition | null {
  const variants = resolveEntityVariantDefinitions(options);
  return variants.find((definition) => definition.tags.includes(MAIN_CRAFT_GROUP_TAG))
    ?? variants[0]
    ?? null;
}

export function resolveSelectedEntityVariantDefinition(options: {
  readonly definitionId: string;
  readonly definitions: readonly EntityDefinition[];
  readonly selectedVariantName: string | null | undefined;
}): EntityDefinition | null {
  const variants = resolveEntityVariantDefinitions(options);
  const selectedDefinition = variants.find((definition) =>
    resolveEntityVariantName(definition) === options.selectedVariantName,
  );

  return selectedDefinition
    ?? variants.find((definition) => definition.tags.includes(MAIN_CRAFT_GROUP_TAG))
    ?? variants[0]
    ?? null;
}

export function collapseEntityVariantDefinitions(options: {
  readonly definitions: readonly EntityDefinition[];
  readonly selectedVariantNameByCraftGroup: Readonly<Record<string, string>>;
}): readonly EntityDefinition[] {
  const sortedDefinitions = [...options.definitions].sort((left, right) =>
    left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
  );
  const collapsedDefinitions: EntityDefinition[] = [];
  const resolvedCraftGroups = new Set<string>();

  for (const definition of sortedDefinitions) {
    const craftGroupKey = resolveEntityCraftGroupKey(definition);
    if (craftGroupKey === null) {
      collapsedDefinitions.push(definition);
      continue;
    }

    if (resolvedCraftGroups.has(craftGroupKey)) {
      continue;
    }

    resolvedCraftGroups.add(craftGroupKey);
    collapsedDefinitions.push(
      resolveSelectedEntityVariantDefinition({
        definitionId: definition.id,
        definitions: sortedDefinitions,
        selectedVariantName: options.selectedVariantNameByCraftGroup[craftGroupKey],
      }) ?? definition,
    );
  }

  return collapsedDefinitions;
}

export function resolveNextEntityVariantDefinitionId(options: {
  readonly definitionId: string;
  readonly definitions: readonly EntityDefinition[];
}): string | null {
  const variants = resolveEntityVariantDefinitions(options);
  if (variants.length <= 1) {
    return null;
  }

  const currentIndex = variants.findIndex((definition) =>
    definition.id === options.definitionId,
  );
  if (currentIndex < 0) {
    return null;
  }

  return variants[(currentIndex + 1) % variants.length]?.id ?? null;
}

export function isEntityDefinitionVariantSwitchable(options: {
  readonly definitionId: string;
  readonly definitions: readonly EntityDefinition[];
}): boolean {
  return resolveNextEntityVariantDefinitionId(options) !== null;
}
