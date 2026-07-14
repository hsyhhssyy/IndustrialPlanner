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
import { WorkbenchRecipePickerController } from "../shell/state/recipe-picker-state";
import { WorkbenchSaveBlueprintDialogController } from "../shell/state/save-blueprint-dialog-state";
import { cleanupDiscardableV2LocalStorageBeforeV3Boot } from "../migration";
import { WorkbenchOverlapEntityMenuController } from "../shell/state/overlap-entity-menu-state";

export interface AppHost extends AppContract {
  workspace: WorkspaceContract;
  gestureAdapter: GestureAdapter;
  gestureActionRouter: GestureActionRouter<AppHost>;
  gestureDiagnostics: GestureDiagnosticsStore;
  internalState: UiStateReadWrite;
  internalActions: AppInternalAction;
  blueprintFolderDialog: WorkbenchBlueprintFolderDialogController;
  blueprintPreview: WorkbenchBlueprintPreviewController;
  saveBlueprintDialog: WorkbenchSaveBlueprintDialogController;
  encyclopediaPicker: WorkbenchEncyclopediaPickerController;
  recipePicker: WorkbenchRecipePickerController;
  overlapEntityMenu: WorkbenchOverlapEntityMenuController;
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
  const saveBlueprintDialog = new WorkbenchSaveBlueprintDialogController(
    internalState.workbench.dialogState["save-blueprint"],
  );
  const overlapEntityMenu = new WorkbenchOverlapEntityMenuController();
  const encyclopediaPicker = new WorkbenchEncyclopediaPickerController(
    () => internalState.workbench.toolbox.wiki,
  );
  const recipePicker = new WorkbenchRecipePickerController();
  const gestureActionRouter = createGestureActionRouter<AppHost>({
    gestureAdapter,
    workspace,
    getAppHost: () => host,
  });

  // 将 router 的长按查询能力回注到 gestureAdapter，由 adapter 在显示长按圆圈前询问
  gestureAdapter["adapterOptions"].queryLongPressAcceptance = (
    gridHasEntity: boolean,
  ) => gestureActionRouter.queryLongPressAcceptance(gridHasEntity);

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
    saveBlueprintDialog,
    overlapEntityMenu,
    encyclopediaPicker,
    recipePicker,
  });

  const shortcutManager = new KeyboardShortcutManager(host);
  disposers.push(shortcutManager.hookPersistence());
  disposers.push(() => shortcutManager.dispose());

  const actionImpl = new AppActionImpl(internalState, workspace, shortcutManager);
  const internalActions: AppInternalAction = {
    toggleLeftDock: actionImpl.toggleLeftDock,
    setLeftDockSuppressed: actionImpl.setLeftDockSuppressed,
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
    setToolboxDockPreference: actionImpl.setToolboxDockPreference,
    setToolboxBottomDockCollapsed: actionImpl.setToolboxBottomDockCollapsed,
    setToolboxBottomDockHeight: actionImpl.setToolboxBottomDockHeight,
    setTimelineDockPreference: actionImpl.setTimelineDockPreference,
    setTimelineBottomDockCollapsed: actionImpl.setTimelineBottomDockCollapsed,
    setTimelineBottomDockHeight: actionImpl.setTimelineBottomDockHeight,
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
    matchesAnyShortcut: actionImpl.matchesAnyShortcut,
    setShortcutFor: actionImpl.setShortcutFor,
    resetAllShortcutsToDefaults: actionImpl.resetAllShortcutsToDefaults,
  };
  const actions: AppContract["actions"] = {
    translate: actionImpl.translate,
  };

  Object.assign(host, {
    internalActions,
    dispose: () => {
      blueprintFolderDialog.close();
      blueprintPreview.close();
      saveBlueprintDialog.close();
      overlapEntityMenu.dispose();
      encyclopediaPicker.dispose();
      recipePicker.dispose();
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
  cleanupDiscardableV2LocalStorageBeforeV3Boot();
  disposers.push(hookLocalstorage(host));
  disposers.push(hookThemeApplicator(host));

  return host;
}
