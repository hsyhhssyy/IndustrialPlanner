import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { PlannerBoundary } from "./boundary";
import type { PlannerCandidate } from "./candidate";
import type { PlannerNetwork } from "./model";
import { restorePlannerOutputRequest } from "./output-policy";
import { createPlainNode } from "./placement";
import { boundedPlannerScore, measurePlannerQuality } from "./quality";
import { capturePlannerSeed, plannerRequestKey, restorePlannerSeed } from "./search-seed";
import { stashSubmissionProbe } from "./stash-submission";

const isBus = (definitionId: string) => definitionId === "log_hongs_bus" || definitionId === "log_hongs_bus_source";

/** 只移除盒外设施并整体平移，不替旧布局移动口位；不满足新边界的布局不能作为最优解。 */
// AI-CORRECTION 2026-10-11：同时移除旧排空夹具、补齐自动规划遗漏的提交默认配置，再采集真实提交配方运行证据；不覆盖显式配置。
export function migratePlannerCandidate(registry: RegistryContract, request: BlueprintPlannerRequest,
  original: PlannerCandidate): PlannerCandidate | null {
  const candidate = structuredClone(original);
  const blueprint = candidate.execution.blueprint;
  const entities = blueprint.entityOrder.map(id => blueprint.entities[id]!).filter(entity => !isBus(entity.definitionId));
  if (!entities.length) return null;
  // 旧自动规划漏写放置默认配置；只补缺省字段，不覆盖显式关闭提交的配置，也不改用户原图。
  if (!request.blueprintSource) for (const entity of entities.filter(entity => entity.definitionId === "storager_1")) {
    if (entity.config.channelRecipes !== undefined) continue;
    entity.config.channelRecipes = structuredClone(registry.queries.findEntityDefinition(entity.definitionId)!.placementDefaults?.config?.channelRecipes);
    const node = candidate.seed?.network.nodes.find(node => node.entity.id === entity.id);
    if (node) node.entity.config.channelRecipes = structuredClone(entity.config.channelRecipes);
  }
  const rectangles = entities.map(entity => resolveEntityGridRect({ entity,
    definition: registry.queries.findEntityDefinition(entity.definitionId)! }));
  const origin = { x: Math.min(...rectangles.map(rect => rect.x)), y: Math.min(...rectangles.map(rect => rect.y)) };
  const width = Math.max(...rectangles.map(rect => rect.x + rect.width)) - origin.x;
  const height = Math.max(...rectangles.map(rect => rect.y + rect.height)) - origin.y;
  const area = width * height;
  if (![origin.x, origin.y, width, height, area].every(Number.isSafeInteger) || width <= 0 || height <= 0) return null;
  const translate = (point: { x: number; y: number }) => ({ x: point.x - origin.x, y: point.y - origin.y });
  for (const entity of entities) entity.position = translate(entity.position);
  blueprint.entities = Object.fromEntries(entities.map(entity => [entity.id, entity]));
  blueprint.entityOrder = entities.map(entity => entity.id);
  blueprint.initialGridPoint = { x: 0, y: 0 };
  const connections = candidate.connections.map(connection => ({ ...connection, position: translate(connection.position) }));
  // 边界检查直接使用交付实体，避免缺失或过期种子掩盖仓库口和外接入口。
  const network: PlannerNetwork = { request, slotLinks: blueprint.slotLinks, initialSlots: [], preferredGasCount: 0,
    nodes: entities.map(entity => ({ ...createPlainNode(registry, entity.definitionId, entity.id, "logistics"), entity,
      external: connections.some(connection => connection.direction === "input"
        && connection.position.x === entity.position.x && connection.position.y === entity.position.y) })) };
  const boundary = new PlannerBoundary(registry, network, { width, height });
  const resolved = boundary.resolve(network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation })));
  if (resolved.violations !== 0 || resolved.busMask === null) return null;
  const fixtures = boundary.fixtures(resolved.busMask);
  const externalEntities = (candidate.execution.scene?.externalEntities ?? []).filter(entity => !isBus(entity.definitionId)
    && !entity.id.startsWith("__eda_fixture_") && !entity.id.startsWith("eda-validation-drain-") && !entity.id.startsWith("eda-validation-sink-"))
    .map(entity => ({ ...entity, position: translate(entity.position) }));
  let seed: PlannerCandidate["seed"];
  let quality = measurePlannerQuality(registry, network, entities, [], area, width, height);
  if (candidate.seed) {
    const old = candidate.seed;
    const seedOptions = { ...old.network.request.options,
      warehouseBus: (old.network.request.options.warehouseBus as string) === "free" ? "corner" as const : old.network.request.options.warehouseBus };
    const seedRequest = restorePlannerOutputRequest(request, seedOptions);
    const keyedRequest = JSON.parse(old.requestKey) as BlueprintPlannerRequest;
    if ((keyedRequest.options.warehouseBus as string) === "free") Object.assign(keyedRequest.options, { warehouseBus: "corner" });
    if (plannerRequestKey(keyedRequest) !== plannerRequestKey(seedRequest)) throw new Error("旧最优布局的种子与输入配置不一致。");
    const nodes = old.network.nodes.filter(node => !isBus(node.entity.definitionId));
    for (const node of nodes) {
      const entity = blueprint.entities[node.entity.id];
      const position = translate(node.entity.position);
      if (!entity || entity.definitionId !== node.entity.definitionId || entity.rotation !== node.entity.rotation
        || entity.position.x !== position.x || entity.position.y !== position.y) throw new Error("旧最优布局的种子与蓝图不一致。");
    }
    const restored = restorePlannerSeed(registry, seedRequest, { ...old, requestKey: plannerRequestKey(seedRequest),
      network: { ...old.network, request: { ...old.network.request, options: seedOptions }, nodes } });
    seed = capturePlannerSeed(seedRequest, restored.network, restored.wires, old.routes, width, height, origin);
    const current = restorePlannerSeed(registry, seedRequest, seed);
    quality = measurePlannerQuality(registry, current.network, entities, seed.routes, area, width, height);
  } else if (candidate.search.quality) {
    // 早期结果可能没有续搜种子：保留已验证的物流成本，只重算几何项，后续从新布局搜索。
    const previous = candidate.search.quality;
    const aspect = (w: number, h: number) => (Math.max(w / h, h / w) - 1) ** 2;
    quality = { ...previous, occupiedCells: quality.occupiedCells, utilization: quality.utilization,
      adjacencyPairs: quality.adjacencyPairs, secondary: previous.secondary
        - aspect(candidate.metrics.width, candidate.metrics.height) + aspect(width, height)
        + (previous.adjacencyPairs - quality.adjacencyPairs) * 0.2 };
  }
  const sides = ["上", "右", "下", "左"].filter((_, side) => resolved.busMask! & (1 << side));
  blueprint.description = `${blueprint.description ?? ""}\n按当前规则重算：${width} × ${height}；存取线${sides.length ? `请在包围盒外${sides.join("、")}侧自行放置` : "无需接入"}。`;
  return { ...candidate, seed, connections, search: { ...candidate.search, quality },
    metrics: { ...candidate.metrics, width, height, area, entityCount: entities.length, score: boundedPlannerScore(area, quality.secondary) },
    execution: { ...candidate.execution, blueprint, collectAnalysis: true,
      probes: [...candidate.execution.probes.filter(probe => !probe.id.startsWith("stash-submit:")),
        ...entities.filter(entity => entity.definitionId === "storager_1").map(entity => {
          const input = candidate.seed?.network.nodes.find(node => node.entity.id === entity.id)?.inputs[0];
          const itemId = input?.itemId ?? candidate.execution.probes.find(probe => probe.direction === "input" && probe.entityIds.includes(entity.id))?.itemId;
          if (!itemId) throw new Error("旧协议储存箱缺少物品证据，无法重新验收。");
          return stashSubmissionProbe(entity.id, itemId);
        })], scene: { ...candidate.execution.scene, externalEntities: [...externalEntities, ...fixtures] } } };
}
