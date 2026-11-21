import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SimulationBlueprintRunReport } from "@/domain/simulation";
import type { WorldEntity } from "@/domain/document/world-document";
import type { PlannerCandidate } from "./candidate";
import type { PlannerRouter } from "./router";
import { capturePlannerSeed, restorePlannerSeed, type PlannerSearchSeed } from "./search-seed";
import {
  compareDeliveryCost,
  deliveryCost,
  deliveryRouteKey,
  fitsDeliveryNode,
  recoverDeliveryLines,
  routeDeliveryGroup,
  type DeliveryLayout,
} from "./delivery-routing";
import { warehouseEdits, relocateSplitters, splitEdits, type DeliveryEdit } from "./delivery-proposals";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { allowsPlannerOverlap, cellKey } from "./geometry";
import { auditPlannerSupply } from "./supply-audit";
import { auditConverterSupply } from "./converter-routing";
import { boundedPlannerScore, measurePlannerQuality } from "./quality";
import {
  assertPlannerCandidateBounds,
  assertPlannerWarehousePorts,
  meetsOperatingLimits,
  meetsProductionTargets,
} from "./verification";
import { assertBlueprintRecognition, assertBlueprintSteadyState } from "./blueprint-analysis";
import { assertBlueprintPreserved } from "./blueprint-constraints";
import { yieldPlannerTask } from "./yield-task";
import { restorePlannerOutputRequest } from "./output-policy";

type Verified = { candidate: PlannerCandidate; report: SimulationBlueprintRunReport };
type Run = (candidate: PlannerCandidate) => Promise<SimulationBlueprintRunReport>;

function routeMap(router: Pick<PlannerRouter, "routes">) {
  return new Map(router.routes.map((r) => [r.sourcePort + ">" + r.targetPort, r]));
}
function geometryKey(e: WorldEntity) {
  return e.definitionId + "/" + e.rotation + "/" + cellKey(e.position);
}

function assertDeliveryPlacement(registry: RegistryContract, entities: readonly WorldEntity[]) {
  const occupied = new Map<string, WorldEntity[]>();
  for (const entity of entities) {
    const definition = registry.queries.findEntityDefinition(entity.definitionId)!;
    const rect = resolveEntityGridRect({ entity, definition });
    for (let y = rect.y; y < rect.y + rect.height; y++)
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const key = cellKey({ x, y }),
          prior = occupied.get(key) ?? [];
        if (
          prior.some(
            (other) =>
              !allowsPlannerOverlap(registry, definition, registry.queries.findEntityDefinition(other.definitionId)!),
          )
        ) {
          throw new Error(`物流拉直产生非法重叠：${entity.id} (${key})`);
        }
        prior.push(entity);
        occupied.set(key, prior);
      }
  }
}

