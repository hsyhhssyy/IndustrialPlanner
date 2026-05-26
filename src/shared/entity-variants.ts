import type { EntityDefinition } from "@/domain/registry/types/entity-definition";

const ALTER_BASE_TAG_PREFIX = "alter:";

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

  const baseDefinitionId = resolveVariantBaseDefinitionId(currentDefinition);
  const variants = options.definitions
    .filter((definition) =>
      definition.id === baseDefinitionId
      || resolveVariantBaseDefinitionId(definition) === baseDefinitionId,
    )
    .sort((left, right) =>
      left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
    );

  return variants.length > 1 ? variants : [];
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

function resolveVariantBaseDefinitionId(definition: EntityDefinition): string {
  return definition.tags.find((tag) => tag.startsWith(ALTER_BASE_TAG_PREFIX))
    ?.slice(ALTER_BASE_TAG_PREFIX.length) ?? definition.id;
}
