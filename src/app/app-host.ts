import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { AppContract } from "@/domain/contract/app-contract";
import { AppActionImpl, AppInternalAction } from "./action-impl";
import { hookLocalstorage } from "./storage-hook";
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
  const disposers: Array<() => void> = [];
  const internalState = createUiStateReadWrite();
  const actionImpl = new AppActionImpl(internalState, workspace);
  const internalActions: AppInternalAction = {
    toggleLeftDock: actionImpl.toggleLeftDock,
    toggleRightDock: actionImpl.toggleRightDock,
    setActivePanel: actionImpl.setActivePanel,
    setLeftDockWidth: actionImpl.setLeftDockWidth,
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
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries: {},
    actions,
  };

  workspace.app = host;
  disposers.push(hookLocalstorage(host));

  return host;
}
