import type { BlueprintPlannerBlueprintBoundary, BlueprintPlannerBlueprintInput, BlueprintPlannerBlueprintRecognitionRequest,
  BlueprintPlannerOptions, BlueprintPlannerTaskFile } from "@/domain/blueprint-planner";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { normalizeBlueprintDocument } from "@/shared/blueprints/blueprint-document-codec";
import { isBlueprintRecognitionRequest } from "@/shared/planner-task";
import { isItemAvailableByActivity } from "@/shared/registry/activity-availability";
import { validatePlannerTaskOptions } from "./task-checkpoint";
import { blueprintBoundaryKey } from "./blueprint-analysis";
import { excludeDisconnectedBlueprintPipes, withBlueprintDisconnectionWarning } from "./blueprint-disconnections";

export const BLUEPRINT_RECOGNITION_VERSION = "blueprint-recognition-1";

export interface BlueprintRecognitionCheckpoint {
  step: "inspection" | "inputs" | "outputs" | "verification";
}

export type BlueprintRecognitionTaskFile = BlueprintPlannerTaskFile & {
  request: BlueprintPlannerBlueprintRecognitionRequest;
  checkpoint: BlueprintRecognitionCheckpoint;
};

export interface BlueprintRecognitionTask {
  file: BlueprintRecognitionTaskFile;
  abort: AbortController;
  resumedAt: number | null;
  running: Promise<void> | null;
}

export function validateRecognitionInput(registry: RegistryContract, input: BlueprintPlannerBlueprintInput): void {
  const blueprint = input?.blueprint;
  if (!blueprint || blueprint.schemaVersion !== BLUEPRINT_SCHEMA_VERSION || !normalizeBlueprintDocument(blueprint)
    || !blueprint.entityOrder.length || new Set(blueprint.entityOrder).size !== blueprint.entityOrder.length
    || blueprint.entityOrder.some(id => {
      const entity = blueprint.entities[id];
      return !entity || entity.id !== id || !registry.queries.findEntityDefinition(entity.definitionId)
        || !Number.isSafeInteger(entity.position.x) || !Number.isSafeInteger(entity.position.y)
        || ![0, 90, 180, 270].includes(entity.rotation);
    }) || !Array.isArray(input.activeActivityIds) || input.activeActivityIds.some(id => typeof id !== "string")) {
    throw new Error("识别任务原蓝图或活动配置无效。");
  }
  validateRecognitionBoundaries(registry, input, input.boundaries);
}

export function validateRecognitionBoundaries(registry: RegistryContract, input: BlueprintPlannerBlueprintInput,
  boundaries: readonly BlueprintPlannerBlueprintBoundary[]): void {
  if (!Array.isArray(boundaries) || new Set(boundaries.map(blueprintBoundaryKey)).size !== boundaries.length
    || boundaries.some(boundary => {
      const entity = input.blueprint.entities[boundary.entityId];
      const definition = entity && registry.queries.findEntityDefinition(entity.definitionId);
      const item = boundary.itemId === null ? null : registry.queries.findItemDefinition(boundary.itemId);
      return !definition || !["input", "output"].includes(boundary.direction) || !["port", "facility"].includes(boundary.kind)
        || typeof boundary.portGroupId !== "string" || typeof boundary.portId !== "string"
        || boundary.kind === "facility" && (boundary.portGroupId !== "" || boundary.portId !== "")
        || boundary.kind === "port" && !definition.portGroups.some(group => group.id === boundary.portGroupId
          && group.direction === boundary.direction && group.ports.some(port => port.id === boundary.portId))
        || boundary.itemId !== null && (!item || !isItemAvailableByActivity(item, input.activeActivityIds));
    })) throw new Error("识别任务边界或物品配置无效。");
}

export function createRecognitionTaskFile(registry: RegistryContract, taskId: string,
  input: BlueprintPlannerBlueprintInput, options: BlueprintPlannerOptions): BlueprintRecognitionTaskFile {
  validateRecognitionInput(registry, input);
  return parseRecognitionTaskFile({ formatVersion: 1, algorithmVersion: BLUEPRINT_RECOGNITION_VERSION, taskId,
    request: { kind: "blueprint-recognition", input: structuredClone(input), options: structuredClone(options), detectedBoundaries: null },
    checkpoint: { step: "inspection" }, progress: { taskId, status: "waiting", phase: "identification", startedAt: Date.now(),
      elapsedMs: 0, estimatedProgress: null, evaluatedProposals: 0, roundEvaluatedProposals: 0, candidateCount: 0,
      validatedCandidateCount: 0, bestArea: null, areaHistory: [], message: "正在准备蓝图边界检查。" } }, registry);
}

