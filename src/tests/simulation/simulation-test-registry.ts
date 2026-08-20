import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  EntityDefinition,
  ItemDomain,
} from "@/domain/registry/types/entity-definition";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import { ItemDomainFlag } from "@/domain/shared/item-domain-flags";
import { createRegistryContract } from "@/registry";
import { createRegistryQuery } from "@/registry/registry-query";

interface SimulationTestRegistryOptions {
  readonly itemDomains?: Readonly<Record<string, ItemDomain>>;
  readonly entityTags?: Readonly<Record<string, readonly string[]>>;
  readonly recipeDefinitions?: readonly RecipeDefinition[];
}

/**
 * 为手写 topology 测试补齐显式 registry 定义。
 * 真实蓝图测试应直接使用 createRegistryContract，并把同一实例同时交给 compiler 与 runtime。
 */
export function createSimulationTestRegistry(
  options: SimulationTestRegistryOptions = {},
): RegistryContract {
  const base = createRegistryContract();
  const itemDefinitions = mergeDefinitionsById(
    base.itemDefinitions,
    Object.entries(options.itemDomains ?? {}).map(([itemId, domain]) =>
      createTestItemDefinition(itemId, domain),
    ),
  );
  const entityDefinitions = mergeDefinitionsById(
    base.entityDefinitions,
    Object.entries(options.entityTags ?? {}).map(([definitionId, tags]) =>
      createTestEntityDefinition(definitionId, tags),
    ),
  );
  const recipeDefinitions = mergeDefinitionsById(
    base.recipeDefinitions,
    options.recipeDefinitions ?? [],
  );

  return {
    ...base,
    entityDefinitions,
    itemDefinitions,
    recipeDefinitions,
    queries: createRegistryQuery({
      entityDefinitions,
      itemDefinitions,
      recipeDefinitions,
    }),
  };
}

function mergeDefinitionsById<T extends { readonly id: string }>(
  base: readonly T[],
  additions: readonly T[],
): T[] {
  const additionsById = new Map(additions.map((definition) => [definition.id, definition]));
  return [
    ...base.map((definition) => additionsById.get(definition.id) ?? definition),
    ...additions.filter((definition) => !base.some((candidate) => candidate.id === definition.id)),
  ];
}

function createTestItemDefinition(itemId: string, domain: ItemDomain): ItemDefinition {
  const tags = domain === ItemDomainFlag.Gas
    ? ["gas"]
    : domain === ItemDomainFlag.Liquid
      ? ["liquid"]
      : [];
  return {
    id: itemId,
    nameKey: `test.item.${itemId}`,
    iconId: itemId,
    displayOrder: Number.MAX_SAFE_INTEGER,
    tags,
  };
}

function createTestEntityDefinition(
  definitionId: string,
  tags: readonly string[],
): EntityDefinition {
  return {
    id: definitionId,
    nameKey: `test.entity.${definitionId}`,
    spriteId: definitionId,
    iconPath: `device-icons/${definitionId}.webp`,
    footprint: { width: 1, height: 1 },
    uiGroup: "hidden",
    displayOrder: Number.MAX_SAFE_INTEGER,
    tags: [...tags],
    requiresPower: false,
    powerDemand: 0,
    inspectors: [],
    placementBehaviors: [],
    portGroups: [],
    storageSlotGroups: [],
    recipeChannels: [],
    portStorageBindings: [],
  };
}
