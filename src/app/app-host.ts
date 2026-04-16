import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { AppContract } from "@/domain/contract/app-contract";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract
): AppHost {
  const host: AppHost = {
    workspace,
    dispose: () => {
    },
    queries: {},
    actions: {}
  };
  workspace.app = host;
  return host;
}
