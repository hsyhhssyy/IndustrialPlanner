import type { BlueprintPlannerRequest } from "./types/blueprint-planner-types";

export interface BlueprintPlannerAction {
  start(request: BlueprintPlannerRequest): string;
  continuePlanning(taskId: string, additionalBudgetMs: number, evaluationsPerRound: number): void;
  save(taskId: string): Promise<void>;
  cancel(taskId: string): void;
  retrySave(taskId: string): Promise<void>;
}
