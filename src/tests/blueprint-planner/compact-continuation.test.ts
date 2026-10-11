// @vitest-environment node

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import { createRegistryContract } from "@/registry";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { rerouteReferenceLayout } from "@/scripts/eda/reference-analysis";
import { PlannerRouter } from "@/blueprint-planner/router";
import type { PlannerPort } from "@/blueprint-planner/geometry";
import { restorePlannerSeed } from "@/blueprint-planner/search-seed";
import { plannerAttemptStrategy } from "@/blueprint-planner/strategy-schedule";
import { PlannerBatchSession, runPlannerBatch } from "@/scripts/eda/planner-runner";
import yazhen from "./fixtures/yazhen-syringe.json";

it.each([
  ["v1.5-copper-block-bud-needle-line", 22],
  ["v1.5-copper-block-separation-core-line", 12],
  ["v1.5-six-xiranite-full-speed-gas-solid-conversion", 53],
] as const)("固定人工设备后重新布线：%s", async (name, count) => {
  const registry = createRegistryContract();
  const blueprint = normalizeBlueprintDocument(JSON.parse(readFileSync(`public/blueprints/${name}.json`, "utf8")))!;
  const before = JSON.stringify(blueprint);
  const result = await rerouteReferenceLayout(registry, blueprint, () => {});
  expect(result.status).toBe("routed");
  expect(result.connected).toBe(count);
  expect(result.attempts).toBe(1);
  expect(JSON.stringify(blueprint)).toBe(before);
});

it("复用路径必须重新检查端口、障碍和缓冲；失败不能污染占用", async () => {
  const registry = createRegistryContract();
  const source: PlannerPort = { entityId: "source", groupIndex: 0, portIndex: 0, direction: "output", kind: "belt",
    cell: { x: 0, y: 1 }, outside: { x: 1, y: 1 }, edge: "EAST" };
  const target: PlannerPort = { ...source, entityId: "target", direction: "input", cell: { x: 5, y: 1 }, outside: { x: 4, y: 1 }, edge: "WEST" };
  const boundary = { minimumX: 0, minimumY: 0, maximumX: 6, maximumY: 4, escapeLength: 0 };
  const initial = new PlannerRouter(registry, [], [source, target], boundary);
  await initial.connect(source, target, () => {});
  const path = initial.routes[0]!.cells;
  const reused = new PlannerRouter(registry, [], [source, target], boundary);
  expect(reused.reuse(source, target, path, path.length + 1)).toBe(false);
  expect(reused.reuse(source, { ...target, outside: { x: 4, y: 2 } }, path)).toBe(false);
  expect(reused.entities).toHaveLength(0);
  expect(reused.reuse(source, target, path)).toBe(true);
  expect(reused.routes[0]!.cells).toEqual(path);
  const blocked = new PlannerRouter(registry, [{ id: "blocker", definitionId: "cmpt_mc_1", position: { x: 2, y: 0 }, rotation: 0, config: {}, tags: [] }], [source, target], boundary);
  expect(blocked.reuse(source, target, path)).toBe(false);
  expect(blocked.entities).toHaveLength(0);
});

it("芽针固定生产方案从可行解缩边续搜，保持输入与种子不变并真实达到 6/min", async () => {
  const session = new PlannerBatchSession();
  const request = structuredClone(yazhen.request) as BlueprintPlannerRequest;
  const before = JSON.stringify(request);
  try {
    const first = await runPlannerBatch(request, { engineKind: "dense-v2", attempts: 1, localEvaluations: 12_500 }, session);
    const record = first.records[0]!;
    expect(record.outcome).toBe("success");
    expect(record.area).toBeLessThanOrEqual(528);
    expect(first.proposalCurve.exact).toBe(true);
    expect(first.proposalCurve.improvements).toHaveLength(1);
    expect(first.proposalCurve.improvements[0]).toMatchObject({ cumulativeEvaluations: first.localEvaluations, bestArea: record.area });
    expect(first.proposalCurve.bestOccupiedCells).toBe(record.search!.quality!.occupiedCells);
    expect(first.proposalCurve.bestCoverage).toBe(record.search!.quality!.occupiedCells / record.area!);
    const seed = JSON.parse(readFileSync(`${record.artifactPath}/search-seed.json`, "utf8"));
    const originalSeed = JSON.stringify(seed);
    expect(() => restorePlannerSeed(session.workspace.registry, { ...request, options: { ...request.options, plantStartup: "warehouse" } }, seed)).toThrow("不一致");
    // AI-CORRECTION 2026-10-11：本例验证固定的缩宽续搜，显式指定该分支，随机策略覆盖另有回归。
    const resumed = await runPlannerBatch(request, { engineKind: "dense-v2", attempts: 1, startVariant: 1, localEvaluations: 12_500, seed,
      attemptStrategy: { ...plannerAttemptStrategy(1), restart: false, outlineSeed: 1, layoutSeed: 1 } }, session);
    const result = resumed.records[0]!;
    expect(result.outcome).toBe("success");
    expect(result.area).toBeLessThan(record.area!);
    expect(result.measuredOutputs![0]!.perMinute).toBeGreaterThanOrEqual(6);
    expect(result.search!.resumedFromArea).toBe(record.area);
    expect(result.search!.reusedRoutes).toBeGreaterThan(0);
    expect(result.search!.evaluations).toBeLessThanOrEqual(12_500);
    expect(result.constraints).toEqual({ placementErrors: [], excessiveOperatingInputs: [] });
    expect(JSON.stringify(seed)).toBe(originalSeed);
    expect(JSON.stringify(request)).toBe(before);
  } finally { await session.dispose(); }
}, 90_000);
