import { WorkspaceContract } from "@/domain/document/workspace-contract";
import { AppContract } from "@/domain/app/app-contract";
import { AppActionImpl, AppInternalAction } from "../actions/action-impl";
import { createGestureAdapter, GestureAdapter } from "../input/gesture/adapter";
import {
  AppGestureModuleRegistrar,
  createGestureActionRouter,
  GestureActionRouter,
} from "../input/gesture/actions";
import {
  createGestureDiagnosticsStore,
  GestureDiagnosticsStore,
} from "../input/gesture/diagnostics";
import { KeyboardShortcutManager } from "../actions/keyboard-shortcut-manager";
import { hookLocalstorage } from "../state/storage-hook";
import { createUiStateReadWrite, UiStateReadWrite } from "../state/state-impl";
import { hookThemeApplicator } from "../theme/theme-applicator";
import { WorkbenchBlueprintFolderDialogController } from "../shell/state/blueprint-folder-dialog-state";
import { WorkbenchBlueprintPreviewController } from "../shell/state/blueprint-preview-dialog-state";
import { WorkbenchEncyclopediaPickerController } from "../shell/state/encyclopedia-picker-state";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  gestureAdapter: GestureAdapter;
  gestureActionRouter: GestureActionRouter<AppHost>;
  gestureDiagnostics: GestureDiagnosticsStore;
  internalState: UiStateReadWrite;
  internalActions: AppInternalAction;
  blueprintFolderDialog: WorkbenchBlueprintFolderDialogController;
  blueprintPreview: WorkbenchBlueprintPreviewController;
  encyclopediaPicker: WorkbenchEncyclopediaPickerController;
  dispose: () => void;
}


export function createAppHost(
  workspace: WorkspaceContract
): AppHost {
  const disposers: Array<() => void> = [];
  const internalState = createUiStateReadWrite();
  const host = {
    workspace,
    internalState,
  } as AppHost;
  const publicState: AppContract["state"] = {
    get settings() {
      return internalState.settings;
    },
    get workbench() {
      return internalState.workbench;
    },
    get screenProfile() {
      return internalState.screenProfile;
    },
    get theme() {
      return internalState.theme;
    },
    get activeTool() {
      return internalState.activeTool;
    },
    get toolInfo() {
      return internalState.toolInfo;
    },
  };
  const gestureAdapter = createGestureAdapter(host);
  const gestureDiagnostics = createGestureDiagnosticsStore();
  const blueprintFolderDialog = new WorkbenchBlueprintFolderDialogController();
  const blueprintPreview = new WorkbenchBlueprintPreviewController();
  const encyclopediaPicker = new WorkbenchEncyclopediaPickerController(
    () => internalState.workbench.toolbox.wiki,
  );
  const gestureActionRouter = createGestureActionRouter<AppHost>({
    gestureAdapter,
    workspace,
    getAppHost: () => host,
  });

  // 先组装 host 的基础部分（state 必须就绪，shortcutManager 构造时需要读）
  Object.assign(host, {
    state: publicState,
    workspace,
    gestureAdapter,
    gestureActionRouter,
    gestureDiagnostics,
    internalState,
    blueprintFolderDialog,
    blueprintPreview,
    encyclopediaPicker,
  });

  const shortcutManager = new KeyboardShortcutManager(host);
  disposers.push(shortcutManager.hookPersistence());
  disposers.push(() => shortcutManager.dispose());

  const actionImpl = new AppActionImpl(internalState, workspace, shortcutManager);
  const internalActions: AppInternalAction = {
    toggleLeftDock: actionImpl.toggleLeftDock,
    toggleRightDock: actionImpl.toggleRightDock,
    setRightDockOpen: actionImpl.setRightDockOpen,
    toggleTopBarCollapsed: actionImpl.toggleTopBarCollapsed,
    setRightDockActiveTab: actionImpl.setRightDockActiveTab,
    openDialog: actionImpl.openDialog,
    closeDialog: actionImpl.closeDialog,
    toggleDialogMaximized: actionImpl.toggleDialogMaximized,
    setDialogTab: actionImpl.setDialogTab,
    setDialogOffset: actionImpl.setDialogOffset,
    setDialogSize: actionImpl.setDialogSize,
    setActivePanel: actionImpl.setActivePanel,
    setActiveTool: actionImpl.setActiveTool,
    showCanvasFloatingToolbar: actionImpl.showCanvasFloatingToolbar,
    showCanvasFloatingToolbarForCollection: actionImpl.showCanvasFloatingToolbarForCollection,
    moveCanvasFloatingToolbar: actionImpl.moveCanvasFloatingToolbar,
    alignCanvasFloatingToolbar: actionImpl.alignCanvasFloatingToolbar,
    setCanvasFloatingToolbarSize: actionImpl.setCanvasFloatingToolbarSize,
    hideCanvasFloatingToolbar: actionImpl.hideCanvasFloatingToolbar,
    showCanvasRightDockToolbar: actionImpl.showCanvasRightDockToolbar,
    hideCanvasRightDockToolbar: actionImpl.hideCanvasRightDockToolbar,
    showCanvasTopLeftCornerToolbar: actionImpl.showCanvasTopLeftCornerToolbar,
    hideCanvasTopLeftCornerToolbar: actionImpl.hideCanvasTopLeftCornerToolbar,
    setLeftDockWidth: actionImpl.setLeftDockWidth,
    setScreenProfile: actionImpl.setScreenProfile,
    setLocale: actionImpl.setLocale,
    getKeyboardShortcutFor: actionImpl.getKeyboardShortcutFor,
    isShortcutFor: actionImpl.isShortcutFor,
    setShortcutFor: actionImpl.setShortcutFor,
  };
  const actions: AppContract["actions"] = {
    translate: actionImpl.translate,
  };

  Object.assign(host, {
    internalActions,
    dispose: () => {
      blueprintFolderDialog.close();
      blueprintPreview.close();
      encyclopediaPicker.dispose();
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
    appHost: host,
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
