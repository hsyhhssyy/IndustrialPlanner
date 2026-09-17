import type { BlueprintPlannerState } from "./blueprint-planner-state";
import type { BlueprintPlannerAction } from "./blueprint-planner-action";
import type { BlueprintPlannerQuery } from "./blueprint-planner-query";

export interface BlueprintPlannerContract {
  readonly state: BlueprintPlannerState;
  readonly actions: BlueprintPlannerAction;
  readonly queries: BlueprintPlannerQuery;
}
