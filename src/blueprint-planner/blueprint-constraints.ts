import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { restorePlannerSeed, type PlannerSearchSeed } from "./search-seed";
import { excludeDisconnectedBlueprintPipes } from "./blueprint-disconnections";
import { converterRebuildScope, converterPortConfigKeys, isConverterRouteControl } from "./converter-routing";

/** 生成、验收与任务恢复使用同一原图约束，不能借检查点或重新识别放宽数量与控制语义。 */
export function assertBlueprintPreserved(registry: RegistryContract, request: BlueprintPlannerRequest,
  baseline: PlannerSearchSeed, candidate: BlueprintDocument, candidateSeed?: PlannerSearchSeed): void {
  // 2026-10-08：原始文件继续保留，已排除支路的控制设备不得借原图身份重新进入候选。
  const original = excludeDisconnectedBlueprintPipes(registry, request.blueprintSource!).input.blueprint;
  const before = restorePlannerSeed(registry, request, baseline);
  const after = candidateSeed ? restorePlannerSeed(registry, request, candidateSeed) : null;
  const adaptive = request.options.converterStartup === "manual" || request.options.converterStartup === "tank";
  const previousScope = adaptive && after ? converterRebuildScope(registry, before.network, before.wires) : null;
  const nextScope = previousScope && after ? converterRebuildScope(registry, after.network, after.wires) : null;
  if (after && after.network.nodes.some(node => {
    const entity = candidate.entities[node.entity.id];
    return !entity || entity.definitionId !== node.entity.definitionId || JSON.stringify(entity.config) !== JSON.stringify(node.entity.config)
      || JSON.stringify(entity.tags) !== JSON.stringify(node.entity.tags);
  })) throw new Error("蓝图供气网表与交付设备不一致。");
  const fixed = new Set(baseline.network.nodes.filter(node => !["supply", "product", "environment"].includes(node.purpose)
    && !previousScope?.controls.has(node.entity.id)).map(node => node.entity.id));
  if (new Set(candidate.entityOrder).size !== candidate.entityOrder.length
    || candidate.entityOrder.length !== Object.keys(candidate.entities).length) throw new Error("蓝图设备编号重复或索引不一致。");
  for (const id of fixed) if (!candidate.entities[id]) throw new Error(`主体设备或物流控制设备被移除：${id}`);
  for (const id of candidate.entityOrder) {
    const entity = candidate.entities[id]!, previous = original.entities[id];
    if (nextScope?.controls.has(id) && ["gas_storager_1", "liquid_storager_1"].includes(entity.definitionId)) {
      const capacity = registry.queries.findEntityDefinition(entity.definitionId)!.storageSlotGroups[0]!.slots[0]!.capacity;
      const count = entity.config["storageSlotGroups[0].slots[0].initialCount"] ?? 0;
      if (entity.config["storageSlotGroups[0].slots[0].ignoreStock"] === true || typeof count !== "number"
        || !Number.isFinite(count) || count < 0 || count > capacity) throw new Error(`循环启动罐库存无效：${id}`);
    }
    const oldNode = before.network.nodes.find(node => node.entity.id === id);
    const rebuiltControl = previousScope?.controls.has(id) && nextScope?.controls.has(id);
    const portKeys = oldNode && previousScope?.nodes.has(id) ? converterPortConfigKeys(registry, oldNode, previousScope.items) : new Set<string>();
    const stableConfig = (config: typeof entity.config) => Object.fromEntries(Object.entries(config).filter(([key]) => !portKeys.has(key)));
    if (previous) {
      if (!rebuiltControl && (entity.definitionId !== previous.definitionId || JSON.stringify(stableConfig(entity.config)) !== JSON.stringify(stableConfig(previous.config))
        || JSON.stringify(entity.tags) !== JSON.stringify(previous.tags))) throw new Error(`设备配置发生变化：${id}`);
    } else if ((!registry.queries.isBelt(entity.definitionId) && !registry.queries.isPipe(entity.definitionId))
      || Object.keys(entity.config).length || entity.tags.length) {
      if (!(nextScope?.controls.has(id) && after?.network.nodes.some(node => node.entity.id === id))
        && !(nextScope && candidateSeed && isConverterRouteControl(registry, entity, nextScope, candidateSeed.routes))) {
        throw new Error(`新增了原图之外的设备或控制配置：${id}`);
      }
    }
  }
  const links = original.slotLinks.filter(link => [link.source, link.target].every(endpoint =>
    !original.entities[endpoint.entityId] || candidate.entities[endpoint.entityId]));
  if (JSON.stringify(candidate.slotLinks) !== JSON.stringify(links)) throw new Error("原图库存链接发生变化。");
}
