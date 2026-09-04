import type {
  SimulationEngineKind,
  SimulationState,
} from "./types/simulation-types";
import type { SimulationAction } from "./simulation-action";
import type { SimulationQuery } from "./simulation-query";

export interface SimulationContract {
  readonly engineKind: SimulationEngineKind;
  readonly state: SimulationState;
  
  queries: SimulationQuery;
  actions: SimulationAction;
}
