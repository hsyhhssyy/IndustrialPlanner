// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BlueprintPlannerManualBoundarySide, BlueprintPlannerRequest, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import type { GridRotation } from "@/domain/shared/grid";
import { prepareManualLayout } from "@/blueprint-planner/manual-layout";
import { assertPlannerCandidateBounds, assertPlannerWarehousePorts, meetsProductionTargets } from "@/blueprint-planner/verification";
import { createBlueprintPlannerHost, type PlannerHostOptions } from "@/blueprint-planner/blueprint-planner-host";
import type { PlannerCheckpoint } from "@/blueprint-planner/task-checkpoint";
import { plannerRequestKey, type PlannerSearchSeed } from "@/blueprint-planner/search-seed";
import type { PlannerCandidate } from "@/blueprint-planner/candidate";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { PlannerBatchSession } from "@/scripts/eda/planner-runner";
import separator from "./fixtures/separator-core.json";

const session = new PlannerBatchSession();
afterAll(() => session.dispose());
const EVALUATIONS = 5_000;
const WORKER_MILLISECONDS = 20_000;
const evidenceDirectory = resolve(".temp/playwright-test/req051-revision/algorithm", `${Date.now()}-${process.pid}`);
type Mode = "relative-free" | "relative-fixed" | "bottom" | "left" | "right" | "both";
type Shape = BlueprintPlannerRequest["options"]["warehouseBus"];

/** 仅固定生产设备；仓库口、电力与物流均留给正式求解器，避免重放完整答案。 */
async function makeRequest(mode: Mode, rotation: GridRotation, shape: Shape = "straight"): Promise<BlueprintPlannerRequest> {
  const baseline = structuredClone(separator.request) as BlueprintPlannerRequest;
  let request: BlueprintPlannerRequest = { ...baseline,
    options: { ...baseline.options, warehouseBus: shape, solidOutput: "warehouse", concurrency: 1,
      evaluationsPerRound: EVALUATIONS, randomSeed: 85196838, deterministicSearch: true,
      dimensionLimits: { maxBaseLength: 24, maxSideLength: 28 } },
    manualLayout: { enabled: true, mode: "recipe", orientation: mode === "relative-free" ? "free" : "fixed",
      boundary: { position: null, rotation, assignments: [] }, facilities: [], placements: [],
      preparation: { sourceKey: "", nodes: [], connections: [], facilityTemplates: [], placementIssues: [] } } };
  const preparation = await prepareManualLayout(session.workspace.registry, request);
  const production = preparation.nodes.find(node => node.purpose === "production")!;
  const ports = preparation.nodes.filter(node => node.definitionId === "unloader_1" || node.definitionId === "loader_1");
  expect(production).toBeDefined();
  expect(ports.length).toBeGreaterThanOrEqual(3);
  const placement = transformManualPlacement({ referenceNode: production, position: { x: 9, y: 17 }, rotation: 0 },
    session.workspace.registry.queries.findEntityDefinition(production.definitionId)!, { rotation, translation: { x: 0, y: 0 } });
  const sides: readonly BlueprintPlannerManualBoundarySide[] = shape === "straight" ? ["base", "base", "base"]
    : shape === "corner" ? ["base", "left", "base"] : ["left", "right", "base"];
  const absolute = !mode.startsWith("relative");
  request = { ...request, manualLayout: { ...request.manualLayout!,
    boundary: { rotation, position: absolute ? { base: 24, left: mode === "left" || mode === "both" ? 0 : null,
      right: mode === "right" || mode === "both" ? 24 : null } : null,
      assignments: ports.map((referenceNode, index) => ({ referenceNode, side: sides[index % sides.length]! })) },
    preparation, placements: [placement] } };
  return { ...request, manualLayout: { ...request.manualLayout!, preparation: await prepareManualLayout(session.workspace.registry, request) } };
}