/** 导入只校验可恢复事实；真实端口与物品传播仍在继续识别时重新核对。 */
export function parseRecognitionTaskFile(value: BlueprintPlannerTaskFile, registry: RegistryContract): BlueprintRecognitionTaskFile {
  const file = structuredClone(value);
  if (file?.formatVersion !== 1 || file.algorithmVersion !== BLUEPRINT_RECOGNITION_VERSION
    || typeof file.taskId !== "string" || !file.taskId || file.taskId.length > 200
    || !file.request || !isBlueprintRecognitionRequest(file.request)) throw new Error("蓝图识别任务格式或版本无效。");
  const request = file.request;
  validateRecognitionInput(registry, request.input);
// AI-REMOVED 2026-10-07:
// Reason: 共用既有规划参数校验。
// Trigger: 用户要求识别任务可恢复、自动识别出口与预览联动。
// Evidence: 原实现只在识别成功后建任务，边界必须全部手动补齐。
// Replacement: task-checkpoint.ts validatePlannerTaskOptions
// Risk: 已保存规划任务保留原有格式和验收；Human Review: Required
// Original code:
//   const options = request.options;
//   const choices = { solidSupply: ["external", "warehouse"], fluidSupply: ["external", "conduit"], warehouseBus: ["straight", "corner", "u-shaped"],
//     solidOutput: ["auto", "warehouse", "stash"], byproducts: ["destroy", "output"], plantStartup: ["preload", "warehouse"] };
//   if (!options || Object.entries(choices).some(([key, values]) => !values.includes(options[key as keyof typeof choices]))
//     || !Number.isSafeInteger(options.evaluationsPerRound) || options.evaluationsPerRound < 1000 || options.evaluationsPerRound % 1000 !== 0
//     || options.concurrency !== undefined && options.concurrency !== "auto" && (!Number.isSafeInteger(options.concurrency)
//       || options.concurrency < 1 || options.concurrency > 32)
//     || options.gpu !== undefined && typeof options.gpu !== "boolean"
//     || options.converterStartup !== undefined && !["manual", "tank", "reject"].includes(options.converterStartup)) throw new Error("识别任务计算参数无效。");
  validatePlannerTaskOptions(request.options);
  const point = file.checkpoint as BlueprintRecognitionCheckpoint;
  const progress = file.progress;
  if (!point || !["inspection", "inputs", "outputs", "verification"].includes(point.step)
    || !progress || progress.taskId !== file.taskId || progress.phase !== "identification"
    || !["waiting", "running", "cancelled", "failed"].includes(progress.status)
    || !Number.isFinite(progress.startedAt) || !Number.isFinite(progress.elapsedMs) || progress.elapsedMs < 0
    || [progress.evaluatedProposals, progress.roundEvaluatedProposals, progress.candidateCount, progress.validatedCandidateCount].some(value => value !== 0)
    || progress.bestArea !== null || progress.areaHistory?.length || progress.estimatedProgress !== null) throw new Error("识别任务进度无效。");
  if (request.detectedBoundaries !== null) {
    validateRecognitionBoundaries(registry, request.input, request.detectedBoundaries);
    const detected = new Map(request.detectedBoundaries.map(entry => [blueprintBoundaryKey(entry), entry]));
    if (detected.size !== request.input.boundaries.length || request.input.boundaries.some(entry => {
      const fixed = detected.get(blueprintBoundaryKey(entry));
      return !fixed || fixed.kind !== entry.kind || fixed.itemId !== null && entry.itemId !== fixed.itemId;
    })) throw new Error("识别任务改变了原蓝图的固定边界配置。");
  } else if (point.step !== "inspection") throw new Error("识别任务缺少已完成的边界检查。");
  const { excludedEntityIds } = excludeDisconnectedBlueprintPipes(registry, request.input);
  const changed = request.input.boundaries.some(boundary => excludedEntityIds.has(boundary.entityId));
  const effectiveRequest = changed ? { ...request,
    input: { ...request.input, boundaries: request.input.boundaries.filter(boundary => !excludedEntityIds.has(boundary.entityId)) },
    detectedBoundaries: request.detectedBoundaries?.filter(boundary => !excludedEntityIds.has(boundary.entityId)) ?? null } : request;
  return { ...file, request: effectiveRequest, checkpoint: changed && point.step !== "inspection" ? { step: "inputs" } : point,
    progress: { ...progress, message: withBlueprintDisconnectionWarning(registry, request.input, progress.message) } };
}
