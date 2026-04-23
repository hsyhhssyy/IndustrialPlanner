import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { AppContract } from "@/domain/contract/app-contract";
import { AppActionImpl, AppInternalAction } from "./action-impl";
import { createGestureAdapter, GestureAdapter } from "./input/gesture-adapter";
import {
  createGestureActionRouter,
  GestureActionRouter,
} from "./input/gesture-actions";
import { hookLocalstorage } from "./storage-hook";
import { createUiStateReadWrite, UiStateReadWrite } from "./state-impl";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  gestureAdapter: GestureAdapter;
  gestureActionRouter: GestureActionRouter<AppHost>;
  internalState: UiStateReadWrite;
  internalActions: AppInternalAction;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract
): AppHost {
  const disposers: Array<() => void> = [];
  const internalState = createUiStateReadWrite();
  const gestureAdapter = createGestureAdapter();
  const host = {} as AppHost;
  const gestureActionRouter = createGestureActionRouter<AppHost>({
    gestureAdapter,
    workspace,
    getAppHost: () => host,
  });
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

  Object.assign(host, {
    state: internalState,
    workspace,
    gestureAdapter,
    gestureActionRouter,
    internalState,
    internalActions,
    dispose: () => {
      gestureActionRouter.dispose();
      gestureAdapter.dispose();
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
    },
    queries: {},
    actions,
  });

  workspace.app = host;
  disposers.push(hookLocalstorage(host));

  return host;
}
