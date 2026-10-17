import type { BlueprintPlannerFlow, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createBlueprintDocument } from "@/domain/document/blueprint-document";
import type { SlotLinkDefinition, WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationBlueprintProbe } from "@/domain/simulation";
import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
import type { PlannerCandidate } from "./candidate";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode, type PlannerWire } from "./model";
import { capturePlannerSeed, restorePlannerSeed } from "./search-seed";
import type { PlannerRouter } from "./router";
import { auditPlannerSupply } from "./supply-audit";
import { boundedPlannerScore, measurePlannerQuality } from "./quality";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts } from "./verification";
import { normalizePlannerSources } from "./production-network";

/** 整数生产比例只给出可独立求解的子任务；不读取系统蓝图，也不固定任何设备坐标。 */
export function repeatedPlannerRequest(request: BlueprintPlannerRequest, outline: { width: number; height: number }) {
  if (request.blueprintSource || request.plan.containsModules || !request.plan.recipes.length
    || request.plan.recipes.some(recipe => !Number.isSafeInteger(recipe.deviceCount) || recipe.deviceCount <= 0)) return null;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const count = request.plan.recipes.map(recipe => recipe.deviceCount).reduce(gcd);
  if (count <= 1 || count > outline.width * outline.height) return null;
  const choices = Array.from({ length: count }, (_, index) => index + 1).filter(rows => count % rows === 0)
    .map(rows => ({ rows, columns: count / rows, width: Math.floor(outline.width / (count / rows)), height: Math.floor(outline.height / rows) }))
    .filter(choice => choice.width > 0 && choice.height > 0)
    .sort((a, b) => Math.max(a.width / a.height, a.height / a.width) - Math.max(b.width / b.height, b.height / b.width)
      || b.width * b.height - a.width * a.height);
  const shape = choices[0];
  if (!shape) return null;
  const scale = (flow: BlueprintPlannerFlow) => ({ ...flow, perMinute: flow.perMinute / count });
  return { count, ...shape, request: { ...request, plan: { ...request.plan,
    targets: request.plan.targets.map(scale), externalSupplies: request.plan.externalSupplies.map(scale),
    unresolvedPerMinute: request.plan.unresolvedPerMinute / count,
    recipes: request.plan.recipes.map(recipe => ({ ...recipe, deviceCount: recipe.deviceCount / count,
      cyclesPerMinute: recipe.cyclesPerMinute / count, inputs: recipe.inputs.map(scale), outputs: recipe.outputs.map(scale), runningInputs: recipe.runningInputs.map(scale) })),
  } } satisfies BlueprintPlannerRequest };
}