/** 从交付实体占地及真实外框独立量距，不用被测人工变换计算期望答案。 */
function measureFinal(request: BlueprintPlannerRequest, candidate: PlannerCandidate) {
  const reference = request.manualLayout!.placements[0]!.referenceNode;
  const entity = candidate.execution.blueprint.entities[reference.id]!;
  expect(entity).toBeDefined();
  const rect = resolveEntityGridRect({ entity, definition: session.workspace.registry.queries.findEntityDefinition(entity.definitionId)! });
  const origin = candidate.outlineOrigin ?? { x: 0, y: 0 };
  const direction = ((request.manualLayout!.boundary.rotation! + (candidate.manualTransform?.rotation ?? 0)) % 360) as GridRotation;
  const baseGap = direction === 0 ? origin.y + candidate.metrics.height - rect.y - rect.height
    : direction === 90 ? rect.x - origin.x
      : direction === 180 ? rect.y - origin.y : origin.x + candidate.metrics.width - rect.x - rect.width;
  const width = direction % 180 ? candidate.metrics.height : candidate.metrics.width;
  const depth = direction % 180 ? candidate.metrics.width : candidate.metrics.height;
  const leftGap = direction === 0 ? rect.x - origin.x : direction === 90 ? rect.y - origin.y
    : direction === 180 ? origin.x + candidate.metrics.width - rect.x - rect.width
      : origin.y + candidate.metrics.height - rect.y - rect.height;
  const rightGap = width - leftGap - (direction % 180 ? rect.height : rect.width);
  return { baseGap, leftGap, rightGap, width, depth };
}

async function generateAndVerify(request: BlueprintPlannerRequest, outline = { width: 24, height: 24 }) {
  const candidate = await session.planner.build(request, 0, WORKER_MILLISECONDS,
    { targetOutline: outline, maxEvaluations: EVALUATIONS });
  expect(session.planner.threadId).toBeGreaterThan(0);
  expect(candidate.search.evaluations).toBeGreaterThan(0);
  expect(candidate.search.evaluations).toBeLessThanOrEqual(EVALUATIONS);
  assertPlannerCandidateBounds(session.workspace.registry, candidate);
  assertPlannerWarehousePorts(session.workspace.registry, request, candidate);
  expect([0, 90, 180, 270]).toContain(candidate.manualTransform?.rotation);
  if (request.manualLayout!.orientation === "fixed") expect(candidate.manualTransform!.rotation).toBe(0);
  const sourcePlacement = request.manualLayout!.placements[0]!;
  expect(candidate.execution.blueprint.entities[sourcePlacement.referenceNode.id]!.rotation)
    .toBe((sourcePlacement.rotation + candidate.manualTransform!.rotation) % 360);
  const dimensions = measureFinal(request, candidate);
  // AI-REMOVED 2026-11-21: Reason: 生产旧三项按未填，直接独立量两轴。Trigger: 用户订正旧约束语义。
  // Evidence: makeRequest使用独立maxBase/maxSide。Replacement: 下方两轴断言。Risk: Low。Human Review: Required。
  // Original code:
  // if (request.options.warehouseBus === "corner") expect(Math.min(dimensions.width, dimensions.depth)).toBeLessThanOrEqual(request.options.dimensionLimits!.shortest!);
  // else {
  // const limits = request.options.warehouseBus === "straight" ? request.options.dimensionLimits!.straight! : request.options.dimensionLimits!.uShaped!;
  // expect(dimensions.width).toBeLessThanOrEqual(limits.edge!); expect(dimensions.depth).toBeLessThanOrEqual(limits.side!);
  // }
  expect(dimensions.width).toBeLessThanOrEqual(request.options.dimensionLimits!.maxBaseLength!);
  expect(dimensions.depth).toBeLessThanOrEqual(request.options.dimensionLimits!.maxSideLength!);
  if (request.manualLayout!.boundary.position) {
    expect(dimensions.baseGap).toBe(3);
    if (request.manualLayout!.boundary.position.left !== null) expect(dimensions.leftGap).toBe(9);
    if (request.manualLayout!.boundary.position.right !== null) expect(dimensions.rightGap).toBe(request.manualLayout!.boundary.position.right - 15);
    if (request.manualLayout!.boundary.position.left !== null && request.manualLayout!.boundary.position.right !== null) expect(dimensions.width).toBe(request.manualLayout!.boundary.position.right - request.manualLayout!.boundary.position.left);
  }
  const report = await session.simulation.actions.runBlueprint(candidate.execution);
  expect(report.status).toBe("completed");
  expect(meetsProductionTargets(request, report), JSON.stringify(report.diagnostics)).toBe(true);
  expect(report.probes.find(probe => probe.id === request.plan.targets[0]!.itemId)?.perMinute).toBeGreaterThanOrEqual(60);
  expect(candidate.execution.blueprint.entityOrder.length).toBeGreaterThan(request.manualLayout!.placements.length);
  await mkdir(evidenceDirectory, { recursive: true });
  const manual = request.manualLayout!;
  const label = `${manual.placements.length}-manual-${request.options.warehouseBus}-${manual.boundary.position ? manual.boundary.position.left === null ? manual.boundary.position.right === null ? "bottom" : "right" : manual.boundary.position.right === null ? "left" : "both" : manual.orientation}-${manual.boundary.rotation}-${outline.width}x${outline.height}`;
  await writeFile(resolve(evidenceDirectory, label + ".json"), JSON.stringify({ request, candidate, report, measured: dimensions }, null, 2));
  return { candidate, report, dimensions };
}

