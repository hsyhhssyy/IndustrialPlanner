import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { BlueprintDocument } from "@/domain/document/blueprint-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { PlannerSearchSeed } from "./search-seed";
import { excludeDisconnectedBlueprintPipes } from "./blueprint-disconnections";

/** 生成、验收与任务恢复使用同一原图约束，不能借检查点或重新识别放宽数量与控制语义。 */
export function assertBlueprintPreserved(registry: RegistryContract, request: BlueprintPlannerRequest,
  baseline: PlannerSearchSeed, candidate: BlueprintDocument): void {
  // 2026-10-08：原始文件继续保留，已排除支路的控制设备不得借原图身份重新进入候选。
  const original = excludeDisconnectedBlueprintPipes(registry, request.blueprintSource!).input.blueprint;
  const fixed = new Set(baseline.network.nodes.filter(node => !["supply", "product", "environment"].includes(node.purpose)).map(node => node.entity.id));
  if (new Set(candidate.entityOrder).size !== candidate.entityOrder.length
    || candidate.entityOrder.length !== Object.keys(candidate.entities).length) throw new Error("蓝图设备编号重复或索引不一致。");
  for (const id of fixed) if (!candidate.entities[id]) throw new Error(`主体设备或物流控制设备被移除：${id}`);
  for (const id of candidate.entityOrder) {
    const entity = candidate.entities[id]!, previous = original.entities[id];
    if (previous) {
      if (entity.definitionId !== previous.definitionId || JSON.stringify(entity.config) !== JSON.stringify(previous.config)
        || JSON.stringify(entity.tags) !== JSON.stringify(previous.tags)) throw new Error(`设备配置发生变化：${id}`);
    } else if ((!registry.queries.isBelt(entity.definitionId) && !registry.queries.isPipe(entity.definitionId))
      || Object.keys(entity.config).length || entity.tags.length) throw new Error(`新增了原图之外的设备或控制配置：${id}`);
  }
  const links = original.slotLinks.filter(link => [link.source, link.target].every(endpoint =>
    !original.entities[endpoint.entityId] || candidate.entities[endpoint.entityId]));
  if (JSON.stringify(candidate.slotLinks) !== JSON.stringify(links)) throw new Error("原图库存链接发生变化。");
}
