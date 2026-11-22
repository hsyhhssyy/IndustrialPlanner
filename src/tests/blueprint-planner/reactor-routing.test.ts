// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createSimulationHost } from "@/simulation/simulation-host";
import { PlannerRouter } from "@/blueprint-planner/router";
import { loadBlueprintFromFile } from "../simulation/blueprint-test-helpers";
import { getPlannerPorts, plannerPortAcceptsItem } from "@/blueprint-planner/geometry";
import { createPlainNode, PlannerPlacement } from "@/blueprint-planner/placement";
import type { PlannerNetwork, PlannerNode } from "@/blueprint-planner/model";
import { routeThroughReactors } from "@/blueprint-planner/reactor-routing";
import type { PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import { runPlannerBatch } from "@/scripts/eda/planner-runner";
import { plannerUnitStrategy } from "@/blueprint-planner/search-unit";
import { wireProductionNetwork, placedReactorTransit, type Connection } from "@/blueprint-planner/wiring";
import yazhen from "./fixtures/yazhen-syringe.json";
import bottling from "./fixtures/bottling-plant-cycle.json";

const registry = createRegistryContract();
const solid = "item_plant_moss_3";
const water = "item_liquid_water";

function device(definition: string, id: string, x: number) {
  const node = createPlainNode(registry, definition, id, "production");
  node.entity.position = { x, y: 3 };
  return node;
}

function edge(source: PlannerNode, target: PlannerNode, item: string, rate: number): Connection {
  return { source: getPlannerPorts(registry, source.entity, source.definition, "output", item)[0]!,
    target: getPlannerPorts(registry, target.entity, target.definition, "input", item)[0]!, amounts: new Map([[item, rate]]) };
}

function total(edges: Connection[], from: string, to: string, item: string) {
  return edges.filter(e => e.source.entityId === from && e.target.entityId === to)
    .reduce((sum, e) => sum + (e.amounts.get(item) ?? 0), 0);
}

it.each(["mix_pool_1", "mix_pool_2"])("接线入口把闲置固液口配置为真实透传线路 %s", async definition => {
  for (const item of [solid, water]) {
    const pool = device(definition, "pool", 10);
    const source = device("mix_pool_1", "a", 0), sink = device("mix_pool_1", "b", 20);
    source.outputs.push({ itemId: item, perMinute: 10 });
    sink.inputs.push({ itemId: item, perMinute: 10 });
    const network: PlannerNetwork = { request: structuredClone(bottling) as BlueprintPlannerRequest,
      nodes: [source, pool, sink], preferredGasCount: 0, slotLinks: [], initialSlots: [] };
    const wires = await wireProductionNetwork(registry, network, new PlannerPlacement(registry, 50),
      undefined, false, false, false, undefined, undefined, undefined, 1);
    expect(wires.map(w => [w.source.entityId, w.target.entityId, w.perMinute])).toEqual([["a", "pool", 10], ["pool", "b", 10]]);
    for (const port of [wires[0]!.target, wires[1]!.source]) {
      expect(plannerPortAcceptsItem(registry, pool.entity, pool.definition, port, item)).toBe(true);
      expect(plannerPortAcceptsItem(registry, pool.entity, pool.definition, port, item === water ? solid : water)).toBe(false);
    }
  }
});

it("复用已有入池支路，先合算端口吞吐，再保留下游剩余的直接供料", () => {
  const a = device("furnance_1", "a", 0), b = device("shaper_1", "b", 20), p = device("mix_pool_1", "p", 10);
  const other = device("furnance_1", "other", 5);
  const edges = [edge(a, p, solid, 10), edge(other, p, solid, 14), edge(a, b, solid, 10)];
  routeThroughReactors(registry, [p], edges, 1, () => {});
  expect(total(edges, "a", "p", solid)).toBe(16);
  expect(total(edges, "p", "b", solid)).toBe(6);
  expect(total(edges, "a", "b", solid)).toBe(4);
  expect(total(edges, "other", "p", solid)).toBe(14);
});

it("两个池可串联，重复游标恢复相同端口和流量", () => {
  const a = device("furnance_1", "a", 0), b = device("shaper_1", "b", 30);
  const pools = [device("mix_pool_1", "p", 8), device("mix_pool_2", "q", 16)];
  const run = (cursor: number) => {
    const edges = [edge(a, b, solid, 10)];
    routeThroughReactors(registry, pools, edges, cursor, () => {});
    return edges;
  };
  let found = false;
  for (let cursor = 1; cursor <= 160 && !found; cursor++) {
    const edges = run(cursor);
    if (pools.some(p => pools.some(q => total(edges, p.entity.id, q.entity.id, solid) === 10))) {
      expect(run(cursor)).toEqual(edges);
      expect(edges).toHaveLength(3);
      found = true;
    }
  }
  expect(found).toBe(true);
});

it("普通接法和借池选项可独立重访和恢复", () => {
  const catalog = { outputs: [0], packings: ["1"], converters: [0], reductions: [], conduits: ["shared"] as const, reactors: true as const };
  const seen = new Set<string>();
  for (let cursor = 0; cursor < 20; cursor++) {
    const strategy = plannerUnitStrategy(catalog, "20/20/any/any", cursor, 17);
    expect(plannerUnitStrategy(JSON.parse(JSON.stringify(catalog)), "20/20/any/any", cursor, 17)).toEqual(strategy);
    if (cursor % 2 === 0) expect(strategy.reactorCursor).toBeUndefined();
    seen.add(strategy.unitKey!);
  }
  expect(seen.size).toBeGreaterThan(2);
});

it("真实铺带后 Dense 在反应池生产期间持续从池口送出砂叶", async () => {
  const blueprint = loadBlueprintFromFile("src/tests/fixtures/blueprints/blueprint-planner/recipe-stability/multichannel-idle.schema7.json");
  const pool = device("mix_pool_1", "reactor", 15);
  pool.entity.position = { ...pool.entity.position, y: 12 };
  pool.entity.config = structuredClone(blueprint.entities.reactor!.config);
  const source = device("cheat_infinite_solid", "feed", 15), sink = device("storager_1", "sink", 15);
  source.entity.position = { ...source.entity.position, y: 4 };
  sink.entity.position = { ...sink.entity.position, y: 24 };
  source.outputs.push({ itemId: solid, perMinute: 30 });
  sink.inputs.push({ itemId: solid, perMinute: 30 });
  source.entity.config["storageSlotGroups[1].slots[0].initialItemType"] = solid;
  source.entity.config["storageSlotGroups[1].slots[0].initialCount"] = 50;
  const network: PlannerNetwork = { request: structuredClone(bottling) as BlueprintPlannerRequest,
    nodes: [source, pool, sink], preferredGasCount: 0, slotLinks: [], initialSlots: [] };
  const wires = await wireProductionNetwork(registry, network, new PlannerPlacement(registry, 50), undefined,
    false, false, false, undefined, undefined, undefined, 1);
  const power = device("power_diffuser_1", "power", 20);
  power.entity.position = { ...power.entity.position, y: 16 };
  const devices = [...network.nodes.map(n => n.entity), power.entity];
  const router = new PlannerRouter(registry, devices, wires.flatMap(w => [w.source, w.target]),
    { minimumX: 0, minimumY: 0, maximumX: 40, maximumY: 40, escapeLength: 0 });
  for (const wire of wires) await router.connect(wire.source, wire.target, () => {});
  const entities = [...devices, ...router.entities];
  const host = createSimulationHost({ state: createWorkspaceState(), registry, app: null, audio: null,
    editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null },
  { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  try {
    const report = await host.actions.runBlueprint({ blueprint: { ...blueprint,
      entities: Object.fromEntries(entities.map(entity => [entity.id, entity])), entityOrder: entities.map(entity => entity.id) },
      engine: { kind: "dense-v2", ticksPerSecond: 2 }, scene: { externalEntities: [], externalSlotLinks: [],
        initialSlots: [], powerMode: "infinite" }, probes: [], warmupSeconds: 50, observationSeconds: 20,
      inventorySampleCount: 5, maxWallTimeMs: 10_000, activeActivityIds: [], collectAnalysis: true });
    expect(report.status).toBe("completed");
    expect(report.analysis!.channels.some(channel => channel.entityId === pool.entity.id && channel.observedRecipeIds.length > 0)).toBe(true);
    const received = report.analysis!.transfers.filter(row => row.targetPortId.startsWith("device:sink/") && row.itemId === solid);
    expect(received.reduce((sum, row) => sum + row.windowAmounts.reduce((a, b) => a + b, 0), 0)).toBe(10);
  } finally { await host.dispose(); }
});

it("竞争最后的出口时枚举先后两种用途，分批重放获得相同的完整单跳集合", () => {
  const a = device("furnance_1", "a", 0), d = device("furnance_1", "d", 1);
  const b = device("shaper_1", "b", 18), c = device("shaper_1", "c", 20);
  const p = device("mix_pool_1", "p", 8);
  const occupied = edge(p, b, "item_copper_nugget", 30);
  const collect = (from: number, until: number) => {
    const result = new Set<string>();
    for (let cursor = from; cursor < until; cursor++) {
      const connections = [structuredClone(occupied), edge(a, b, solid, 30), edge(d, c, solid, 30)];
      routeThroughReactors(registry, [p], connections, cursor, () => {});
      const output = connections.find(e => e.source.entityId === "p" && e.amounts.has(solid));
      result.add(output ? output.target.entityId : "direct");
      expect(connections.find(e => e.amounts.has("item_copper_nugget"))).toEqual(occupied);
    }
    return result;
  };
  // 两个待接下游、两个可用入口、一个可用出口，共四个单跳候选，另有普通接法。
  const complete = collect(0, 5);
  expect(complete).toEqual(new Set(["direct", "b", "c"]));
  expect(new Set([...collect(0, 2), ...collect(2, 5)])).toEqual(complete);
});

it("芽针真实规划中反应池自用清水并向下游供水，完整产线通过稳态验收", async () => {
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const result = await runPlannerBatch(request, { engineKind: "dense-v2", attempts: 1, startVariant: 3,
    localEvaluations: 50_000, candidateSeconds: 90, verificationSeconds: 90,
    attemptStrategy: { ...plannerAttemptStrategy(3), reactorCursor: 1 } });
  const record = result.records[0]!;
  expect(record.outcome).toBe("success");
  expect(record.measuredOutputs).toContainEqual(expect.objectContaining({ id: "item_bottled_rec_hp_5", perMinute: 6 }));
  const seed = JSON.parse(readFileSync(`${record.artifactPath}/search-seed.json`, "utf8")) as PlannerSearchSeed;
  const pool = seed.network.nodes.find(node => node.entity.definitionId === "mix_pool_1")!;
  const forwarded = seed.wires.filter(w => w.source.entityId === pool.entity.id && w.itemIds.includes(water));
  const received = seed.wires.filter(w => w.target.entityId === pool.entity.id && w.itemIds.includes(water));
  const sum = (wires: typeof forwarded) => wires.reduce((total, wire) => total + wire.perMinute, 0);
  expect(sum(forwarded)).toBeGreaterThan(0);
  expect(sum(received) - sum(forwarded)).toBeCloseTo(pool.inputs.find(input => input.itemId === water)!.perMinute);
}, 210_000);

it("逐格铺线时采用当前摆位和空闲端口，失败回退保留原接法及出口过滤", () => {
  const p = device("mix_pool_1", "p", 5), a = device("furnance_1", "a", 0), b = device("shaper_1", "b", 30);
  const network: PlannerNetwork = { request: structuredClone(bottling) as BlueprintPlannerRequest,
    nodes: [p, a, b], initialSlots: [], slotLinks: [], preferredGasCount: 0 };
  const original = [{ ...edge(a, b, solid, 10), itemIds: [solid], perMinute: 10 }];
  p.entity.rotation = 90;
  p.entity.position = { ...p.entity.position, x: 20 };
  const selected = placedReactorTransit(registry, network, original, 0, new Set(), () => {})!;
  expect(selected.wires).toHaveLength(2);
  expect(selected.wires[0]!.target.cell.x).toBeGreaterThanOrEqual(20);
  expect(selected.wires[1]!.source.entityId).toBe("p");
  expect(selected.network.nodes[0]!.entity.config).not.toEqual({});
  expect(network.nodes[0]!.entity.config).toEqual({});
  expect(original[0]!.target.entityId).toBe("b");
  expect(placedReactorTransit(registry, network, original, 0, new Set([0]), () => {})).toBeNull();
});

it("同一股料可从 A、B 合流进 P 自用，再经 Q 自用转供，由第三条进线补足末端", () => {
  const a = device("furnance_1", "a", 0), b = device("furnance_1", "b", 5), other = device("furnance_1", "other", 10);
  const p = device("mix_pool_1", "p", 15), q = device("mix_pool_2", "q", 25), d = device("shaper_1", "d", 30);
  let edges = [edge(a, p, solid, 6), edge(a, q, solid, 4), edge(a, d, solid, 2),
    edge(b, d, solid, 8), edge(other, d, solid, 5)];
  for (const [source, through, target, rate] of [
    ["a", "p", "q", 4], ["a", "p", "d", 2], ["b", "p", "d", 8], ["p", "q", "d", 10],
  ] as const) {
    const before = total(edges, source, through, solid);
    let selected = false;
    for (let cursor = 1; cursor <= 128; cursor++) {
      const candidate = structuredClone(edges);
      routeThroughReactors(registry, [p, q], candidate, cursor, () => {});
      if (total(candidate, source, through, solid) !== before + rate || total(candidate, source, target, solid) !== 0) continue;
      // 下一步要复用同一条物理干线，仅保留端口一致、已合并的候选。
      if (candidate.filter(e => e.source.entityId === through && e.target.entityId === target).length !== 1) continue;
      edges = candidate;
      selected = true;
      break;
    }
    expect(selected).toBe(true);
  }
  expect(total(edges, "a", "p", solid) + total(edges, "b", "p", solid)).toBe(20);
  expect(total(edges, "p", "q", solid)).toBe(14);
  expect(total(edges, "q", "d", solid)).toBe(10);
  expect(total(edges, "other", "d", solid)).toBe(5);
});
