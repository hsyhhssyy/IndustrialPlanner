import type { BlueprintPlannerRequest } from "./types/blueprint-planner-types";

export interface BlueprintPlannerAction {
  start(request: BlueprintPlannerRequest): string;
  continuePlanning(taskId: string, additionalBudgetMs: number): void;
  cancel(taskId: string): void;
  retrySave(taskId: string): Promise<void>;
}
