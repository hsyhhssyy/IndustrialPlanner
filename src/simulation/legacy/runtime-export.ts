import type { CompiledSimulationTopology, RuntimeTickSnapshot } from "../contracts";
import type { SimulationMutableRuntimeState } from "./runtime-state";

export interface SimulationRuntimeExport {
  readonly topology: CompiledSimulationTopology;
  readonly runtimeState: SimulationMutableRuntimeState;
  readonly snapshot: RuntimeTickSnapshot;
  readonly powerMode: "real" | "infinite";
  readonly powerConsumptionOverride: number | undefined;
}