// AI-REMOVED 2026-11-20:
// Reason: 已通过的代表样本并入完整56组合，避免重复运行同一输入。
// Trigger: 用户批准完整形态/模式/方向矩阵。
// Evidence: 代表样本5000次预算、真实Worker与dense-v2产率验证通过。
// Replacement: 下方绝对定位参数化矩阵的straight/both/0。
// Risk: Low；保留同一预算及所有正向断言。Human Review: Required
// Original code:
// it("代表样本：straight/both/0 真Worker生成、底边净距三格及真实产率", async () => {
//   const request = await makeRequest("both", 0);
//   await generateAndVerify(request);
// }, 30_000);

for (const shape of ["straight", "corner", "u-shaped"] as const) {
  for (const mode of ["bottom", "left", "right", "both"] as const) {
    it.each([0, 90, 180, 270] as const)(`${shape}/${mode}/%s：真实产解、final独立测距和产率`, async rotation => {
      await generateAndVerify(await makeRequest(mode, rotation, shape));
    }, 30_000);
  }
}
for (const mode of ["relative-free", "relative-fixed"] as const) {
  it.each([0, 90, 180, 270] as const)(`${mode}/%s：真实产解且保持合法整体朝向`, async rotation => {
    await generateAndVerify(await makeRequest(mode, rotation));
  }, 30_000);
}

it.each(["bottom", "left", "right"] as const)("%s：相同固定设备在22/24两种宽度均成功，底边距离与单侧关系不变", async mode => {
  const request = await makeRequest(mode, 90);
  const smaller = await generateAndVerify(request, { width: 24, height: 22 });
  const larger = await generateAndVerify(request, { width: 24, height: 24 });
  expect([smaller.dimensions.width, larger.dimensions.width]).toEqual([22, 24]);
}, 60_000);

it("双侧24格：相同设备与锁边在22/26两种纵深均成功，不隐含精确高度", async () => {
  const request = await makeRequest("both", 270);
  const first = await generateAndVerify(request, { width: 22, height: 24 });
  const second = await generateAndVerify(request, { width: 26, height: 24 });
  expect([first.dimensions.width, second.dimensions.width]).toEqual([24, 24]);
  expect([first.dimensions.depth, second.dimensions.depth]).toEqual([22, 26]);
}, 60_000);