/** 子网交付后重建整图的实体、连接、库存与探针；Host 必须再次对整图执行 Dense 验收。 */
export function combineRepeatedPlannerCandidate(registry: RegistryContract, request: BlueprintPlannerRequest,
  unit: PlannerCandidate, repetition: NonNullable<ReturnType<typeof repeatedPlannerRequest>>): PlannerCandidate {
  if (!unit.seed || unit.connections.length) throw new PlannerCandidateError("当前子网需要盒外存取线，不能直接组合。", unit.search);
  const restored = restorePlannerSeed(registry, repetition.request, unit.seed);
  if (restored.network.nodes.some(node => node.external || ["loader_1", "unloader_1"].includes(node.definition.id))) {
    throw new PlannerCandidateError("连续仓库口需要整图搜索。", unit.search);
  }
  const network: PlannerNetwork = { request: normalizePlannerSources(registry, request), nodes: [], slotLinks: [], initialSlots: [], preferredGasCount: restored.network.preferredGasCount * repetition.count };
  const wires: PlannerWire[] = [], routes: PlannerRouter["routes"] = [], entities: WorldEntity[] = [];
  const external = new Map<string, WorldEntity>(), externalLinks: SlotLinkDefinition[] = [], initialSlots: SimulationRuntimeSlotPatch[] = [];
  const scheduled: NonNullable<PlannerCandidate["execution"]["scene"]["scheduledSlots"]>[number][] = [];
  const probes = new Map<string, SimulationBlueprintProbe>();
  for (let index = 0; index < repetition.count; index++) {
    const prefix = `eda-unit-${index}:`, x = index % repetition.columns * unit.metrics.width, y = Math.floor(index / repetition.columns) * unit.metrics.height;
    const id = (value: string) => value === "warehouse" ? value : `${prefix}${value}`;
    const point = (value: { x: number; y: number }) => ({ x: value.x + x, y: value.y + y });
    const entity = (value: WorldEntity): WorldEntity => ({ ...structuredClone(value), id: id(value.id), position: point(value.position) });
    const link = (value: SlotLinkDefinition): SlotLinkDefinition => ({ ...value, id: `${prefix}${value.id}`,
      source: { ...value.source, entityId: id(value.source.entityId) }, target: { ...value.target, entityId: id(value.target.entityId) } });
    const patch = (value: SimulationRuntimeSlotPatch): SimulationRuntimeSlotPatch => ({ ...value, entityId: id(value.entityId) });
    const target = <T extends { entityId: string }>(value: T): T => ({ ...value, entityId: id(value.entityId) });
    const flow = (value: PlannerNode["inputs"][number]) => ({ ...value, sourceEntityIds: value.sourceEntityIds?.map(id) });
    network.nodes.push(...restored.network.nodes.map(node => ({ ...node, entity: entity(node.entity), inputs: node.inputs.map(flow), outputs: node.outputs.map(flow),
      supplyTarget: node.supplyTarget && target(node.supplyTarget), supplyTargets: node.supplyTargets?.map(target),
      outputSource: node.outputSource && target(node.outputSource), outputSources: node.outputSources?.map(target) })));
    network.slotLinks.push(...restored.network.slotLinks.map(link)); network.initialSlots.push(...restored.network.initialSlots.map(patch));
    const port = (value: PlannerWire["source"]) => ({ ...value, entityId: id(value.entityId), cell: point(value.cell), outside: point(value.outside) });
    wires.push(...restored.wires.map(wire => ({ ...wire, source: port(wire.source), target: port(wire.target) })));
    routes.push(...unit.seed.routes.map(route => ({ ...route, source: id(route.source), target: id(route.target),
      sourcePort: `${prefix}${route.sourcePort}`, targetPort: `${prefix}${route.targetPort}`, cells: route.cells.map(point) })));
    entities.push(...unit.execution.blueprint.entityOrder.map(key => entity(unit.execution.blueprint.entities[key]!)));
    for (const value of unit.execution.scene.externalEntities) if (!external.has(id(value.id))) external.set(id(value.id), value.id === "warehouse" ? structuredClone(value) : entity(value));
    externalLinks.push(...unit.execution.scene.externalSlotLinks.map(link)); initialSlots.push(...unit.execution.scene.initialSlots.map(patch));
    scheduled.push(...(unit.execution.scene.scheduledSlots ?? []).map(value => ({ ...value, patch: patch(value.patch) })));
    for (const probe of unit.execution.probes) {
      const isTarget = request.plan.targets.some(value => value.itemId === probe.id);
      const owner = probe.entityIds[0];
      if (!isTarget && (!owner || !probe.id.endsWith(owner))) throw new PlannerCandidateError("子网探针无法映射到整图。", unit.search);
      const key = isTarget ? probe.id : `${probe.id.slice(0, -owner!.length)}${id(owner!)}`;
      probes.set(key, { ...probe, id: key, entityIds: [...(probes.get(key)?.entityIds ?? []), ...probe.entityIds.map(id)] });
    }
  }
  const width = unit.metrics.width * repetition.columns, height = unit.metrics.height * repetition.rows, area = width * height;
  const quality = measurePlannerQuality(registry, network, entities, routes, area, width, height);
  const supplyAudit = auditPlannerSupply(registry, network, wires, routes);
  const blueprint = createBlueprintDocument({ ...unit.execution.blueprint, blueprintId: undefined,
    name: request.plan.name.trim() || `${unit.execution.blueprint.name} × ${repetition.count}`,
    description: `自动规划产线（EDA）\n范围：${width} × ${height}\n供电：外部供电，已布置供电桩`,
    entities: Object.fromEntries(entities.map(value => [value.id, value])), entityOrder: entities.map(value => value.id), slotLinks: network.slotLinks });
  const candidate: PlannerCandidate = { ...unit, supplyAudit, seed: { ...capturePlannerSeed(request, network, wires, routes, width, height), quality },
    search: { ...unit.search, repeatedUnits: repetition.count, outline: { width, height }, quality,
      wireCount: wires.length, bestRoutedWireCount: routes.length, layoutSnapshot: network.nodes.map(node => node.entity), routeSnapshot: undefined },
    metrics: { ...unit.metrics, width, height, area, entityCount: entities.length, productionDeviceCount: unit.metrics.productionDeviceCount * repetition.count,
      gasDiffuserCount: unit.metrics.gasDiffuserCount * repetition.count, additionalGasDiffuserCount: unit.metrics.additionalGasDiffuserCount * repetition.count,
      score: boundedPlannerScore(area, quality.secondary) },
    execution: { ...unit.execution, blueprint, probes: [...probes.values()], scene: { ...unit.execution.scene,
      externalEntities: [...external.values()], externalSlotLinks: externalLinks, initialSlots, scheduledSlots: scheduled } },
  };
  assertPlannerCandidateBounds(registry, candidate); assertPlannerWarehousePorts(registry, request, candidate);
  return candidate;
}
