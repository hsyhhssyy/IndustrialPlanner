import type { SimulationState } from "@/simulation/host/simulation-host";
import { createEmptySimulationPatchSet } from "@/simulation/protocol/simulation-patch";

const runtimeSnapshot = {
  tick: 0,
  status: "idle",
  entityViews: {},
  patchedEntityIds: [],
} satisfies SimulationState["runtimeSnapshot"];

const selection: SimulationState["selection"] = [];
const patchSet = createEmptySimulationPatchSet();

export const SIMULATION_STUB_STATE = {
  runtimeSnapshot,
  selection,
  inspectorDetails: null,
  patchSet,
} satisfies Pick<
  SimulationState,
  "runtimeSnapshot" | "selection" | "inspectorDetails" | "patchSet"
>;