import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { BlueprintPlannerBlueprintBoundary, BlueprintPlannerBlueprintInput } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintAnalysis, SimulationBlueprintAnalysisPort, SimulationBlueprintRunReport } from "@/domain/simulation";
import { CONSUMPTION_RECIPE_TAG } from "@/shared/consumption-channel";
import { isRecipeAvailableByActivity } from "@/shared/registry/activity-availability";

// AI-REMOVED 2026-10-07:
// Reason: 边界身份供任务和界面共用。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: src/shared/planner-task.ts blueprintBoundaryKey
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
// export const blueprintBoundaryKey = (boundary: BlueprintPlannerBlueprintBoundary) =>
//   `${boundary.entityId}/${boundary.portGroupId}/${boundary.portId}/${boundary.direction}`;
//
export { blueprintBoundaryKey } from "@/shared/planner-task";

/** 同一实体的库存通道分别追踪，桥接器的独立通道不能按实体合并。 */
export function blueprintMaterialGraph(registry: RegistryContract, blueprint: BlueprintDocument,
  analysis: SimulationBlueprintAnalysis, boundaries: readonly BlueprintPlannerBlueprintBoundary[], activeActivityIds: readonly string[] = []) {
  const ports = new Map(analysis.ports.map(port => [port.id, port]));
  const items = new Map(analysis.ports.map(port => [port.id, new Set<string>()]));
  const edges = analysis.connections.map(edge => ({ from: edge.sourcePortId, to: edge.targetPortId }));
  const possibleRecipes = new Map<string, Set<string>>();
  const add = (id: string, itemId: string) => {
    const port = ports.get(id);
    if (port?.acceptedItemIds.includes(itemId)) items.get(id)!.add(itemId);
  };
  for (const port of analysis.ports) {
    const entity = blueprint.entities[port.entityId];
    if (!entity) continue;
    const channels = analysis.channels.filter(channel => channel.entityId === entity.id);
    if (registry.queries.isGeneralLogisticsDevice(entity.definitionId) || channels.length === 0 || entity.definitionId === "storager_1") {
      if (port.direction === "input") for (const output of analysis.ports.filter(candidate => candidate.entityId === entity.id
        && candidate.direction === "output" && candidate.nodeIds.some(id => port.nodeIds.includes(id)))) {
        edges.push({ from: port.id, to: output.id });
      }
    }
    for (const slot of analysis.slots) if (slot.entityId === entity.id && slot.itemId && (slot.infinite || slot.count > 0)
      && port.nodeIds.includes(slot.nodeId)) add(port.id, slot.itemId);
    for (const boundary of boundaries) if (boundary.entityId === entity.id && boundary.direction === "input" && boundary.itemId
      && (boundary.kind === "facility" || boundary.portGroupId === port.groupId && boundary.portId === port.portId)) add(port.id, boundary.itemId);
    for (const channel of channels) {
      const recipeIds = channel.manual && channel.configuredRecipeId ? [channel.configuredRecipeId] : channel.observedRecipeIds;
      for (const recipeId of recipeIds) {
        const recipe = registry.queries.findRecipeDefinition(recipeId);
        if (recipe && port.direction === "output" && port.nodeIds.some(id => channel.outputNodeIds.includes(id))) {
          for (const output of recipe.outputs) add(port.id, output.itemId);
        }
      }
    }
  }
  // 实际转移能补充自动配方和启动路径；预热中的第二种物品不能被最终稳态覆盖。
  for (const transfer of analysis.transfers) {
    add(transfer.sourcePortId, transfer.itemId); add(transfer.targetPortId, transfer.itemId);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) for (const item of items.get(edge.from) ?? []) {
      const before = items.get(edge.to)?.size ?? 0;
      add(edge.to, item);
      if ((items.get(edge.to)?.size ?? 0) !== before) changed = true;
    }
    for (const channel of analysis.channels) {
      const entity = blueprint.entities[channel.entityId];
      if (!entity || channel.manual || registry.queries.isGeneralLogisticsDevice(entity.definitionId)) continue;
      const incoming = new Set(analysis.ports.filter(port => port.direction === "input"
        && port.nodeIds.some(id => channel.inputNodeIds.includes(id))).flatMap(port => [...items.get(port.id)!]));
      for (const slot of analysis.slots) if (channel.inputNodeIds.includes(slot.nodeId) && slot.itemId && (slot.count > 0 || slot.infinite)) incoming.add(slot.itemId);
      const possible = possibleRecipes.get(`${entity.id}/${channel.channelId}`) ?? new Set<string>();
      for (const recipe of registry.recipeDefinitions.filter(recipe => recipe.machineId === entity.definitionId
        && recipe.tags.includes(CONSUMPTION_RECIPE_TAG) === channel.consumption && isRecipeAvailableByActivity(recipe, activeActivityIds)
        && recipe.inputs.every(input => incoming.has(input.itemId)))) {
        possible.add(recipe.id);
        for (const port of analysis.ports.filter(port => port.direction === "output" && port.nodeIds.some(id => channel.outputNodeIds.includes(id)))) {
          const before = items.get(port.id)!.size;
          for (const output of recipe.outputs) add(port.id, output.itemId);
          if (items.get(port.id)!.size !== before) changed = true;
        }
      }
      possibleRecipes.set(`${entity.id}/${channel.channelId}`, possible);
    }
  }
  return { ports, items, edges, possibleRecipes };
}

