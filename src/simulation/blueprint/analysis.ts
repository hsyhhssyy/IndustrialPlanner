import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintAnalysis } from "@/domain/simulation";
import type { BlueprintExecutionEngine, CompiledSimulationTopology } from "../contracts";

/** 识别只读取实际编译结果和引擎事件，不能从可接收物品域臆造实际物流。 */
export class BlueprintAnalysisCollector {
  private readonly recipes = new Map<string, Set<string>>();
  private readonly recipeCombinations = new Map<string, { entityId: string; recipeIds: string[]; windowSampleCounts: number[] }>();
  private readonly transfers = new Map<string, { sourcePortId: string; targetPortId: string; itemId: string;
    totalAmount: number; windowAmounts: number[] }>();
  constructor(private readonly topology: CompiledSimulationTopology, private readonly registry: RegistryContract) {}

  sample(engine: BlueprintExecutionEngine, observationFraction: number | null): void {
    // 2026-10-08：配方稳定性只统计正式观察期；预热物流仍由下方全程转移记录保留。
    const windowIndex = observationFraction === null ? null : Math.min(3, Math.max(0, Math.ceil(observationFraction * 4) - 1));
    if (windowIndex !== null) this.observeRecipes(engine, windowIndex);
    engine.visitTransfers(transfer => {
      const edge = this.topology.transferEdges[transfer.edgeId];
      if (!edge) return;
      const key = `${edge.sourcePortId}/${edge.targetPortId}/${transfer.itemType}`;
      const row = this.transfers.get(key) ?? { sourcePortId: edge.sourcePortId, targetPortId: edge.targetPortId,
        itemId: transfer.itemType, totalAmount: 0, windowAmounts: [0, 0, 0, 0] };
      row.totalAmount += transfer.amount;
      if (windowIndex !== null) row.windowAmounts[windowIndex]! += transfer.amount;
      this.transfers.set(key, row);
    });
  }

  /** 观察起点单独采集配方，不重复累计预热最后一个 tick 的物流。 */
  observeRecipes(engine: BlueprintExecutionEngine, windowIndex: number): void {
    for (const device of engine.readDevices()) {
      const recipeIds: string[] = [];
      for (const [channelId, recipe] of Object.entries(device.channelRecipes)) {
        if (!recipe) continue;
        const key = `${device.deviceId}/${channelId}`;
        const entries = this.recipes.get(key) ?? new Set<string>();
        entries.add(recipe.recipeId); this.recipes.set(key, entries);
        recipeIds.push(recipe.recipeId);
      }
      const compiled = this.topology.devices[device.deviceId];
      if (!compiled?.sourceEntityId || !compiled.recipeChannels.length) continue;
      recipeIds.sort();
      const key = JSON.stringify([device.deviceId, recipeIds]);
      const row = this.recipeCombinations.get(key) ?? { entityId: compiled.sourceEntityId, recipeIds, windowSampleCounts: [0, 0, 0, 0] };
      row.windowSampleCounts[windowIndex]! += 1;
      this.recipeCombinations.set(key, row);
    }
  }

  report(): SimulationBlueprintAnalysis {
    const topology = this.topology;
    const entity = (deviceId: string) => topology.devices[deviceId]?.sourceEntityId ?? null;
    // 编译器给同一库存建立输入／输出视图；合并视图而非合并设备，保留桥接器两条独立库存。
    const storageNode = (id: string) => {
      const node = topology.nodes[id]!;
      return node.sourceStorageSlotGroupId === null ? id : `${node.deviceId}/storage:${node.sourceStorageSlotGroupId}`;
    };
    return {
      ports: topology.ordering.portOrder.flatMap(id => {
        const port = topology.ports[id]!, entityId = entity(port.deviceId);
        if (!entityId) return [];
        return [{ id, entityId, groupId: port.portGroupId, portId: port.portDefinitionId,
          direction: port.direction, isPipe: port.isPipe, nodeIds: port.boundNodeIds.map(storageNode),
          acceptedItemIds: this.registry.itemDefinitions.filter(item => {
            const rule = port.acceptRule;
            if (rule.exclude.includes(item.id)) return false;
            return rule.base.kind === "item" ? rule.base.itemId === item.id : rule.base.kind === "domain"
              && ((this.registry.queries.resolveItemDomain(item.id) ?? 0) & rule.base.flags) !== 0;
          }).map(item => item.id), admissionItemId: port.admissionRule?.itemId ?? null }];
      }),
      connections: topology.ordering.physicalConnectionOrder.map(id => {
        const edge = topology.physicalConnections[id]!;
        return { sourcePortId: edge.sourcePortId, targetPortId: edge.targetPortId };
      }),
      channels: topology.ordering.deviceOrder.flatMap(id => {
        const device = topology.devices[id]!, entityId = entity(id);
        return entityId ? device.recipeChannels.map(channel => ({ entityId, channelId: channel.id,
          consumption: channel.type === "consumption-channel", inputNodeIds: channel.ingredientNodeIds.map(storageNode),
          outputNodeIds: channel.productNodeIds.map(storageNode), configuredRecipeId: channel.defaultRecipeId, manual: channel.manualRecipeOnly,
          observedRecipeIds: [...this.recipes.get(`${id}/${channel.id}`) ?? []] })) : [];
      }),
      recipeCombinations: [...this.recipeCombinations.values()].map(row => ({ ...row,
        recipeIds: [...row.recipeIds], windowSampleCounts: [...row.windowSampleCounts] })),
      slots: topology.ordering.slotOrder.flatMap(id => {
        const slot = topology.slots[id]!, node = topology.nodes[slot.nodeId]!, entityId = entity(node.deviceId);
        return entityId ? [{ entityId, nodeId: storageNode(node.id), groupId: slot.sourceStorageSlotGroupId, slotId: slot.sourceSlotId,
          itemId: slot.initialItemType, count: slot.initialCount, infinite: slot.ignoreStock }] : [];
      }),
      transfers: [...this.transfers.values()].map(row => ({ ...row, windowAmounts: [...row.windowAmounts] })),
    };
  }
}
