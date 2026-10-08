import type { BlueprintPlannerBlueprintBoundary, BlueprintPlannerBlueprintRecognitionRequest, BlueprintPlannerTaskRequest } from "@/domain/blueprint-planner";

/** 识别请求没有产率计划；调用方须先区分任务阶段再读取 plan。 */
export function isBlueprintRecognitionRequest(request: BlueprintPlannerTaskRequest): request is BlueprintPlannerBlueprintRecognitionRequest {
  return "kind" in request && request.kind === "blueprint-recognition";
}

/** 同一设备的多个断头端口保持独立身份。 */
export const blueprintBoundaryKey = (boundary: BlueprintPlannerBlueprintBoundary) =>
  `${boundary.entityId}/${boundary.portGroupId}/${boundary.portId}/${boundary.direction}`;