export function inspectBlueprintBoundaries(registry: RegistryContract, blueprint: BlueprintDocument,
  analysis: SimulationBlueprintAnalysis, activeActivityIds: readonly string[] = [],
  suppliedBoundaries: readonly BlueprintPlannerBlueprintBoundary[] = []): BlueprintPlannerBlueprintBoundary[] {
  const result: BlueprintPlannerBlueprintBoundary[] = [];
  const connected = new Set(analysis.connections.flatMap(edge => [edge.sourcePortId, edge.targetPortId]));
  const graph = blueprintMaterialGraph(registry, blueprint, analysis, suppliedBoundaries, activeActivityIds);
  const infer = (ports: readonly SimulationBlueprintAnalysisPort[]) => {
    const ids = new Set(ports.flatMap(port => [...graph.items.get(port.id) ?? []]));
    if (ids.size === 1) return [...ids][0]!;
    const explicit = new Set(ports.flatMap(port => port.admissionItemId ? [port.admissionItemId]
      : port.acceptedItemIds.length === 1 ? port.acceptedItemIds : []));
    return explicit.size === 1 ? [...explicit][0]! : null;
  };
  for (const entityId of blueprint.entityOrder) {
    const entity = blueprint.entities[entityId]!;
    const ports = analysis.ports.filter(port => port.entityId === entityId);
    const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
    const inputs = ports.filter(port => port.direction === "input"), outputs = ports.filter(port => port.direction === "output");
    const inUse = inputs.some(port => connected.has(port.id)), outUse = outputs.some(port => connected.has(port.id));
    const source = ["unloader_1", "udpipe_unloader_1", "udpipe_unloader_2"].includes(entity.definitionId)
      || entity.definitionId === "storager_1" && outUse && !inUse
      || definition.uiGroup === "cheat" && outUse && !inUse;
    const sink = ["loader_1", "udpipe_loader_1", "udpipe_loader_2"].includes(entity.definitionId)
      || entity.definitionId === "storager_1" && inUse && !outUse
      || definition.uiGroup === "cheat" && inUse && !outUse;
    if (source || sink) {
      const direction = source ? "input" : "output";
      result.push({ entityId, portGroupId: "", portId: "", direction, kind: "facility", itemId: infer(source ? outputs : inputs) });
    } else if (registry.queries.isBelt(entity.definitionId) || registry.queries.isPipe(entity.definitionId)) {
      for (const port of ports.filter(port => !connected.has(port.id))) result.push({ entityId, portGroupId: port.groupId,
        portId: port.portId, direction: port.direction, kind: "port", itemId: infer([port]) });
    }
  }
  return result;
}

