// @vitest-environment node
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { createPlannerCandidate } from "@/blueprint-planner/candidate";
import { CompactLayoutSearch } from "@/blueprint-planner/compact-layout";
import { PartitionLayoutSearch } from "@/blueprint-planner/partition-layout";
import { PlannerCandidateError } from "@/blueprint-planner/model";
import { restorePlannerSeed, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import { PlannerSearchSessions } from "@/blueprint-planner/search-sessions";
import type { PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import { plannerUnitStrategy } from "@/blueprint-planner/search-unit";
import { NodePlannerClient } from "@/scripts/eda/node-planner-client";
import requestFixture from "./fixtures/partition-cold-request.json";
import pinFixture from "./fixtures/port-feedback-escape.json";

it("模块外接端口必须能到达边界，不能因内部没有线路而接受封死接口", async () => {
  const registry = createRegistryContract();
  const { network, wires } = restorePlannerSeed(registry, pinFixture.request as BlueprintPlannerRequest, pinFixture.seed as PlannerSearchSeed);
  const statistics = (): PlannerSearchStatistics => ({ seed: 0, evaluationLimit: 0, evaluations: 0,
    acceptedMoves: 0, routingAttempts: 0, initialWireLength: 0, finalWireLength: 0,
    outline: { width: pinFixture.seed.width, height: pinFixture.seed.height }, strategy: "compact" });
  const fixed = new Set(network.nodes.map(node => node.entity.id));
  const ordinary = new CompactLayoutSearch(registry, network, [], statistics(), undefined, undefined, fixed);
  expect(await ordinary.advance(0, () => {})).toBe(true);
  const required = new CompactLayoutSearch(registry, network, [], statistics(), undefined, undefined, fixed, [wires[0]!.source]);
  expect(await required.advance(0, () => {})).toBe(false);
  expect(required.statistics.remainingConflicts!.connections).toBeGreaterThan(0);
  const proposal = required.captureProposal();
  required.proposeFromNode(0, 0.5);
  required.restoreProposal(proposal);
  expect(required.captureProposal()).toEqual(proposal);
});

it("完整链模块准备跨预算片继续，已完成提案计费准确，取消后仍可续算", async () => {
  const registry = createRegistryContract(), sessions = new PlannerSearchSessions();
  const request = structuredClone(requestFixture) as BlueprintPlannerRequest;
  const strategy = plannerUnitStrategy({ outputs: [0], packings: ["1"], converters: [0], conduits: ["local"], reductions: [] },
    "58/70/any/any", 0, request.options.randomSeed!);
  const run = (limit: number, check = () => {}, report = (_count: number) => {}) => createPlannerCandidate(registry, request, 0, check, () => {},
    { targetOutline: { width: 58, height: 70 }, attemptStrategy: { ...strategy, partitionDepth: 2 }, strategy: "compact",
      maxEvaluations: limit, sessionKey: "modules" }, report, undefined, undefined, sessions);
  await expect(run(137)).rejects.toBeInstanceOf(PlannerCandidateError);
  const original = sessions.snapshot("modules")!;
  const initialEntities = structuredClone(original.network.nodes.map(node => node.entity));
  expect(original.search).toBeInstanceOf(PartitionLayoutSearch);
  expect(original.search.statistics.evaluations).toBe(137);
  expect(original.search.statistics.partitionModuleCounts!.at(-1)).toBeGreaterThan(1);
  let reported = 0;
  await expect(run(200, () => { if (reported >= 37) throw new DOMException("cancelled", "AbortError"); }, count => { reported = count; }))
    .rejects.toBeInstanceOf(PlannerCandidateError);
  expect(reported).toBe(37);
  expect(sessions.snapshot("modules")!.search).toBe(original.search);
  await expect(run(63)).rejects.toBeInstanceOf(PlannerCandidateError);
  expect(original.search.statistics.evaluations).toBe(63);
  expect(original.search.statistics.searchResumed).toBe(true);
  await expect(run(6000)).rejects.toBeInstanceOf(PlannerCandidateError);
  const completed = structuredClone(original.network.nodes.map(node => node.entity));
  expect(completed).not.toEqual(initialEntities);
  await expect(run(1)).rejects.toBeInstanceOf(PlannerCandidateError);
  expect(original.network.nodes.map(node => node.entity)).toEqual(completed);
});

it("真实 Worker 在模块准备期间接收外部取消，准确结算后在同一线程继续", async () => {
  const client = new NodePlannerClient(), abort = new AbortController();
  const request = structuredClone(requestFixture) as BlueprintPlannerRequest;
  const strategy = plannerUnitStrategy({ outputs: [0], packings: ["1"], converters: [0], conduits: ["local"], reductions: [] },
    "58/70/any/any", 0, request.options.randomSeed!);
  const search = { targetOutline: { width: 58, height: 70 }, attemptStrategy: { ...strategy, partitionDepth: 2 }, sessionKey: "module-cancel" };
  let sentAt = 0, cancelledAt = 0, reported = 0;
  try {
    const failure = await client.build(request, 0, null, { ...search, maxEvaluations: 100_000 }, (_phase, _message, count) => {
      reported = count;
      if (count >= 2048 && !abort.signal.aborted) { sentAt = performance.now(); cancelledAt = count; abort.abort(); }
    }, abort.signal).catch(error => error);
    expect(failure).toBeInstanceOf(PlannerCandidateError);
    expect(failure.message).toBe("计算已暂停");
    expect(sentAt).toBeGreaterThan(0);
    expect(performance.now() - sentAt).toBeLessThan(5000);
    expect(failure.search.evaluations).toBe(reported);
    expect(reported).toBeGreaterThanOrEqual(cancelledAt);
    expect(reported).toBeLessThan(100_000);
    const threadId = client.threadId;
    expect(threadId).not.toBeNull();
    const resumed = await client.build(request, 0, null, { ...search, maxEvaluations: 137 }).catch(error => error);
    expect(resumed).toBeInstanceOf(PlannerCandidateError);
    expect(resumed.search.evaluations).toBe(137);
    expect(resumed.search.searchResumed).toBe(true);
    expect(client.threadId).toBe(threadId);
  } finally { await client.dispose(); }
}, 60_000);
