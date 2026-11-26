import type { RegistryContract } from "@/domain/registry";
import type { RegistrySnapshot } from "@/domain/registry/types/custom-registry";

const builtinRegistries = new WeakSet<RegistryContract>();

export function markBuiltinRegistry(registry: RegistryContract): RegistryContract {
  builtinRegistries.add(registry);
  return registry;
}

export function snapshotRegistryForWorker(registry: RegistryContract): RegistrySnapshot | undefined {
  return builtinRegistries.has(registry) ? undefined : snapshotRegistry(registry);
}

/** Worker transport only includes data; the receiving Registry reconstructs its queries. */
export function snapshotRegistry(registry: RegistryContract): RegistrySnapshot {
  return {
    baseDefinitions: registry.baseDefinitions,
    entityDefinitions: registry.entityDefinitions,
    entityVariantDefinitions: registry.entityVariantDefinitions,
    itemDefinitions: registry.itemDefinitions,
    recipeDefinitions: registry.recipeDefinitions,
    formationDefinitions: registry.formationDefinitions,
    customContent: registry.customContent,
  };
}
