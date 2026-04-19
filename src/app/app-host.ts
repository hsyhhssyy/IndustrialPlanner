import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { AppContract } from "@/domain/contract/app-contract";
import { AppActionImpl, AppInternalAction } from "./action-impl";
import { createUiStateReadWrite, UiStateReadWrite } from "./state-impl";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  internalState: UiStateReadWrite;
  internalActions: AppInternalAction;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract
): AppHost {
  const internalState = createUiStateReadWrite();
  const actionImpl = new AppActionImpl(internalState);
  const internalActions: AppInternalAction = {
    toggleLeftDock: actionImpl.toggleLeftDock,
    toggleRightDock: actionImpl.toggleRightDock,
  };
  const actions: AppContract["actions"] = {
    translate: actionImpl.translate,
  };

  const host: AppHost = {
    state: internalState,
    workspace,
    internalState,
    internalActions,
    dispose: () => {
    },
    queries: {},
    actions,
  };

  workspace.app = host;

  return host;
}
