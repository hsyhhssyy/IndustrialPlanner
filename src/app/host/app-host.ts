import { BlueprintPlannerDialogController } from "../shell";
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
import {
  createUiStateReadWrite,
  isTimelineBottomDockActive,
  isToolboxBottomDockActive,
  UiStateReadWrite,
} from "../state/state-impl";
import { hookThemeApplicator } from "../theme/theme-applicator";
import { WorkbenchBlueprintFolderDialogController } from "../shell/state/blueprint-folder-dialog-state";
import { WorkbenchBlueprintPreviewController } from "../shell/state/blueprint-preview-dialog-state";
import { WorkbenchEncyclopediaPickerController } from "../shell/state/encyclopedia-picker-state";
import { WorkbenchRecipePickerController } from "../shell/state/recipe-picker-state";
import { WorkbenchSaveBlueprintDialogController } from "../shell/state/save-blueprint-dialog-state";
import { cleanupDiscardableV2LocalStorageBeforeV3Boot } from "../migration";
import { WorkbenchOverlapEntityMenuController } from "../shell/state/overlap-entity-menu-state";
import { RegionalSettingsController } from "../regional-settings";
import { DeviceAudioController } from "../audio";
import { regionalSimulationUiState } from "../state/regional-simulation-ui-state";
// AI-REMOVED 2026-09-23:
// Reason: AppHost 构造时正式入口尚未创建 Editor，无法在此注册文档订阅。
// Trigger: 跨基地暗管停用后的配置编辑必须覆盖已保存关系。
// Evidence: main.tsx 先 createAppHost，后 createEditorHost。
// Replacement: RegionalSettingsController.bindInactiveDarkPipeLinkEdits，由 WorkbenchApp 挂载。
// Risk: Low
// Human Review: Required
// Original code:
// import { findDarkPipeSlotLinkForEntity } from "@/shared/dark-pipe-link";
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
  deviceAudio: DeviceAudioController;
  workspace: WorkspaceContract;
  gestureAdapter: GestureAdapter;
  gestureActionRouter: GestureActionRouter<AppHost>;
  gestureDiagnostics: GestureDiagnosticsStore;
  internalState: UiStateReadWrite;
  internalActions: AppInternalAction;
  blueprintFolderDialog: WorkbenchBlueprintFolderDialogController;
  blueprintPlannerDialog: BlueprintPlannerDialogController;
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
  const deviceAudio = new DeviceAudioController(workspace, () => internalState.settings.gamePlayDeviceAudio);
  const regionalSettings = new RegionalSettingsController(workspace.registry);
  const host = {
    workspace,
    internalState,
  } as AppHost;
  const publicSettings = new Proxy(internalState.settings, {
    get(target, property, receiver) {
      if (property === "regionalMultiBaseEnabled") {
        return regionalSimulationUiState.experimentalEnabled
          && regionalSettings.multiBaseEnabled;
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      return property === "regionalMultiBaseEnabled" || Reflect.has(target, property);
    },
    ownKeys(target) {
      return [...Reflect.ownKeys(target), "regionalMultiBaseEnabled"];
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === "regionalMultiBaseEnabled") {
        return {
          configurable: true,
          enumerable: true,
          value: regionalSimulationUiState.experimentalEnabled
            && regionalSettings.multiBaseEnabled,
          writable: false,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  }) as unknown as AppContract["state"]["settings"];
  const publicState: AppContract["state"] = {
    get settings() {
      return publicSettings;
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
  const blueprintPlannerDialog = new BlueprintPlannerDialogController();
  const blueprintPreview = new WorkbenchBlueprintPreviewController();
  const saveBlueprintDialog = new WorkbenchSaveBlueprintDialogController(
    internalState.workbench.dialogState["save-blueprint"],
  );
  const overlapEntityMenu = new WorkbenchOverlapEntityMenuController();
  // AI-REMOVED 2026-09-20:
  // Reason: RegionalSettingsController 必须在 AppSettings 公共投影创建前存在，才能无副本公开多基地选择。
  // Trigger: ST2-RQ-035 要求 AppSettings 成为静态设置 Contract，Simulation 启动时直接读取该 Contract。
  // Evidence: publicSettings 的 regionalMultiBaseEnabled getter 组合实验门控与同步资产选择。
  // Replacement: createAppHost 顶部、internalState 创建后的 regionalSettings 实例。
  // Risk: Low；实例仍由同一个 AppHost 持有并沿用原 hydrate / sync 生命周期。
  // Human Review: Required
  //
  // Original code:
  // const regionalSettings = new RegionalSettingsController(workspace.registry);
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
    blueprintPlannerDialog,
    blueprintPreview,
    saveBlueprintDialog,
    overlapEntityMenu,
    regionalSettings,
    deviceAudio,
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
      deviceAudio.dispose();
      blueprintFolderDialog.close();
      blueprintPlannerDialog.close();
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
  // AI-REMOVED 2026-09-23:
  // Reason: 正式启动顺序中 Editor 尚未赋值，订阅在此不会创建。
  // Trigger: 停用的跨基地链接应在本地链接或端点配置编辑后被覆盖。
  // Evidence: main.tsx 的 createEditorHost 调用晚于 createAppHost。
  // Replacement: RegionalSettingsController.bindInactiveDarkPipeLinkEdits，由 WorkbenchApp 挂载。
  // Risk: 初始化后、工作台挂载前无用户编辑入口。
  // Human Review: Required
  // Original code:
  // const editorDocument = workspace.editor?.document;
  // if (editorDocument !== undefined) {
  //   let previousDocument = editorDocument.getSnapshot();
  //   disposers.push(editorDocument.subscribe((nextDocument) => {
  //     const priorDocument = previousDocument;
  //     previousDocument = nextDocument;
  //     if (
  //       priorDocument.documentKey !== nextDocument.documentKey
  //       || host.state.settings.regionalMultiBaseEnabled
  //     ) return;
  //
  //     for (const link of regionalSettings.darkPipeLinks) {
  //       const endpoint = link.inlet.baseId === nextDocument.baseId
  //         ? link.inlet
  //         : link.outlet.baseId === nextDocument.baseId
  //           ? link.outlet
  //           : null;
  //       if (endpoint === null) continue;
  //       const before = priorDocument.entities[endpoint.entityId];
  //       const after = nextDocument.entities[endpoint.entityId];
  //       if (
  //         before !== undefined
  //         && (
  //           after === undefined
  //           || JSON.stringify(before.config) !== JSON.stringify(after.config)
  //           || findDarkPipeSlotLinkForEntity(nextDocument, endpoint.entityId) !== null
  //         )
  //       ) {
  //         regionalSettings.removeDarkPipeLink(link.id);
  //       }
  //     }
  //   }));
  // }
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
  const toolboxBottomDockActive = isToolboxBottomDockActive(appHost.internalState);
  const timelineBottomDockActive = isTimelineBottomDockActive(appHost.internalState);
  const visibleDialogIds = Object.entries(appHost.internalState.workbench.dialogState)
    .filter(([dialogId, dialogState]) => (
      dialogState?.visible === true
      && !(dialogId === "toolbox" && toolboxBottomDockActive)
      && !(dialogId === "timeline" && timelineBottomDockActive)
    ))
    .map(([dialogId]) => dialogId);
  if (appHost.blueprintPlannerDialog.dialogState.visible || visibleDialogIds.some((dialogId) => dialogId !== "inspector")) {
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
