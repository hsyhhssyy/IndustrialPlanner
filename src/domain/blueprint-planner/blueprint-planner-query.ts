import type { BlueprintPlannerProgress, BlueprintPlannerRequest, BlueprintPlannerResult } from "./types/blueprint-planner-types";

export interface BlueprintPlannerQuery {
  getTask(): BlueprintPlannerProgress | null;
  getLastRequest(): BlueprintPlannerRequest | null;
  getResult(taskId: string): BlueprintPlannerResult | null;
}
