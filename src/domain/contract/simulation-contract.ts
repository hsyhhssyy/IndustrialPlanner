import { SimulationAction } from "../action/simulation-action";
import { SimulationQuery } from "../query/simulation-query";

export interface SimulationContract {
  queries: SimulationQuery;
  actions: SimulationAction;
}