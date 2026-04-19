import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { AppContract } from "@/domain/contract/app-contract";
import { createUiStateReadWrite, UiStateReadWrite } from "./state-impl";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  state: UiStateReadWrite;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract
): AppHost {
  const appState = createUiStateReadWrite();

  const host: AppHost = {
    app: appState,
    workspace,
    state: appState,
    dispose: () => {
    },
    queries: {},
    actions: {}
  };

  workspace.app = host;

  return host;
}
