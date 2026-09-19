import type { PlannerSearchExperiment, PlannerSearchStatistics } from "@/blueprint-planner/search-types";
import type { PlannerSearchProfile } from "@/blueprint-planner/search-profile";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cpus, availableParallelism } from "node:os";
import type { BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { SimulationEngineKind } from "@/domain/simulation";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";
import { createWorkspaceState } from "@/domain/document/workspace-state";
import { createRegistryContract } from "@/registry";
import { createSimulationHost } from "@/simulation/simulation-host";
import { validatePlannerRequest } from "@/blueprint-planner/production-network";
import { meetsProductionTargets } from "@/blueprint-planner/verification";
import { PlannerCandidateError, PlanningBudgetExhausted } from "@/blueprint-planner/model";
import { NodePlannerClient } from "./node-planner-client";
import { createLayoutPreview, saveSuccessfulPlanning } from "./artifacts";
import { createWorldDocument } from "@/domain/document/world-document";
import { createEditorStateReadWrite } from "@/editor/state-impl";
import { resolvePlacementValidations } from "@/editor/placement-validation";
import { edaOutputPath } from "./artifact-paths";

/** 常驻执行器只复用 Registry、Host 和 Worker；每次规划仍拥有独立的输入、预算和仿真世界。 */
export class PlannerBatchSession {
  readonly workspace: WorkspaceContract = { state: createWorkspaceState(), registry: createRegistryContract(), app: null,
    editor: null, render: null, simulation: null, sync: null, blueprintPlanner: null };
  readonly simulation = createSimulationHost(this.workspace, { engineKind: "dense-v2", workerMode: "runtime", blueprintDenseTickRate: 2 });
  readonly planner = new NodePlannerClient();
  busy = false;

  async dispose(): Promise<void> {
    try { await this.planner.dispose(); }
    finally { this.simulation.dispose(); }
  }
}

export interface PlannerBatchOptions {
  readonly attempts?: number;
  readonly localEvaluations?: number;
  readonly width?: number;
  readonly height?: number;
  readonly seconds?: number;
  readonly startVariant?: number;
  readonly candidateSeconds?: number;
  readonly verificationSeconds?: number;
  readonly engineKind: Extract<SimulationEngineKind, "dense-v2">;
  readonly profile?: Partial<PlannerSearchProfile>;
  readonly diagnostics?: boolean;
  readonly experiments?: readonly PlannerSearchExperiment[];
}

export interface PlannerAttemptRecord {
  readonly variant: number;
  readonly outcome: "success" | "layout-failed" | "verification-failed" | "timeout";
  readonly generationMs: number;
  readonly verificationMs: number;
  readonly error?: string;
  readonly area?: number;
  readonly width?: number;
  readonly height?: number;
  readonly search?: PlannerSearchStatistics;
  readonly measuredOutputs?: readonly { id: string; perMinute: number }[];
  readonly artifactPath?: string;
  readonly diagnosticPath?: string;
  readonly constraints?: { readonly placementErrors: readonly string[]; readonly excessiveOperatingInputs: readonly string[] };
}

export async function runPlannerBatch(request: BlueprintPlannerRequest, options: PlannerBatchOptions, session?: PlannerBatchSession) {
  if (options.engineKind !== "dense-v2") throw new Error("EDA 测试固定使用 dense-v2 引擎。");
  if ((options.attempts === undefined) === (options.seconds === undefined)) throw new Error("必须且只能指定 attempts 或 seconds。");
  if (options.attempts !== undefined && (!Number.isInteger(options.attempts) || options.attempts <= 0)) throw new Error("attempts 必须是正整数。");
  if (options.seconds !== undefined && (!Number.isFinite(options.seconds) || options.seconds <= 0)) throw new Error("seconds 必须大于零。");
  if (options.startVariant !== undefined && (!Number.isInteger(options.startVariant) || options.startVariant < 0)) throw new Error("startVariant 必须是非负整数。");
  for (const limit of [options.candidateSeconds, options.verificationSeconds]) if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) throw new Error("每阶段时间必须大于零。");
  if (options.localEvaluations !== undefined && (!Number.isInteger(options.localEvaluations) || options.localEvaluations <= 0)) throw new Error("localEvaluations 必须是正整数。");
  if ((options.width === undefined) !== (options.height === undefined)) throw new Error("边界宽高必须同时指定。");
  for (const size of [options.width, options.height]) if (size !== undefined && (!Number.isInteger(size) || size <= 0)) throw new Error("边界宽高必须是正整数。");
  const execution = session ?? new PlannerBatchSession();
  if (execution.busy) throw new Error("规划执行器已有任务。");
  const { workspace, simulation, planner } = execution;
  try { validatePlannerRequest(workspace.registry, request); }
  catch (error) { if (session === undefined) await execution.dispose(); throw error; }
  execution.busy = true;
  const startedAt = performance.now(), deadline = startedAt + (options.seconds ?? Infinity) * 1000;
  const records: PlannerAttemptRecord[] = [];
  let firstSuccessMs: number | null = null;
  let localEvaluations = 0;
  try {
    for (let index = 0; index < (options.attempts ?? Infinity) && performance.now() < deadline; index++) {
      if (localEvaluations >= (options.localEvaluations ?? Infinity)) break;
      const variant = (options.startVariant ?? 0) + index;
      const generationStart = performance.now();
      let generationMs = 0, verificationMs = 0;
      const remainingEvaluations = Math.min(50_000, Math.ceil(((options.localEvaluations ?? Infinity) - localEvaluations)
        / (options.localEvaluations !== undefined && options.attempts !== undefined ? options.attempts - index : 1)));
      try {
        const candidate = await planner.build(request, variant,
          Math.min((options.candidateSeconds ?? 30) * 1000, deadline - performance.now()), {
            maxEvaluations: remainingEvaluations,
            profile: options.profile,
            diagnostics: options.diagnostics,
            experiments: options.experiments,
            ...(options.width === undefined ? {} : { outline: { width: options.width, height: options.height! } }),
          });
        localEvaluations += candidate.search.evaluations;
        generationMs = performance.now() - generationStart;
        if (performance.now() >= deadline) throw new PlanningBudgetExhausted();
        const verificationStart = performance.now();
        workspace.registry.baseDefinitions = [...workspace.registry.baseDefinitions.filter(base => base.id !== "eda-batch-land"),
          { id: "eda-batch-land", name: "空地", tag: "武陵", tags: ["武陵"], placeableArea: { width: 10000, height: 10000 },
            outerRing: { top: 0, right: 0, bottom: 0, left: 0 }, builtinEntities: [] }];
        const document = createWorldDocument({ baseId: "eda-batch-land" });
        Object.assign(document, { entities: candidate.execution.blueprint.entities, entityOrder: candidate.execution.blueprint.entityOrder,
          slotLinks: candidate.execution.blueprint.slotLinks });
        const placements = resolvePlacementValidations({ document, workspace, state: createEditorStateReadWrite() });
        const placementErrors = Object.entries(placements).filter(([, value]) => !value.canPlace).map(([id]) => id);
        const report = await simulation.actions.runBlueprint({ ...candidate.execution,
          maxWallTimeMs: Math.min((options.verificationSeconds ?? 180) * 1000, deadline - performance.now()),
        });
        verificationMs = performance.now() - verificationStart;
        const excessiveOperatingInputs = candidate.supplyAudit.operatingLimits.filter(limit => {
          const measured = report.probes.find(probe => probe.id === `operating:${limit.entityId}`);
          return measured === undefined || measured.perMinute > limit.perMinute + 1e-6;
        }).map(limit => limit.entityId);
        const constraints = { placementErrors, excessiveOperatingInputs };
        const success = meetsProductionTargets(request, report) && placementErrors.length === 0 && excessiveOperatingInputs.length === 0;
        if (success) firstSuccessMs ??= performance.now() - startedAt;
        const artifactPath = success ? await saveSuccessfulPlanning(workspace.registry, `${request.plan.name}-${variant}`,
          candidate.execution.blueprint, request, { variant, generationMs, verificationMs, engineKind: options.engineKind, ticksPerSecond: 2,
            metrics: candidate.metrics, search: candidate.search, supplyAudit: candidate.supplyAudit, constraints, report }) : undefined;
        const diagnosticPath = success ? undefined : edaOutputPath("runs/candidates", `${Date.now()}-${process.pid}-${variant}`);
        if (diagnosticPath !== undefined) {
          await mkdir(diagnosticPath, { recursive: true });
          await Promise.all([
            writeFile(resolve(diagnosticPath, "candidate.json"), JSON.stringify(candidate, null, 2)),
            writeFile(resolve(diagnosticPath, "validation.json"), JSON.stringify(report, null, 2)),
            writeFile(resolve(diagnosticPath, "preview.svg"), createLayoutPreview(workspace.registry, candidate.execution.blueprint)),
          ]);
        }
        records.push({ variant, generationMs, verificationMs,
          outcome: success ? "success" : report.status === "timeout" ? "timeout" : "verification-failed",
          area: candidate.metrics.area, width: candidate.metrics.width, height: candidate.metrics.height, search: candidate.search,
          measuredOutputs: report.probes.filter(probe => request.plan.targets.some(target => target.itemId === probe.id)), artifactPath, diagnosticPath, constraints,
          error: success ? undefined : report.diagnostics.find((entry) => entry.severity === "error")?.message
            ?? (placementErrors.length ? `设备放置不合法：${placementErrors.join(",")}` : excessiveOperatingInputs.length ? "运行消耗超过准入口限额"
              : report.status === "timeout" ? "仿真验证达到时间预算" : "实测产量不足或存在缺电设备"),
        });
      } catch (error) {
        if (!(error instanceof PlannerCandidateError) && !(error instanceof PlanningBudgetExhausted)) throw error;
        const search = error instanceof PlannerCandidateError ? error.search : undefined;
        localEvaluations += search?.evaluations ?? (generationMs === 0 ? remainingEvaluations : 0);
        records.push({ variant, search, generationMs: generationMs || performance.now() - generationStart, verificationMs,
          outcome: error instanceof PlanningBudgetExhausted ? "timeout" : "layout-failed", error: error.message });
      }
    }
  } finally { execution.busy = false; if (session === undefined) await execution.dispose(); }
  const elapsedMs = performance.now() - startedAt;
  return { input: request, options, elapsedMs, localEvaluations, firstSuccessMs, attempts: records.length,
    successes: records.filter((entry) => entry.outcome === "success").length,
    attemptsPerMinute: records.length * 60_000 / elapsedMs, workerThreadId: planner.threadId,
    environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, availableParallelism: availableParallelism(), node: process.version, engineKind: options.engineKind, ticksPerSecond: 2 },
    records,
  };
}