export function assertBlueprintRecognition(registry: RegistryContract, input: BlueprintPlannerBlueprintInput,
  report: SimulationBlueprintRunReport): ReturnType<typeof blueprintMaterialGraph> {
  if (report.status !== "completed" || !report.analysis || report.diagnostics.some(entry => entry.severity === "error")) {
    throw new Error(report.diagnostics.find(entry => entry.severity === "error")?.message ?? "蓝图识别未完成，禁止优化。");
  }
  if (report.deviceStatuses.some(entry => ["not-in-power-net", "no-power"].includes(entry.status))) throw new Error("蓝图存在未供电设备，无法建立产率基线。");
  const graph = blueprintMaterialGraph(registry, input.blueprint, report.analysis, input.boundaries, input.activeActivityIds);
  for (const [id, items] of graph.items) if (items.size > 1) {
    const port = graph.ports.get(id)!;
    throw new Error(`疑似混带：${port.entityId} / ${port.groupId} / ${port.portId}，物品：${[...items].join("、")}。`);
  }
  // 已持久化的自动出口必须与本次真实物品传播一致，导入不能用指定物品掩盖实际产物。
  for (const boundary of input.boundaries.filter(boundary => boundary.direction === "output")) {
    const ports = report.analysis.ports.filter(port => port.entityId === boundary.entityId && (boundary.kind === "facility"
      ? port.direction === "input" : port.groupId === boundary.portGroupId && port.portId === boundary.portId));
    const ids = new Set(ports.flatMap(port => [...graph.items.get(port.id) ?? []]));
    if (ids.size !== 1 || !boundary.itemId || !ids.has(boundary.itemId)) throw new Error(`出口 ${boundary.entityId} 的物品与运行证据不一致。`);
  }
  // AI-REMOVED 2026-10-08:
  // Reason: 配方身份属于设备整体组合，逐通道唯一性会拒绝合法的通道迁移和冗余空闲通道。
  // Trigger: 用户要求比较所有通道合计配方，并允许完整组合中的单个配方独立出现。
  // Evidence: 真实 Dense 场景中 ch1/ch2 从 A/B 变为 B/A，设备的无序组合保持 A+B。
  // Replacement: 下方设备组合验收与空闲通道判定；assertBlueprintRecipeCombination。
  // Risk: 允许组合的子组合；出口产率、库存漂移和混带检查继续独立执行。
  // Human Review: Required
  // Original code:
  //   for (const channel of report.analysis.channels.filter(channel => input.blueprint.entities[channel.entityId])) {
  //     const definition = registry.queries.findEntityDefinition(input.blueprint.entities[channel.entityId]!.definitionId)!;
  //     if (registry.queries.isGeneralLogisticsDevice(definition.id) || definition.uiGroup === "cheat" || definition.id === "storager_1"
  //       || input.boundaries.some(boundary => boundary.kind === "facility" && boundary.entityId === channel.entityId)) continue;
  //     if (!channel.inputNodeIds.length && !channel.outputNodeIds.length && !channel.configuredRecipeId) continue;
  //     const recipes = new Set(channel.observedRecipeIds);
  //     const possible = graph.possibleRecipes.get(`${channel.entityId}/${channel.channelId}`);
  //     // AI-REMOVED 2026-10-08:
  //     // Reason: 静态候选数量不代表正式观察期实际运行的配方数量。
  //     // Trigger: 用户允许预热切换，但要求正式观察期稳定为同一配方。
  //     // Evidence: 惰气提纯真实运行仅使用增强配方，静态传播仍同时列出普通与增强配方。
  //     // Replacement: 下方基于观察期 observedRecipeIds 的稳定性检查。
  //     // Risk: Low；全程物品传播、混带检查与稳态产率验收继续执行。
  //     // Human Review: Required
  //     // Original code:
  //     // if (possible && possible.size > 1) throw new Error(`设备 ${channel.entityId} 的通道 ${channel.channelId} 存在多种可运行配方，禁止优化。`);
  //     if (recipes.size > 1) {
  //       throw new Error(`设备 ${channel.entityId} 的通道 ${channel.channelId} 在观察期内配方未稳定：${[...recipes].join("、")}，禁止优化。`);
  //     }
  //     if (channel.consumption && recipes.size === 0 && !channel.configuredRecipeId && (possible?.size ?? 0) <= 1) continue;
  //     if (recipes.size === 0 && channel.manual && channel.configuredRecipeId) recipes.add(channel.configuredRecipeId);
  //     if (recipes.size !== 1 || channel.manual && channel.configuredRecipeId && !recipes.has(channel.configuredRecipeId)) {
  //       throw new Error(`无法确定设备 ${channel.entityId} 的配方通道 ${channel.channelId}，禁止优化。`);
  //     }
  //   }
  for (const entityId of new Set(report.analysis.channels.map(channel => channel.entityId))) {
    const entity = input.blueprint.entities[entityId];
    if (!entity) continue;
    const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
    if (registry.queries.isGeneralLogisticsDevice(definition.id) || definition.uiGroup === "cheat" || definition.id === "storager_1"
      || input.boundaries.some(boundary => boundary.kind === "facility" && boundary.entityId === entityId)) continue;
    const channels = report.analysis.channels.filter(channel => channel.entityId === entityId);
    const combination = assertBlueprintRecipeCombination(report.analysis, entityId);
    for (const channel of channels) {
      if (!channel.inputNodeIds.length && !channel.outputNodeIds.length && !channel.configuredRecipeId) continue;
      const observed = channel.observedRecipeIds;
      const possible = graph.possibleRecipes.get(`${entityId}/${channel.channelId}`);
      if (channel.manual) {
        if (observed.some(id => id !== channel.configuredRecipeId)) {
          throw new Error(`设备 ${entityId} 的配方通道 ${channel.channelId} 与手动配置不一致，禁止优化。`);
        }
        continue;
      }
      if (observed.length) continue;
      if (channel.consumption && !channel.configuredRecipeId && (possible?.size ?? 0) <= 1) continue;
      // 同一实际库存上的冗余通道没有新增配方身份；独立库存仍必须具备已知配方证据。
      const sharedKnown = channels.some(peer => peer.consumption === channel.consumption
        && (peer.observedRecipeIds.length > 0 || peer.manual && peer.configuredRecipeId !== null)
        && peer.inputNodeIds.length === channel.inputNodeIds.length && peer.inputNodeIds.every(id => channel.inputNodeIds.includes(id))
        && peer.outputNodeIds.length === channel.outputNodeIds.length && peer.outputNodeIds.every(id => channel.outputNodeIds.includes(id)));
      if (sharedKnown || possible?.size === 1 && [...possible].every(id => combination.includes(id))) continue;
      throw new Error(`无法确定设备 ${entityId} 的配方通道 ${channel.channelId}，禁止优化。`);
    }
  }
  const allowedSources = new Set(input.boundaries.filter(boundary => boundary.direction === "input").map(boundary => boundary.entityId));
  if (report.analysis.slots.some(slot => slot.infinite && input.blueprint.entities[slot.entityId] && !allowedSources.has(slot.entityId))) {
    throw new Error("内部设备使用了未声明的无限库存，无法建立真实产率基线。");
  }
  return graph;
}

