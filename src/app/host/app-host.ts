import { WorkspaceContract } from "@/domain/document/workspace-contract";
import { AppContract } from "@/domain/app/app-contract";
import { AppActionImpl, AppInternalAction } from "../actions/action-impl";
import { createGestureAdapter, GestureAdapter } from "../input/gesture/adapter";
import {
  AppGestureModuleRegistrar,
  createGestureActionRouter,
  GestureActionRouter,
  type ShortcutInputLayer,
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
import { RegionalSettingsController } from "../regional-settings";
// AI-REMOVED 2026-07-29:
// Reason: WebDAV 生命周期和状态已由独立顶层 sync 模块拥有。
// Trigger: 用户要求 app 不再实例化或驱动同步客户端。
// Evidence: AppHost 原先直接构造 controller 并 hook WebDAV service。
// Replacement: main.tsx 组合 createSyncHost；UI 通过 workspace.sync 访问公开契约。
// Risk: Low；AppHost 不再承担网络职责。
// Human Review: Required
//
// Original code:
// import { hookWebDavSyncAppService } from "../sync/webdav-sync-app-service";
// import { WebDavSyncAppController } from "../sync/webdav-sync-app-controller";

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
  regionalSettings: RegionalSettingsController;
  // AI-REMOVED 2026-07-29:
  // Reason: 同步状态不再是 AppHost 的内部对象。
  // Trigger: 独立顶层 sync 模块通过 WorkspaceContract.sync 发布状态。
  // Evidence: webDavSync 属性迫使设置页依赖 app 的同步实现。
  // Replacement: workspace.sync。
  // Risk: Low；所有消费者迁移到领域契约。
  // Human Review: Required
  //
  // Original code:
  // webDavSync: WebDavSyncAppController;
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
    get moveKind() {
      return internalState.moveKind;
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
  const regionalSettings = new RegionalSettingsController(workspace.registry);
  const encyclopediaPicker = new WorkbenchEncyclopediaPickerController(
    () => internalState.workbench.toolbox.wiki,
  );
  const recipePicker = new WorkbenchRecipePickerController();
  // AI-REMOVED 2026-07-29:
  // Reason: SyncStateImpl 的实例化由 createSyncHost 负责。
  // Trigger: 顶层模块生命周期解耦。
  // Evidence: const webDavSync = new WebDavSyncAppController();
  // Replacement: main.tsx 中的 createSyncHost。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // const webDavSync = new WebDavSyncAppController();
  const gestureActionRouter = createGestureActionRouter<AppHost>({
    gestureAdapter,
    workspace,
    getAppHost: () => host,
    getShortcutBinding: (shortcutId) => host.internalActions.getKeyboardShortcutFor(shortcutId),
    getShortcutInputLayer: (_event, context) => resolveShortcutInputLayer(context.appHost),
    getActiveTool: (context) => context.appHost.internalState.activeTool,
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
    regionalSettings,
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
  // AI-REMOVED 2026-07-29:
  // Reason: AppHost 不再主动挂载 WebDAV 服务。
  // Trigger: sync 模块自行订阅 editor snapshot 与业务资源端口。
  // Evidence: disposers.push(hookWebDavSyncAppService(host));
  // Replacement: createSyncHost 在自身构造时启动服务并持有 disposer。
  // Risk: Low。
  // Human Review: Required
  //
  // Original code:
  // disposers.push(hookWebDavSyncAppService(host));

  return host;
}

function resolveShortcutInputLayer(appHost: AppHost): ShortcutInputLayer {
  const visibleDialogIds = Object.entries(appHost.internalState.workbench.dialogState)
    .filter(([, dialogState]) => dialogState?.visible === true)
    .map(([dialogId]) => dialogId);
  if (visibleDialogIds.some((dialogId) => dialogId !== "inspector")) {
    return "dialog";
  }
  if (visibleDialogIds.includes("inspector")) {
    return "inspector-dialog";
  }
  if (appHost.overlapEntityMenu.visible) {
    return "overlap-entity-menu";
  }
  if (appHost.internalState.runtime.quickPlace.visible) {
    return "quick-place";
  }

  return "canvas";
}
