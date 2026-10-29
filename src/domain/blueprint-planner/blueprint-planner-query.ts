import type { BlueprintPlannerProgress, BlueprintPlannerRequest, BlueprintPlannerResult, BlueprintPlannerTaskFile, BlueprintPlannerTaskRequest } from "./types/blueprint-planner-types";

export interface BlueprintPlannerQuery {
  listTasks(): readonly BlueprintPlannerProgress[];
  exportTask(taskId: string): BlueprintPlannerTaskFile;
  exportDraft(request: BlueprintPlannerRequest): BlueprintPlannerTaskFile;
  getTask(taskId?: string): BlueprintPlannerProgress | null;
  getTaskTitle(taskId: string): string | null;
  getRandomSeed(taskId: string): number | null;
  getLastRequest(taskId?: string): BlueprintPlannerTaskRequest | null;
  getResult(taskId: string): BlueprintPlannerResult | null;
}
