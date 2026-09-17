import type { BlueprintPlannerPhase, BlueprintPlannerRequest } from "@/domain/blueprint-planner";
import type { PlannerCandidate } from "./candidate";
import type { PlannerSearchOptions, PlannerSearchStatistics } from "./search-types";

export interface PlannerWorkerRequest {
  readonly id: number;
  readonly request: BlueprintPlannerRequest;
  readonly variant: number;
  readonly budgetMs: number;
  readonly search?: PlannerSearchOptions;
}

export type PlannerWorkerResponse =
  | { readonly id: number; readonly type: "progress"; readonly phase: BlueprintPlannerPhase; readonly message: string }
  | { readonly id: number; readonly type: "completed"; readonly candidate: PlannerCandidate }
  | { readonly id: number; readonly type: "failed"; readonly kind: "candidate" | "timeout" | "fatal"; readonly message: string; readonly search?: PlannerSearchStatistics };
