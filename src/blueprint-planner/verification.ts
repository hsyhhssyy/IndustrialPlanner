import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import type { PlannerCandidate } from "./candidate";
import { PlannerBoundary } from "./boundary";
import { createPlainNode } from "./placement";
import { assertPlannerOutline } from "./search-outline";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SimulationBlueprintRunReport } from "@/domain/simulation";
import type { PlannerSupplyAudit } from "./supply-audit";
import { meetsStashSubmission } from "./stash-submission";

export function meetsOperatingLimits(audit: PlannerSupplyAudit, report: SimulationBlueprintRunReport): boolean {
  return (audit.startupProduction ?? []).every(limit => {
    const measured = report.probes.find(probe => probe.id === `startup:${limit.entityId}`)?.perMinute;
    return measured !== undefined && Number.isFinite(measured) && measured + 1e-6 >= limit.perMinute;
  }) && (audit.startupStorage ?? []).every(storage => {
    const input = report.probes.find(probe => probe.id === `startup-storage:input:${storage.entityId}`)?.amount;
    const output = report.probes.find(probe => probe.id === `startup-storage:output:${storage.entityId}`)?.amount;
    // 离散搬运允许窗口端点相差一个物品；每只启动罐分别检查，禁止库存互相抵消。
    return input !== undefined && output !== undefined && Number.isFinite(input) && Number.isFinite(output)
      && input >= 0 && output >= 0 && output <= input + 1;
  }) && audit.operatingLimits.every(limit => {
    const measured = report.probes.find(probe => probe.id === `operating:${limit.entityId}`)?.perMinute;
    return measured !== undefined && Number.isFinite(measured) && measured >= 0 && measured <= limit.perMinute + 1e-6;
  });
}

export function meetsProductionTargets(request: BlueprintPlannerRequest, report: SimulationBlueprintRunReport): boolean {
  if (report.status !== "completed" || report.observationSeconds <= 0 || !meetsStashSubmission(report)
    || report.diagnostics.some((entry) => entry.severity === "error")
    || report.deviceStatuses.some((entry) => entry.status === "not-in-power-net" || entry.status === "no-power")) return false;
  return request.plan.targets.every((target) => (report.probes.find((probe) => probe.id === target.itemId)?.perMinute ?? 0)
    - (request.blueprintSource ? report.probes.find(probe => probe.id === `input:${target.itemId}`)?.perMinute ?? 0 : 0) + 1e-6 >= target.perMinute);
}


/** 交付和恢复都核对声明尺寸与实体包围盒，不能靠伪造 metrics 绕过 70 格上限。 */
export function assertPlannerCandidateBounds(registry: RegistryContract, candidate: Pick<PlannerCandidate, "metrics" | "execution">): void {
  assertPlannerOutline(candidate.metrics);
  if (candidate.metrics.area !== candidate.metrics.width * candidate.metrics.height) throw new Error("蓝图面积与宽高不一致。");
  const blueprint = candidate.execution.blueprint;
  const rects = blueprint.entityOrder.map(id => {
    const entity = blueprint.entities[id];
    const definition = entity && registry.queries.findEntityDefinition(entity.definitionId);
    if (!entity || !definition) throw new Error(`蓝图引用了无效设备：${id}`);
    return resolveEntityGridRect({ entity, definition });
  });
  if (!rects.length) return;
  const width = Math.max(...rects.map(rect => rect.x + rect.width)) - Math.min(...rects.map(rect => rect.x));
  const height = Math.max(...rects.map(rect => rect.y + rect.height)) - Math.min(...rects.map(rect => rect.y));
  assertPlannerOutline({ width, height });
  if (width > candidate.metrics.width || height > candidate.metrics.height) throw new Error("实体超出蓝图声明范围。");
}

/** 以交付实体复核规则，检查点不能只提交合规种子而交付另一套口位。 */
export function assertPlannerWarehousePorts(registry: RegistryContract, request: BlueprintPlannerRequest, candidate: PlannerCandidate): void {
  if (!request.options.warehousePortPlacement || request.options.warehousePortPlacement === "any") return;
  const blueprint = candidate.execution.blueprint;
  const rects = blueprint.entityOrder.map(id => {
    const entity = blueprint.entities[id]!;
    return resolveEntityGridRect({ entity, definition: registry.queries.findEntityDefinition(entity.definitionId)! });
  });
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  const nodes = blueprint.entityOrder.filter(id => ["loader_1", "unloader_1"].includes(blueprint.entities[id]!.definitionId)).map(id => {
    const entity = blueprint.entities[id]!;
    return { ...createPlainNode(registry, entity.definitionId, id, "logistics"),
      entity: { ...entity, position: { x: entity.position.x - x, y: entity.position.y - y } } };
  });
  const boundary = new PlannerBoundary(registry, { request, nodes, slotLinks: [], initialSlots: [], preferredGasCount: 0 },
    { ...candidate.metrics, warehouseSide: candidate.search.outline.warehouseSide });
  if (boundary.resolve(nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }))).violations
    || candidate.search.outline.storageCount !== undefined && nodes.filter(node => node.entity.definitionId === "loader_1").length !== candidate.search.outline.storageCount) {
    throw new Error("仓库口摆位不满足当前规则或分片口数。");
  }
}
