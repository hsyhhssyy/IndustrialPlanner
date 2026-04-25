import { WorkspaceContract } from "@/domain/contract/workspace-contract";
import { AppContract } from "@/domain/contract/app-contract";
import { AppActionImpl, AppInternalAction } from "./action-impl";
import { createGestureAdapter, GestureAdapter } from "./input/gesture-adapter";
import {
  AppGestureModuleRegistrar,
  createGestureActionRouter,
  GestureActionRouter,
} from "./input/gesture-actions";
import {
  createGestureDiagnosticsStore,
  GestureDiagnosticsStore,
} from "./input/gesture-diagnostics";
import { hookLocalstorage } from "./storage-hook";
import { createUiStateReadWrite, UiStateReadWrite } from "./state-impl";
import { hookThemeApplicator } from "./theme/theme-applicator";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  gestureAdapter: GestureAdapter;
  gestureActionRouter: GestureActionRouter<AppHost>;
  gestureDiagnostics: GestureDiagnosticsStore;
  internalState: UiStateReadWrite;
  internalActions: AppInternalAction;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract
): AppHost {
  const disposers: Array<() => void> = [];
  const internalState = createUiStateReadWrite();
  const gestureAdapter = createGestureAdapter({
    resolvePointerEntity: (position) => workspace.editor?.queries.findEntityAtClientPixelPoint(position) ?? null,
  });
  const gestureDiagnostics = createGestureDiagnosticsStore();
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
    toggleTopBarCollapsed: actionImpl.toggleTopBarCollapsed,
    setActivePanel: actionImpl.setActivePanel,
    setActiveTool: actionImpl.setActiveTool,
    showCanvasToolbar: actionImpl.showCanvasToolbar,
    moveCanvasToolbar: actionImpl.moveCanvasToolbar,
    hideCanvasToolbar: actionImpl.hideCanvasToolbar,
    setLeftDockWidth: actionImpl.setLeftDockWidth,
    setScreenProfile: actionImpl.setScreenProfile,
    setLocale: actionImpl.setLocale,
  };
  const actions: AppContract["actions"] = {
    translate: actionImpl.translate,
  };

  Object.assign(host, {
    state: internalState,
    workspace,
    gestureAdapter,
    gestureActionRouter,
    gestureDiagnostics,
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
  const gestureModuleRegistrar = new AppGestureModuleRegistrar({
    router: gestureActionRouter,
    gestureDiagnostics,
  });
  disposers.push(() => {
    gestureModuleRegistrar.dispose();
  });
  disposers.push(gestureAdapter.subscribeKeyboardSnapshot((snapshot) => {
    gestureDiagnostics.setKeyboardSnapshot(snapshot);
  }));
  disposers.push(hookLocalstorage(host));
  disposers.push(hookThemeApplicator(host));

  return host;
}
