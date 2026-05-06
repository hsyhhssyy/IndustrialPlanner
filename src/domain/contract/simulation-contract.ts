import { SimulationAction } from "../action/simulation-action";
import { SimulationQuery } from "../query/simulation-query";
import type { SimulationState } from "./simulation-contract-types";

export interface SimulationContract {
  readonly state: SimulationState;
  /**
   * 仅作为 advancePlaybackByDeltaMs 的时间推进倍率使用。
   * 禁止在任何其他逻辑中直接消费该值；tick 和 second 的换算一律使用 standard tick rate。
   */
  simulationSpeed: number;
  queries: SimulationQuery;
  actions: SimulationAction;
}