/** 发布前单独验收副本。候选报告、续算种子和展示指标一起替换；已验收对象始终可用于回退。 */
export async function straightenVerifiedDelivery(
  registry: RegistryContract,
  request: BlueprintPlannerRequest,
  initial: Verified,
  run: Run,
  stopped: () => boolean = () => false,
  preservationSeed?: PlannerSearchSeed,
): Promise<Verified> {
  let accepted = initial;
  const seed = initial.candidate.seed;
  if (!seed?.wires.length || stopped()) return accepted;
  const started = performance.now();
  const stats = {
    trials: 0,
    relocationTrials: 0,
    forkTrials: 0,
    states: 0,
    simulations: 0,
    truncated: false,
    elapsedMs: 0,
    lastRejection: undefined as string | undefined,
  };
  const deadline = started + Math.min(initial.candidate.execution.maxWallTimeMs, 30000);
  const outOfTime = () => stopped() || performance.now() >= deadline;
  const note = (error: unknown) => {
    stats.lastRejection = error instanceof Error ? error.message : String(error);
  };
  try {
    const resolved = request.blueprintSource
      ? request
      : restorePlannerOutputRequest(request, seed.network.request.options);
    const { network, wires } = restorePlannerSeed(registry, resolved, seed);
    const originalRoutes = routeMap(seed);
    const blueprint = initial.candidate.execution.blueprint,
      origin = initial.candidate.outlineOrigin ?? { x: 0, y: 0 };
    const translate = (e: WorldEntity, sign: number): WorldEntity => ({
      ...e,
      position: { x: e.position.x + sign * origin.x, y: e.position.y + sign * origin.y },
    });
    const original = blueprint.entityOrder.map((id) => translate(blueprint.entities[id]!, -1));
    const nodeIds = new Set(network.nodes.map((n) => n.entity.id));
    const isTrack = (e: WorldEntity) =>
      !nodeIds.has(e.id) &&
      (registry.queries.isBelt(e.definitionId) ||
        registry.queries.isPipe(e.definitionId) ||
        registry.queries.resolveLogisticsRole(e.definitionId) === "connector");
    const originalTracks = original.filter(isTrack),
      others = original.filter((e) => !nodeIds.has(e.id) && !isTrack(e));
    const external = initial.candidate.execution.scene.externalEntities.map((e) => translate(e, -1));
    const fixed = [...others, ...external],
      { width, height, area } = initial.candidate.metrics;
    let layout: DeliveryLayout = {
      network,
      lines:
        originalRoutes.size === wires.length
          ? wires.map((wire) => ({ wire, cells: originalRoutes.get(deliveryRouteKey(wire))!.cells }))
          : recoverDeliveryLines(registry, wires, originalTracks),
    };
    const baseline = routeDeliveryGroup(registry, layout, fixed, width, height, [], () => true);
    if (
      !baseline ||
      originalTracks.some((e) => e.tags.length || Object.keys(e.config).length) ||
      originalTracks.map(geometryKey).sort().join("|") !== baseline.entities.map(geometryKey).sort().join("|")
    )
      return accepted;
    const trackIds = new Map(originalTracks.map((e) => [geometryKey(e), e.id]));
    const baselineCost = deliveryCost(
      registry,
      original,
      baseline.routes.reduce((s, r) => s + r.turns, 0),
    );
    const baselineLayout = layout;
    let cost = baselineCost;
    const baseEntityIds = new Set(blueprint.entityOrder);
    const seenIds = new Set([...blueprint.entityOrder, ...(request.blueprintSource?.blueprint.entityOrder ?? [])]);
    const positions = new Map(original.map((e) => [e.id, cellKey(e.position)]));
    const allowedControls = !request.blueprintSource || request.options.blueprintOptimizations?.rebuildLogistics;
    const stages = ["warehouse", "lines", "relocate", "split"] as const;
    for (let round = 0; round < 3; round++) {
      const before = accepted;
      for (const stage of stages) {
        if (outOfTime()) break;
        if ((stage === "split" || stage === "relocate") && !allowedControls) continue;
        const splitStage = stage === "split" || stage === "relocate";
        if (splitStage && round > 0) continue;
        let fuel = splitStage ? 16000 : 200_000,
          trials = 0;
        const trialLimit = stage === "relocate" ? 8 : stage === "split" ? 4 : 160;
        const routeFacts = routeMap(accepted.candidate.seed?.routes.length ? accepted.candidate.seed : baseline);
        const singleLines = function* (): Generator<DeliveryEdit> {
          for (const [i, { wire, cells }] of layout.lines.entries()) {
            const a = wire.source.outside,
              b = wire.target.outside;
            if (cells.length <= 1) continue;
            if (
              cells.length === Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + 1 &&
              !cells.some((p) => bridges.has(wire.source.kind + cellKey(p))) &&
              (routeFacts.get(deliveryRouteKey(wire))?.turns ?? 0) <= 1
            )
              continue;
            yield { layout, changed: [i] };
          }
        };
        const bridges = new Set(
          Object.values(accepted.candidate.execution.blueprint.entities)
            .filter((e) => registry.queries.resolveLogisticsRole(e.definitionId) === "connector")
            .map(
              (e) =>
                (registry.queries.isPipeFamily(e.definitionId) ? "pipe" : "belt") + cellKey(translate(e, -1).position),
            ),
        );
        const edits =
          stage === "warehouse"
            ? warehouseEdits(registry, layout)
            : stage === "relocate" ? relocateSplitters(registry, layout)
            : stage === "split"
              ? splitEdits(registry, layout)
              : singleLines();
        type Proposal = { layout: DeliveryLayout; router: PlannerRouter; cost: typeof cost };
        const proposals: Proposal[] = [];
        for (const edit of edits) {
          if (fuel <= 0 || ++trials > trialLimit || outOfTime()) {
            stats.truncated = true;
            break;
          }
          stats.trials++;
          if (stage === "relocate") stats.relocationTrials++;
          if (stage === "split") stats.forkTrials++;
          if (trials % 4 === 0) await yieldPlannerTask();
          const entities = edit.layout.network.nodes.map((n) => n.entity);
          if (
            entities.some(
              (e) =>
                positions.get(e.id) !== cellKey(e.position) &&
                !fitsDeliveryNode(registry, e, [...entities.filter((other) => other.id !== e.id), ...fixed]),
            )
          )
            continue;
          let localFuel = splitStage ? 4000 : 20000;
          const router = routeDeliveryGroup(
            registry,
            edit.layout,
            fixed,
            width,
            height,
            edit.changed,
            () => {
              stats.states++;
              if (--fuel < 0 || --localFuel < 0) {
                stats.truncated = true;
                return false;
              }
              return true;
            },
            () => {
              stats.truncated = true;
            },
          );
          if (!router) continue;
          const nextCost = deliveryCost(
            registry,
            [...entities, ...others, ...router.entities],
            router.routes.reduce((s, r) => s + r.turns, 0),
          );
          if (compareDeliveryCost(nextCost, cost) >= 0) continue;
          const paths = routeMap(router);
          const nextLayout = {
            network: edit.layout.network,
            lines: edit.layout.lines.map(({ wire }) => ({ wire, cells: paths.get(deliveryRouteKey(wire))!.cells })),
          };
          if (stage === "split") {
            try {
              const audit = request.blueprintSource ? auditConverterSupply : auditPlannerSupply;
              audit(
                registry,
                nextLayout.network,
                nextLayout.lines.map((l) => l.wire),
                router.routes,
              );
            } catch (error) {
              note(error);
              continue;
            }
          }
          proposals.push({ layout: nextLayout, router, cost: nextCost });
          proposals.sort((a, b) => compareDeliveryCost(a.cost, b.cost));
          if (proposals.length > 8) proposals.pop();
          if (stage === "lines") {
            // 每条独立改进成为下一条的起点；整批只需一次正式仿真。
            layout = nextLayout;
            cost = nextCost;
          }
        }
        for (const proposal of proposals.slice(0, splitStage ? 1 : 3)) {
          if (outOfTime() || stats.simulations >= 8) {
            stats.truncated = true;
            break;
          }
          const net = proposal.layout.network,
            routes = proposal.router.routes,
            nextWires = proposal.layout.lines.map((l) => l.wire);
          try {
            const recalculated = request.blueprintSource
              ? auditConverterSupply(registry, net, nextWires, routes)
              : auditPlannerSupply(registry, net, nextWires, routes);
            const limits = new Map(recalculated.operatingLimits.map((limit) => [limit.entityId, limit]));
            for (const limit of initial.candidate.supplyAudit.operatingLimits) {
              const current = limits.get(limit.entityId);
              if (!current || limit.perMinute < current.perMinute) limits.set(limit.entityId, limit);
            }
            const supplyAudit = { ...recalculated, operatingLimits: [...limits.values()] };
            const used = new Set<string>([...net.nodes.map((n) => n.entity.id), ...others.map((e) => e.id)]);
            const tracks = proposal.router.entities.map((e, i) => {
              let id = trackIds.get(geometryKey(e));
              if (!id) {
                id = "delivery-route-" + i;
                while (seenIds.has(id) || used.has(id)) id += "_";
              }
              used.add(id);
              return { ...e, id };
            });
            const entities = [...net.nodes.map((n) => n.entity), ...others, ...tracks].map((e) => translate(e, 1));
            assertDeliveryPlacement(registry, [...entities, ...initial.candidate.execution.scene.externalEntities]);
            const nextBlueprint = {
              ...blueprint,
              entities: Object.fromEntries(entities.map((e) => [e.id, e])),
              entityOrder: [
                ...blueprint.entityOrder.filter((id) => used.has(id)),
                ...entities.map((e) => e.id).filter((id) => !baseEntityIds.has(id)),
              ],
            };
            const quality = measurePlannerQuality(registry, net, entities, routes, area, width, height);

            const operating = supplyAudit.operatingLimits.map((l) => ({
              id: "operating:" + l.entityId,
              direction: "output" as const,
              itemId: l.itemId,
              entityIds: [l.entityId],
            }));
            const candidate: PlannerCandidate = {
              ...initial.candidate,
              seed: { ...capturePlannerSeed(resolved, net, nextWires, routes, width, height), unitKey: seed.unitKey },
              supplyAudit,
              metrics: {
                ...initial.candidate.metrics,
                entityCount: entities.length,
                score: boundedPlannerScore(area, quality.secondary),
              },
              search: {
                ...initial.candidate.search,
                quality: request.blueprintSource ? { ...quality, outputStashCount: 0 } : quality,
              },
              execution: {
                ...initial.candidate.execution,
                blueprint: nextBlueprint,
                probes: [
                  ...initial.candidate.execution.probes.filter((p) => !p.id.startsWith("operating:")),
                  ...operating,
                ],
              },
            };
            assertPlannerCandidateBounds(registry, candidate);
            assertPlannerWarehousePorts(registry, request, candidate);
            if (request.blueprintSource)
              assertBlueprintPreserved(registry, request, preservationSeed ?? seed, nextBlueprint, candidate.seed);
            stats.simulations++;
            const remainingMs = Math.ceil(deadline - performance.now());
            if (remainingMs <= 0) {
              stats.truncated = true;
              break;
            }
            const report = await run({
              ...candidate,
              execution: {
                ...candidate.execution,
                maxWallTimeMs: Math.min(candidate.execution.maxWallTimeMs, remainingMs),
              },
            });
            if (report.status === "timeout") stats.truncated = true;
            if (!meetsProductionTargets(request, report) || !meetsOperatingLimits(supplyAudit, report)) {
              stats.lastRejection =
                report.diagnostics.find((d) => d.severity === "error")?.message ?? "候选未通过产量或运行供料验收。";
              continue;
            }
            if (request.blueprintSource) {
              assertBlueprintRecognition(registry, { ...request.blueprintSource, blueprint: nextBlueprint }, report);
              assertBlueprintSteadyState(registry, report, candidate.execution.probes);
            }
            accepted = { candidate, report };
            layout = proposal.layout;
            cost = proposal.cost;
            break;
          } catch (error) {
            note(error);
          }
        }
        // 几何改进可能整批回退；下一阶段只读已经通过仿真的网表。
        if (accepted === initial) {
          layout = baselineLayout;
          cost = baselineCost;
          continue;
        }
        const verifiedSeed = accepted.candidate.seed!;
        const restored = restorePlannerSeed(registry, resolved, verifiedSeed),
          paths = routeMap(verifiedSeed);
        layout = {
          network: restored.network,
          lines: restored.wires.map((wire) => ({ wire, cells: paths.get(deliveryRouteKey(wire))!.cells })),
        };
        cost = deliveryCost(
          registry,
          Object.values(accepted.candidate.execution.blueprint.entities),
          verifiedSeed.routes.reduce((s, r) => s + r.turns, 0),
        );
      }
      if (accepted === before || outOfTime() || stats.simulations >= 8) break;
      if (round === 2) stats.truncated = true;
    }
  } catch (error) {
    note(error);
  }
  if (outOfTime()) stats.truncated = true;
  stats.elapsedMs = performance.now() - started;
  return {
    ...accepted,
    candidate: { ...accepted.candidate, search: { ...accepted.candidate.search, straightening: stats } },
  };
}
