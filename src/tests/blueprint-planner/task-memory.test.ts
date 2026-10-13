// @vitest-environment node
import { expect, it } from "vitest";
import { createRegistryContract } from "@/registry";
import { clonePlannerTask } from "@/blueprint-planner/task-memory";
import { PlannerSearchPortfolio } from "@/blueprint-planner/search-portfolio";
import { capturePlannerSeed } from "@/blueprint-planner/search-seed";
import { createProductionNetwork } from "@/blueprint-planner/production-network";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import fixture from "./fixtures/yazhen-syringe.json";

it("旧任务完整排除规则归一化并共享相同种子，保留原件与分片计数", () => {
  const registry = createRegistryContract(), request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  const seed = capturePlannerSeed(request, createProductionNetwork(registry, request), [], [], 20, 20);
  const key = "portGroups[0].ports[0].acceptRule";
  const exclude = registry.itemDefinitions.map(item => item.id);
  seed.network.nodes[0]!.entity.config[key] = { base: { kind: "domain", flags: 1 }, exclude };
  const source = { shards: Array.from({ length: 32 }, (_, visits) => ({ visits, seed: structuredClone(seed) })) };
  const original = JSON.stringify(source), copied = clonePlannerTask(source, registry);
  expect(JSON.stringify(source)).toBe(original);
  expect(copied.shards.map(shard => shard.visits)).toEqual(source.shards.map(shard => shard.visits));
  expect(copied.shards[0]!.seed.network.nodes[0]!.entity.config[key]).toEqual({ base: { kind: "none" }, exclude: [] });
  expect(new Set(copied.shards.map(shard => shard.seed)).size).toBe(1);
  expect(copied.shards[0]!.seed).not.toBe(source.shards[0]!.seed);
  expect(clonePlannerTask(copied, registry)).toEqual(copied);
  const partial = { [key]: { base: { kind: "domain", flags: 1 }, exclude: exclude.slice(1) } };
  expect(clonePlannerTask(partial, registry)).toEqual(partial);
  // 原图配置参与保真验证及 requestKey；即使等价也必须保留原始表达。
  for (const request of [{ blueprintSource: { blueprint: partial } }, { kind: "blueprint-recognition" }]) {
    const originalMode = { request, ...source };
    expect(clonePlannerTask(originalMode, registry)).toEqual(originalMode);
  }
});

it("分片共享不可变种子，访问计数和回滚快照互不影响", () => {
  const registry = createRegistryContract(), request = structuredClone(fixture.request) as BlueprintPlannerRequest;
  const seed = capturePlannerSeed(request, createProductionNetwork(registry, request), [], [], 20, 20);
  const first = new PlannerSearchPortfolio(request, seed), before = first.snapshot();
  const second = new PlannerSearchPortfolio(request); second.restore(before);
  const strategy = { ...plannerAttemptStrategy(0), restart: false };
  expect(first.next(0, true, undefined, undefined, strategy).continuationStep).toBe(0);
  expect(first.next(1, true, undefined, undefined, strategy).continuationStep).toBe(1);
  expect(second.next(0, true, undefined, undefined, strategy).continuationStep).toBe(0);
  expect(before.pools[0]!.entries[0]!.visits).toBe(0);
  expect(second.snapshot().pools[0]!.entries[0]!.seed).toBe(seed);
  expect(() => { Object.assign(seed.network.nodes[0]!.entity.position, { x: 123 }); }).toThrow();
  first.restore(before);
  expect(first.next(2, true, undefined, undefined, strategy).continuationStep).toBe(0);
});


it("完整排除列表也不能掩盖非法 domain 标志或额外配置", () => {
  const registry = createRegistryContract(), key = "portGroups[0].ports[0].acceptRule";
  for (const base of [{ kind: "domain", flags: "1" }, { kind: "domain", flags: -1 },
    { kind: "domain", flags: 1024 }, { kind: "domain", flags: 1, unexpected: true }]) {
    const value = { [key]: { base, exclude: registry.itemDefinitions.map(item => item.id) } };
    expect(clonePlannerTask(value, registry)).toEqual(value);
  }
});
