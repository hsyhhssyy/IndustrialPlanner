import { SimulationContract } from "@/domain/contract/simulation-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";

export interface SimulationHost extends SimulationContract {
}


export function createSimulationHost(
  workspace: WorkspaceContract
): SimulationHost {
  const host: SimulationHost = {
    queries: {},
    actions: {}
  };
  return host;
}
