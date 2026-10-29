import type { BlueprintPlannerBlueprintBoundary, BlueprintPlannerBlueprintOptimizations, BlueprintPlannerBlueprintRecognitionRequest, BlueprintPlannerProgress, BlueprintPlannerTaskRequest } from "@/domain/blueprint-planner";

export const DEFAULT_BLUEPRINT_OPTIMIZATIONS: BlueprintPlannerBlueprintOptimizations = Object.freeze({
  reassignPorts: false, reassignConnections: false, rebuildLogistics: false, mergeBoundaryFacilities: false,
});

export const MAX_PLANNER_TASK_TITLE_LENGTH = 200;

/** 标题是任务元数据，不参与输入规则与搜索检查点；空文本恢复自动命名。 */
export function normalizePlannerTaskTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("任务标题必须是文本。");
  const title = value.trim();
  if (title.length > MAX_PLANNER_TASK_TITLE_LENGTH || /[\r\n]/.test(title)) throw new Error("任务标题不能超过 200 个字符或包含换行。");
  return title || undefined;
}

/** 识别请求没有产率计划；调用方须先区分任务阶段再读取 plan。 */
export function isBlueprintRecognitionRequest(request: BlueprintPlannerTaskRequest): request is BlueprintPlannerBlueprintRecognitionRequest {
  return "kind" in request && request.kind === "blueprint-recognition";
}

/** 启动标记优先于计数；旧任务根据搜索进度判断，不能把识别或保存基线当成启动。 */
export function hasPlannerStarted(progress: BlueprintPlannerProgress): boolean {
  return progress.planningStarted === true || progress.evaluatedProposals > 0 || progress.candidateCount > 0
    || progress.planningStarted === undefined && progress.phase !== "identification"
      && (["running", "cancelled", "failed"].includes(progress.status)
        || ["layout", "routing", "verification", "optimization"].includes(progress.phase));
}

/** 同一设备的多个断头端口保持独立身份。 */
export const blueprintBoundaryKey = (boundary: BlueprintPlannerBlueprintBoundary) =>
  `${boundary.entityId}/${boundary.portGroupId}/${boundary.portId}/${boundary.direction}`;