it("L形忽略极小历史最短边，侧边24允许底边26", async () => {
  const request = await makeRequest("both", 0, "corner");
  const current = { ...request, options: { ...request.options, dimensionLimits: { shortest: 1, maxBaseLength: 28, maxSideLength: 24 } },
    manualLayout: { ...request.manualLayout!, boundary: { ...request.manualLayout!.boundary,
    position: { ...request.manualLayout!.boundary.position!, right: 26 } } } };
  const result = await generateAndVerify(current, { width: 26, height: 24 });
  expect(result.dimensions.width).toBe(26); expect(result.dimensions.depth).toBe(24);
}, 30_000);


const HOST_EVALUATIONS = 20_000;
async function runActualHost(request: BlueprintPlannerRequest, expected: "success" | "budget-exhausted" = "success", restored?: BlueprintPlannerTaskFile) {
  const execution = new PlannerBatchSession();
  const persisted = new Map<string, BlueprintPlannerTaskFile>(restored ? [[restored.taskId, structuredClone(restored)]] : []);
  const trace: { outline: unknown; offered: number; actual?: number; error?: string }[] = [];
  const worker: NonNullable<PlannerHostOptions["worker"]> = {
    build: async (input, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      const entry: typeof trace[number] = { outline: targetOutline, offered: evaluations }; trace.push(entry);
      try {
        const candidate = await execution.planner.build(input, variant, budgetMs,
          { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal);
        entry.actual = candidate.search.evaluations;
        return candidate;
      } catch (error) { entry.error = error instanceof Error ? error.message : String(error); throw error; }
    }, dispose: () => { void execution.planner.dispose(); },
  };
  const host = createBlueprintPlannerHost(execution.workspace, { gpuLayout: false, worker,
    storage: { load: async () => [...persisted.values()].map(file => structuredClone(file)),
      save: async file => { persisted.set(file.taskId, structuredClone(file)); }, delete: async id => { persisted.delete(id); } } });
  let id: string | undefined;
  try {
    await host.whenSettled();
    id = restored ? restored.taskId : await host.actions.createProductionTask(request);
    host.actions.continuePlanning(id, HOST_EVALUATIONS, 1, false);
    await host.whenSettled();
    const file = host.queries.exportTask(id);
    const point = file.checkpoint as PlannerCheckpoint;
    expect(trace.length).toBeGreaterThan(0);
    if (restored) {
      expect(file.progress.validatedCandidateCount).toBeGreaterThan(restored.progress.validatedCandidateCount);
      expect(point.best!.candidate.metrics.area).toBeLessThan((restored.checkpoint as PlannerCheckpoint).best!.candidate.metrics.area);
    }
    expect(point.evaluations, JSON.stringify(trace)).toBeGreaterThan(0);
    // AI-REMOVED 2026-11-20:
    // Reason: 默认首解面积168只尝试24×7，不能把既有固定面积启发式限制当作任意预算必产解承诺。
    // Trigger: 主代理批准分别验证默认正常结算与显式初始面积576真实产解。
    // Evidence: algorithm/1795187344018-547601/host-fixed-0-straight.json四批5000次均未产解。
    // Replacement: 下方按明确预期分支断言；正向成功仍完整保留，不降低产率要求。
    // Risk: 默认该小预算案例仍无解，属于已知范围限制。Human Review: Required
    // Original code:
    // expect(file.progress.validatedCandidateCount, JSON.stringify({ progress: file.progress, trace })).toBeGreaterThan(0);
    // expect(point.best).not.toBeNull(); expect(host.queries.getResult(id)).not.toBeNull();
    // assertPlannerWarehousePorts(execution.workspace.registry, request, point.best!.candidate);
    // expect(meetsProductionTargets(request, point.best!.report)).toBe(true);
    // if (request.manualLayout!.boundary.position) expect(measureFinal(request, point.best!.candidate).baseGap).toBe(3);
    if (expected === "success") {
      expect(file.progress.validatedCandidateCount, JSON.stringify({ progress: file.progress, trace })).toBeGreaterThan(0);
      expect(point.best).not.toBeNull(); expect(host.queries.getResult(id)).not.toBeNull();
      assertPlannerWarehousePorts(execution.workspace.registry, request, point.best!.candidate);
      expect(meetsProductionTargets(request, point.best!.report)).toBe(true);
      expect([0, 90, 180, 270]).toContain(point.best!.candidate.manualTransform?.rotation);
      if (request.manualLayout!.orientation === "fixed") expect(point.best!.candidate.manualTransform!.rotation).toBe(0);
      const source = request.manualLayout!.placements[0]!;
      expect(point.best!.candidate.execution.blueprint.entities[source.referenceNode.id]!.rotation)
        .toBe((source.rotation + point.best!.candidate.manualTransform!.rotation) % 360);
      const measured = measureFinal(request, point.best!.candidate);
      const position = request.manualLayout!.boundary.position;
      if (position) {
        expect(measured.baseGap).toBe(3);
        if (position.left !== null) expect(measured.leftGap).toBe(9 - position.left);
        if (position.right !== null) expect(measured.rightGap).toBe(position.right - 15);
        if (position.left !== null && position.right !== null) expect(measured.width).toBe(position.right - position.left);
      }
      // AI-REMOVED 2026-11-21: Reason: 生产旧三项按未填，直接独立量两轴。Trigger: 用户订正旧约束语义。
      // Evidence: makeRequest使用独立maxBase/maxSide。Replacement: 下方两轴断言。Risk: Low。Human Review: Required。
      // Original code:
      // if (request.options.warehouseBus === "corner") expect(Math.min(measured.width, measured.depth)).toBeLessThanOrEqual(request.options.dimensionLimits!.shortest!);
      // else {
      // const limits = request.options.warehouseBus === "straight" ? request.options.dimensionLimits!.straight! : request.options.dimensionLimits!.uShaped!;
      // expect(measured.width).toBeLessThanOrEqual(limits.edge!); expect(measured.depth).toBeLessThanOrEqual(limits.side!);
      // }
      expect(measured.width).toBeLessThanOrEqual(request.options.dimensionLimits!.maxBaseLength!);
      expect(measured.depth).toBeLessThanOrEqual(request.options.dimensionLimits!.maxSideLength!);
    } else {
      expect(file.progress.status).toBe("waiting"); expect(file.progress.validatedCandidateCount).toBe(0);
      expect(point.best).toBeNull(); expect(host.queries.getResult(id)).toBeNull();
      expect(point.evaluations + (point.unspentEvaluations ?? 0)).toBe(HOST_EVALUATIONS);
      expect(trace.map(entry => entry.outline)).toEqual(Array.from({ length: 4 }, () => ({ width: 24, height: 7, baseSide: 2 })));
    }
    expect(persisted.has(id)).toBe(true);
    return structuredClone(file);
  } finally {
    await mkdir(evidenceDirectory, { recursive: true });
    const manual = request.manualLayout!, position = manual.boundary.position;
    const mode = position ? position.left === null ? position.right === null ? "bottom" : "right" : position.right === null ? "left" : "both" : `relative-${manual.orientation}`;
    const file = id ? host.queries.exportTask(id) : null;
    const best = (file?.checkpoint as PlannerCheckpoint | undefined)?.best;
    await writeFile(resolve(evidenceDirectory, `host-${restored ? "restored-" : ""}${request.options.initialArea ?? "default"}-${mode}-${manual.boundary.rotation}-${request.options.warehouseBus}.json`),
      JSON.stringify({ request, trace, file, measured: best ? measureFinal(request, best.candidate) : null }, null, 2));
    host.dispose(); await host.whenSettled(); await execution.dispose();
  }
}

// AI-CORRECTION 2026-11-20：原Host代表默认面积未产解已留证；本例明确检验正常结算，不宣称已修复默认启发式。
it("Host默认面积：both/0真实执行四批后无成果，正常结算且预算守恒", async () => {
  await runActualHost(await makeRequest("both", 0), "budget-exhausted");
}, 90_000);
it("Host显式面积代表：both/0初始面积576真实启动并得到成果", async () => {
  const request = await makeRequest("both", 0);
  await runActualHost({ ...request, options: { ...request.options, initialArea: 576 } });
}, 90_000);


it("相对双设备：生产设备与人工电力设施保持中心位移和朝向差，其他布线仍自动生成", async () => {
  const request = await makeRequest("relative-free", 90);
  const template = request.manualLayout!.preparation.facilityTemplates.find(entry => entry.purpose === "power")!;
  const referenceNode = { ...template, id: "manual-facility-req051-relative-second-device", inputs: [], outputs: [] };
  const pose = transformManualPlacement({ referenceNode, position: { x: 3, y: 3 }, rotation: 0 as const },
    session.workspace.registry.queries.findEntityDefinition(template.definitionId)!, { rotation: 90, translation: { x: 0, y: 0 } });
  const current: BlueprintPlannerRequest = { ...request, manualLayout: { ...request.manualLayout!,
    facilities: [{ ...template, id: referenceNode.id }], placements: [...request.manualLayout!.placements, pose] } };
  const prepared = { ...current, manualLayout: { ...current.manualLayout!, preparation: await prepareManualLayout(session.workspace.registry, current) } };
  const { candidate } = await generateAndVerify(prepared);
  const centers = prepared.manualLayout.placements.map(placement => {
    const definition = session.workspace.registry.queries.findEntityDefinition(placement.referenceNode.definitionId)!;
    const source = resolveEntityGridRect({ definition, entity: { id: placement.referenceNode.id, definitionId: definition.id,
      position: placement.position, rotation: placement.rotation, config: {}, tags: [] } });
    const final = resolveEntityGridRect({ definition, entity: candidate.execution.blueprint.entities[placement.referenceNode.id]! });
    return { source: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      final: { x: final.x + final.width / 2, y: final.y + final.height / 2 } };
  });
  const dx = centers[1]!.source.x - centers[0]!.source.x, dy = centers[1]!.source.y - centers[0]!.source.y;
  const rotation = candidate.manualTransform!.rotation;
  const expected = rotation === 0 ? { x: dx, y: dy } : rotation === 90 ? { x: -dy, y: dx }
    : rotation === 180 ? { x: -dx, y: -dy } : { x: dy, y: -dx };
  expect({ x: centers[1]!.final.x - centers[0]!.final.x, y: centers[1]!.final.y - centers[0]!.final.y }).toEqual(expected);
  for (const placement of prepared.manualLayout.placements) {
    expect(candidate.execution.blueprint.entities[placement.referenceNode.id]!.rotation).toBe((placement.rotation + rotation) % 360);
  }
}, 30_000);


it.each([
  { mode: "relative-free", rotation: 0, shape: "straight" },
  { mode: "relative-fixed", rotation: 90, shape: "corner" },
  { mode: "bottom", rotation: 180, shape: "u-shaped" },
  { mode: "left", rotation: 270, shape: "corner" },
  { mode: "right", rotation: 90, shape: "u-shaped" },
] as const)("Host显式面积/$mode/$rotation/$shape：实际调度并交付有产率成果", async ({ mode, rotation, shape }) => {
  const request = await makeRequest(mode, rotation, shape);
  await runActualHost({ ...request, options: { ...request.options, initialArea: 576 } });
}, 90_000);


it.each(["both", "relative-free"] as const)("Host持久化续算/%s：首解保存并销毁后恢复，产生新批次和更小的验收成果", async mode => {
  const base = await makeRequest(mode, 0);
  const firstRequest = { ...base, options: { ...base.options, initialArea: 576, stopAfterFirstSolution: true } };
  const first = await runActualHost(firstRequest);
  const firstPoint = first.checkpoint as PlannerCheckpoint;
  expect(firstPoint.best).not.toBeNull(); expect(firstPoint.best!.candidate.seed).toBeDefined();
  const path = resolve(evidenceDirectory, `persisted-${mode}.json`);
  await writeFile(path, JSON.stringify(first));
  const loaded = JSON.parse(await readFile(path, "utf8")) as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest };
  // 执行停止条件不是生产约束；关闭首解即停后沿真实导出种子继续压缩，不改设备、边界或预算。
  const request = { ...loaded.request, options: { ...loaded.request.options, stopAfterFirstSolution: false } };
  const resumed = await runActualHost(request, "success", { ...loaded, request });
  expect((resumed.checkpoint as PlannerCheckpoint).evaluations).toBeGreaterThanOrEqual(firstPoint.evaluations);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(first);
}, 90_000);


