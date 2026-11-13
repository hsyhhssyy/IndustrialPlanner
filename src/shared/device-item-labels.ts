import type { WorldDocument, WorldEntity } from "@/domain/document/world-document";
import type { EntityDefinition } from "@/domain/registry/types/entity-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationDeviceRuntimeStatusReadModel } from "@/domain/simulation/types/simulation-types";

/** 只将明确链接到输出槽组的仓库物品作为供给标签，不从任意缓存猜测配置。 */
export function configuredDeviceItemIds(definition: EntityDefinition, entityId: string,
  document: Pick<WorldDocument, "slotLinks">, registry: RegistryContract): readonly string[] {
  const outputs = new Set(definition.portGroups.filter(group => group.direction === "output").map(group => group.id));
  const outputGroups = new Set(definition.portStorageBindings.filter(binding => outputs.has(binding.portGroupId)).map(binding => binding.storageSlotGroupId));
  const groups = new Set(definition.inspectors.flatMap(inspector => inspector.type === "warehouse-item-link" ? inspector.slotGroupIds : []));
  return [...new Set(document.slotLinks.filter(link => link.source.entityId === entityId && link.target.entityId === "warehouse"
    && groups.has(link.source.storageSlotGroupId) && outputGroups.has(link.source.storageSlotGroupId)).map(link => link.target.slotId))].filter(id => registry.queries.findItemDefinition(id) !== null);
}

/** 运输配方的占位产物取实际输出槽物品，只有真实运行通道可以提供此标签。 */
export function runningDeviceItemIds(definition: EntityDefinition, status: SimulationDeviceRuntimeStatusReadModel,
  registry: RegistryContract): readonly string[] {
  const items = new Set<string>();
  for (const channel of Object.values(status.channelRecipes)) {
    if (!channel?.recipeId || channel.state !== "running" && channel.state !== "waiting-output") continue;
    const recipe = registry.queries.findRecipeDefinition(channel.recipeId);
    for (const id of recipe?.primaryOutputs ?? []) if (registry.queries.findItemDefinition(id)) items.add(id);
    if (!recipe?.outputs.some(flow => flow.itemId === "same-as-input")) continue;
    const groups = definition.recipeChannels.find(entry => entry.id === channel.channelId)?.productStorageGroupIds ?? [];
    for (const slot of status.slotItems) if (groups.includes(slot.storageGroupId) && slot.itemType
      && (slot.count > 0 || slot.reserved > 0) && registry.queries.findItemDefinition(slot.itemType)) items.add(slot.itemType);
  }
  return [...items];
}

export function deviceLabelEntityId(entity: WorldEntity | null, fallback: string): string {
  return entity && "originalEntityId" in entity && typeof entity.originalEntityId === "string" ? entity.originalEntityId : fallback;
}
