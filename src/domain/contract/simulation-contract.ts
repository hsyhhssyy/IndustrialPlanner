import type { SnapshotStore } from "@/shared/snapshot/snapshot-store";

import { SimulationAction } from "../action/simulation-action";
import { SimulationQuery } from "../query/simulation-query";
import type { CompiledSimulationTopology } from "../types/simulation";

export interface SimulationContract {
  topology: SnapshotStore<CompiledSimulationTopology | null>;
  queries: SimulationQuery;
  actions: SimulationAction;
}