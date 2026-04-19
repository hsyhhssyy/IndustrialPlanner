import { SimulationContract } from "@/domain/contract/simulation-contract";
import { WorkspaceContract } from "@/domain/contract/workspace-contract";

export interface SimulationHost extends SimulationContract {
  workspace: WorkspaceContract;
}


export function createSimulationHost(
  workspace: WorkspaceContract
): SimulationHost {
  const host: SimulationHost = {
    workspace,
    queries: {},
    actions: {}
  };

  workspace.simulation = host;

  return host;
}
