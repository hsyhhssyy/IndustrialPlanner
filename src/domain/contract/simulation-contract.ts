import type { SnapshotStore } from "@/shared/snapshot/snapshot-store";

import { SimulationAction } from "../action/simulation-action";
import { SimulationQuery } from "../query/simulation-query";
import type {
  CompiledSimulationTopology,
  SimulationState,
} from "../types/simulation";

export interface SimulationContract {
  readonly state: SimulationState;
  /**
   * 仅作为 advancePlaybackByDeltaMs 的时间推进倍率使用。
   * 禁止在任何其他逻辑中直接消费该值；tick 和 second 的换算一律使用 standard tick rate。
   */
  simulationSpeed: number;
  topology: SnapshotStore<CompiledSimulationTopology | null>;
  queries: SimulationQuery;
  actions: SimulationAction;
}