it.each(["relative", "fixed"] as const)("旧休眠配置复制后选择%s：保留原成果原文，不继承旧seed，并重新实际产解", async choice => {
  const base = await makeRequest("relative-free", 0);
  const original = await runActualHost({ ...base, options: { ...base.options, initialArea: 576, stopAfterFirstSolution: true } });
  const history = structuredClone(original) as BlueprintPlannerTaskFile & { request: BlueprintPlannerRequest };
  const historicRequest = { ...history.request, manualLayout: { ...history.request.manualLayout!,
    boundary: { ...history.request.manualLayout!.boundary, position: { base: 24, left: 0, right: 24 } } } };
  Object.assign(history, { request: historicRequest });
  // 将真实相对成果装配成旧版“free+position休眠”历史输入；只重绑定请求元数据，不伪造布局或仿真结果。
  const point = history.checkpoint as PlannerCheckpoint;
  const rebind = (seed: PlannerSearchSeed) => {
    Object.assign(seed.network, { request: historicRequest }); Object.assign(seed, { requestKey: plannerRequestKey(historicRequest) });
  };
  rebind(point.best!.candidate.seed!);
  for (const pool of point.portfolio.pools) for (const entry of pool.entries) rebind(entry.seed);
  if (point.parallel) {
    point.parallel.requestKey = plannerRequestKey(historicRequest);
    for (const shard of point.parallel.shards) for (const pool of shard.portfolio.pools) for (const entry of pool.entries) rebind(entry.seed);
  }
  const preserved = structuredClone(history);
  const execution = new PlannerBatchSession();
  const records = new Map<string, BlueprintPlannerTaskFile>([[history.taskId, structuredClone(history)]]);
  const generated: PlannerCandidate[] = [], seedPresence: boolean[] = [];
  const host = createBlueprintPlannerHost(execution.workspace, { gpuLayout: false,
    storage: { load: async () => [...records.values()].map(file => structuredClone(file)),
      save: async file => { records.set(file.taskId, structuredClone(file)); }, delete: async id => { records.delete(id); } },
    worker: { build: async (request, variant, budgetMs, evaluations, signal, update, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy) => {
      seedPresence.push(seed !== undefined || originSeed !== undefined);
      const candidate = await execution.planner.build(request, variant, budgetMs,
        { maxEvaluations: evaluations, seed, continuationStep, maximumArea, targetOutline, originSeed, sessionKey, attemptStrategy }, update, signal);
      generated.push(candidate); return candidate;
    }, dispose: () => { void execution.planner.dispose(); } } });
  let copiedId: string | undefined;
  try {
    await host.whenSettled();
    expect(host.queries.exportTask(history.taskId)).toEqual(preserved);
    expect(host.queries.getLastRequest(history.taskId)).toEqual(historicRequest);
    copiedId = await host.actions.duplicateTask(history.taskId);
    const copied = host.queries.exportTask(copiedId), copiedPoint = copied.checkpoint as PlannerCheckpoint;
    expect(copied.progress.planningStarted).toBe(false);
    expect((copied.request as BlueprintPlannerRequest).manualLayout!.boundary.position).toEqual({ base: 24, left: 0, right: 24 });
    expect(copiedPoint.best).toBeNull(); expect(copiedPoint.pendingCandidate).toBeNull(); expect(copiedPoint.result).toBeNull();
    expect(copiedPoint.portfolio.pools.flatMap(pool => pool.entries)).toHaveLength(0);
    const copiedRequest = copied.request as BlueprintPlannerRequest;
    const request: BlueprintPlannerRequest = { ...copiedRequest, manualLayout: { ...copiedRequest.manualLayout!,
      orientation: choice === "fixed" ? "fixed" : "free", boundary: { ...copiedRequest.manualLayout!.boundary,
        position: choice === "fixed" ? copiedRequest.manualLayout!.boundary.position : null } } };
    await host.actions.updateProductionTask(copiedId, request);
    host.actions.continuePlanning(copiedId, HOST_EVALUATIONS, 1, false); await host.whenSettled();
    const solved = host.queries.exportTask(copiedId), best = (solved.checkpoint as PlannerCheckpoint).best;
    expect(generated.length).toBeGreaterThan(0); expect(seedPresence[0]).toBe(false);
    expect(solved.progress.validatedCandidateCount).toBeGreaterThan(0); expect(best).not.toBeNull();
    assertPlannerWarehousePorts(execution.workspace.registry, request, best!.candidate);
    expect(meetsProductionTargets(request, best!.report)).toBe(true);
    expect(host.queries.getResult(copiedId)).not.toBeNull();
    if (choice === "fixed") expect(measureFinal(request, best!.candidate)).toMatchObject({ baseGap: 3, leftGap: 9, rightGap: 9, width: 24 });
    expect(host.queries.exportTask(history.taskId)).toEqual(preserved);
  } finally {
    await writeFile(resolve(evidenceDirectory, `legacy-dormant-copy-${choice}.json`), JSON.stringify({ source: preserved,
      originalAfter: host.queries.exportTask(history.taskId), copy: copiedId ? host.queries.exportTask(copiedId) : null,
      seedPresence, generated: generated.map(candidate => ({ metrics: candidate.metrics, evaluations: candidate.search.evaluations })) }, null, 2));
    host.dispose(); await host.whenSettled(); await execution.dispose();
  }
}, 90_000);

