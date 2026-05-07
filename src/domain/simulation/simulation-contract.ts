import type { SimulationState } from "./types/simulation-types";
import type { SimulationAction } from "./simulation-action";
import type { SimulationQuery } from "./simulation-query";

export interface SimulationContract {
  readonly state: SimulationState;
  
  queries: SimulationQuery;
  actions: SimulationAction;
}