/** 完整组合必须同 tick 实际出现；其子组合可独立运行，不能把串行 A/B 历史拼成 A+B。 */
function assertBlueprintRecipeCombination(analysis: SimulationBlueprintAnalysis, entityId: string): readonly string[] {
  if (!Array.isArray(analysis.recipeCombinations)) throw new Error("缺少设备配方组合观测数据，请重新识别蓝图。");
  const rows = analysis.recipeCombinations.filter(row => row.entityId === entityId);
  if (!rows.length) throw new Error(`缺少设备 ${entityId} 的配方组合观测数据，请重新识别蓝图。`);
  const complete = rows.reduce((best, row) => row.recipeIds.length > best.recipeIds.length ? row : best);
  const counts = new Map<string, number>();
  for (const id of complete.recipeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const row of rows) {
    const remaining = new Map(counts);
    for (const id of row.recipeIds) {
      const count = remaining.get(id) ?? 0;
      if (count === 0) {
        throw new Error(`设备 ${entityId} 在观察期内配方未稳定：无法确定覆盖全部实际运行配方的完整组合，禁止优化。`);
      }
      remaining.set(id, count - 1);
    }
  }
  return complete.recipeIds;
}

/** 只容许配方批次和输送相位的波动，不把持续增减库存或末段停产当作稳态。 */
export function assertBlueprintSteadyState(registry: RegistryContract, report: SimulationBlueprintRunReport,
  probes: readonly { id: string; itemId: string; entityIds: readonly string[]; direction: "input" | "output" }[]): void {
  if (!report.analysis || report.inventorySamples.length < 5) throw new Error("缺少稳态识别数据。");
  const batches = new Map<string, number>();
  for (const channel of report.analysis.channels) for (const id of channel.observedRecipeIds) {
    const recipe = registry.queries.findRecipeDefinition(id);
    if (!recipe) continue;
    if (recipe.durationSeconds * 4 > report.observationSeconds) throw new Error("观察窗口不足以覆盖配方周期，禁止优化。");
    for (const flow of [...recipe.inputs, ...recipe.outputs]) batches.set(flow.itemId, Math.max(batches.get(flow.itemId) ?? 1, flow.amount));
  }
  const entityByPort = new Map(report.analysis.ports.map(port => [port.id, port.entityId]));
  for (const probe of probes.filter(probe => probe.direction === "input")) {
    const inside = new Set(probe.entityIds), windows = [0, 0, 0, 0];
    for (const transfer of report.analysis.transfers) if (transfer.itemId === probe.itemId
      && inside.has(entityByPort.get(transfer.targetPortId) ?? "") && !inside.has(entityByPort.get(transfer.sourcePortId) ?? "")) {
      transfer.windowAmounts.forEach((amount, index) => { windows[index]! += amount; });
    }
    if (Math.min(...windows) <= 0 || Math.max(...windows) - Math.min(...windows) > 2 * (batches.get(probe.itemId) ?? 1)) {
      throw new Error(`出口 ${probe.itemId} 尚未达到持续稳定产出，禁止优化。`);
    }
  }
  const samples = report.inventorySamples.slice(-5);
  const items = new Set(samples.flatMap(sample => Object.keys(sample.itemAmounts)));
  for (const item of items) {
    const counts = samples.map(sample => sample.itemAmounts[item] ?? 0);
    const delta = counts.at(-1)! - counts[0]!;
    if (Math.abs(delta) > 2 * (batches.get(item) ?? 1) && counts.slice(1).every((count, index) =>
      delta > 0 ? count >= counts[index]! : count <= counts[index]!)) {
      throw new Error(`库存 ${item} 持续${delta > 0 ? "积压" : "消耗"}，无法确认持续产率。`);
    }
  }
}