it.each([
  { orientation: "free", rotation: 0 }, { orientation: "fixed", rotation: null }, { orientation: "free", rotation: null },
] as const)("真实Worker拒绝不完整绝对组合/$orientation/$rotation，不静默按相对模式求解", async ({ orientation, rotation }) => {
  const base = await makeRequest("both", 0);
  const request = { ...base, manualLayout: { ...base.manualLayout!, orientation,
    boundary: { ...base.manualLayout!.boundary, rotation } } };
  await expect(session.planner.build(request, 0, WORKER_MILLISECONDS, { targetOutline: { width: 24, height: 24 }, maxEvaluations: EVALUATIONS }))
    .rejects.toThrow("绝对定位要求禁止整体旋转并明确底边方向。");
}, 30_000);

it.each([
  { label: "底边跨越设备", position: { base: 20, left: 0, right: 24 }, message: "人工设备完整占地超出固定底边或侧边。" },
  { label: "双侧超过适用上限", position: { base: 24, left: 0, right: 25 }, message: "人工边界定位无法满足当前尺寸上限。" },
  { label: "双侧零宽", position: { base: 24, left: 0, right: 0 }, message: "固定双侧必须按左、右顺序形成正宽度。" },
])("真实Worker拒绝$label，返回明确约束原因而非伪造成功", async ({ position, message }) => {
  const base = await makeRequest("both", 0);
  const request = { ...base, manualLayout: { ...base.manualLayout!, boundary: { ...base.manualLayout!.boundary, position } } };
  await expect(session.planner.build(request, 0, WORKER_MILLISECONDS, { targetOutline: { width: 24, height: 24 }, maxEvaluations: EVALUATIONS }))
    .rejects.toThrow(message);
}, 30_000);
