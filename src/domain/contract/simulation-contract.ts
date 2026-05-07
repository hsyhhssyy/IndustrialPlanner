import { SimulationAction } from "../action/simulation-action";
import { SimulationQuery } from "../query/simulation-query";

export type SimulationRunState = "stop" | "start" | "pause";

export interface SimulationState{
  readonly runningState: SimulationRunState;
  /**
   * 仅作为 advancePlaybackByDeltaMs 的时间推进倍率使用。
   * 禁止在任何其他逻辑中直接消费该值；tick 和 second 的换算一律使用 standard tick rate。
   */
  readonly simulationSpeed: number;
}

export interface SimulationContract {
  readonly state: SimulationState;
  
  queries: SimulationQuery;
  actions: SimulationAction;
}