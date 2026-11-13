import { createSceneSessionFactories } from "./editor/scene-session";
import { bindEditorViewToDocument, createDefaultWorldDocumentViewportSettings } from "./editor/document-viewport";
import { resolveEditorSceneSpace, resolveEditorPlacementGeometry } from "./editor/placement-space";
import { isDataMigrationComplete } from "@/shared/storage/data-migration-state";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: notifyDataMigrationAbandoned，不报告虚假的持久化失败
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { reportStorageFailure } from "@/shared/storage/storage-failure";
import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { prepareLocalMigrationRecovery } from "@/shared/storage/local-migration-recovery";
import { createDataMigrationController, installDataMigrationController, isDataMigrationFrozen, notifyDataMigrationAbandoned } from "@/shared/data-migration";
import { prepareBlueprintLibraryMigration } from "@/shared/blueprint-library-migration";
import { prepareEditorDataMigration } from "./editor/data-migration";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: startWorkbench 启动迁移
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import type { EditorHost } from "./editor/editor-host";
import { prepareAppDataMigration } from "./app/data-migration";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: startWorkbench 启动迁移
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { pauseAppStorageForMigration, refreshAppStorageAfterMigration } from "./app/state/storage-hook";
import { prepareEdaDataMigration, EDA_MIGRATION_VERSION } from "./blueprint-planner/data-migration";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: startWorkbench 启动迁移
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import type { BlueprintPlannerHost } from "./blueprint-planner/blueprint-planner-host";
import { DataMigrationOverlay } from "./app/migration/data-migration-overlay";
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: startWorkbench 启动迁移
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
// import { createMigrationVerification } from "./simulation/migration-verification";

import { createBlueprintPlannerHost } from "./blueprint-planner";
import { createAudioHost } from "./audio";
import { createScenePresentation, mountCanvasSceneView, createCanvasRenderDiagnosticSession } from "./app/canvas";
import { createEditableSceneSource } from "./editor/scene-source";
import { createSnapshotStore } from "./shared/snapshot/snapshot-store";
import { createDemandFrameDriver } from "./shared/timing/demand-frame-driver";
import { createPlaybackOwner } from "./shared/timing/playback-owner";
import type { SceneOverlay, SceneViewInput } from "./domain/document/scene-view-input";
import type { SimulationContract } from "./domain/simulation/simulation-contract";
import React from "react";
import ReactDOM from "react-dom/client";
import { reaction } from "mobx";
import { WorkbenchApp } from "@/app/shell/workbench-app";
import { BlueprintEmbed, BlueprintEmbedStatus } from "./app/shell/blueprint-embed";
import { createBlueprintEmbedBridge, applyBlueprintEmbedSettings, createEmbedWorldDocument, loadEmbedBlueprint, parseBlueprintEmbedOptions, resolveEmbedBlueprintBounds } from "./app/embed";
import { createAppHost, type AppHost } from "@/app/host/app-host";
import { createModuleBalancingSyncSources } from "@/app/module-balancing-sync-sources";
// AI-REMOVED 2026-09-20:
// Reason: 组合根不再读取区域多基地设置或维护仿真模式。
// Trigger: ST2-RQ-035 要求 Simulation 在每次启动时从 AppContract 固化会话模式。
// Evidence: Dense / Legacy Host 的 start 已拥有引擎能力与会话生命周期边界。
// Replacement: 双引擎 start 方法读取 workspace.app.state.settings.regionalMultiBaseEnabled。
// Risk: Low；AppSettings 继续由 MobX 驱动静态 UI，运行会话不再被设置热切换。
// Human Review: Required
//
// Original code:
// import { regionalSimulationUiState } from "@/app/state/regional-simulation-ui-state";
import { captureSimulationEngineLaunchPreference } from "@/app/shell/state/simulation-engine-launch-preference";
import { createSyncHost } from "@/sync";
import "@/styles/global.scss";
import { resolveEffectiveActivityIds } from "@/shared/registry/activity-availability";
import { createRegistryContract } from "./registry";
import { WorkspaceContract } from "./domain/document/workspace-contract";
import { createWorkspaceState } from "./domain/document/workspace-state";
import { createEditorHost } from "./editor/editor-host";
import { resolveViewportGridCellPixelSize } from "./editor/viewport-settings";
import { createRenderHost } from "./renderer/renderer-host";
import { createSimulationHost } from "./simulation/simulation-host";
import { initializeDebugLogging } from "@/shared/logging/debug-logging-runtime";
import { publishDebugModeEnabled } from "@/shared/logging/debug-mode-runtime";
import {
  DEFAULT_WORKBENCH_LOG_LEVEL,
  setLogLevel,
} from "@/shared/logging/logger";

declare global {
  interface Window {
    __industrialPlannerAppHost?: AppHost;
  }
}

// 数据安全入口必须先于所有主机初始化和同步任务。
async function startWorkbench(): Promise<void> {
  const migrationVersion = `local-data-2:${BLUEPRINT_SCHEMA_VERSION}:${EDA_MIGRATION_VERSION}:${import.meta.env.VITE_APP_VERSION_CACHE_KEY}`;
  const reactRoot = ReactDOM.createRoot(document.getElementById("root")!);
  reactRoot.render(<DataMigrationOverlay />);
  const disposeStorageGeneration = await prepareLocalMigrationRecovery({
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    migrationVersion,
    buildId: import.meta.url,
    onInvalidated: () => {
      // navigation 使用既有 PWA network-first；同步触发 SW 更新但不等待后台页继续写入。
      void navigator.serviceWorker?.getRegistration().then(async registration => {
        await registration?.update();
        registration?.waiting?.postMessage({ type: "PWA_SKIP_WAITING" });
      }).catch(() => undefined);
      window.location.reload();
    },
    verifyCurrentBuild: async () => {
      const response = await fetch(window.location.href, { cache: "no-store", headers: { "X-IndustrialPlanner-Network-Only": "1" } });
      if (!response.ok) return false;
      const page = new DOMParser().parseFromString(await response.text(), "text/html");
      return Array.from(page.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
        .some(script => new URL(script.getAttribute("src")!, window.location.href).href === import.meta.url);
    },
  });
  if (import.meta.hot) import.meta.hot.dispose(disposeStorageGeneration);

  const registry = createRegistryContract();
  const simulationEngineLaunchPreference = captureSimulationEngineLaunchPreference();

  const workspace : WorkspaceContract = {
    state: createWorkspaceState(),
    registry: registry,
    app: null,
    audio: null,
    editor: null,
    render: null,
    simulation: null,
    sync: null,
    blueprintPlanner: null,
  }

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: createDataMigrationController 只装配 JSON 迁移参与者
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   let migrationApp: AppHost | null = null;
//   let migrationEditor: EditorHost | null = null;
//   let migrationPlanner: BlueprintPlannerHost | null = null;
//   let migrationSimulation: ReturnType<typeof createSimulationHost> | null = null;
//   let resumeSimulation = false;
//   const verification = createMigrationVerification(registry);
//   const migration = createDataMigrationController(migrationVersion, [
//     {
//       prepare: async () => ({ jobs: [] }),
//       pause: async () => {
//         resumeSimulation = workspace.simulation?.state.runningState === "start";
//         workspace.simulation?.actions.pause();
//         await migrationPlanner?.pauseForMigration();
//         if (migrationEditor !== null) {
//           await migrationEditor.internalDocuments.flush();
//           await migrationEditor.internalHistory.flush();
//         }
//         if (migrationApp !== null) await pauseAppStorageForMigration(migrationApp);
//       },
//       refresh: async () => {
//         if (migrationApp !== null) await refreshAppStorageAfterMigration(migrationApp);
//         await migrationEditor?.internalDocuments.refreshAfterMigration();
//         await migrationEditor?.internalHistory.refreshAfterMigration();
//         await migrationPlanner?.reloadAfterMigration();
//         if (migrationSimulation?.internalState.hasStarted) {
//           const refreshed = await migrationSimulation.internalActions.refreshFromCurrentDocument();
//           migrationSimulation.actions.pause();
//           if (refreshed.status === "failed") throw new Error(refreshed.error ?? "升级后的仿真状态未能恢复。");
//         }
//       },
//       resume: () => { if (resumeSimulation) workspace.simulation?.actions.resume(); },
//     },
  const migration = createDataMigrationController(migrationVersion, [
    { label: "检查应用设置", prepare: version => prepareAppDataMigration(registry, version) },
    { label: "检查基地与编辑历史", prepare: version => prepareEditorDataMigration(registry, version) },
    { label: "检查蓝图库", prepare: prepareBlueprintLibraryMigration },
    { label: "检查计算任务", prepare: prepareEdaDataMigration },
  ]);
  const disposeMigration = installDataMigrationController(migration);
  const freezeInput = (event: Event) => {
    if (!isDataMigrationFrozen() || event.target instanceof Element && event.target.closest('[aria-labelledby="data-migration-title"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const inputEvents = ["pointerdown", "pointermove", "pointerup", "keydown", "keyup", "wheel", "touchstart", "touchmove", "drop", "click", "submit", "beforeinput", "paste"];
  for (const event of inputEvents) window.addEventListener(event, freezeInput, { capture: true, passive: false });
  if (import.meta.hot) import.meta.hot.dispose(() => {
    disposeMigration();
    for (const event of inputEvents) window.removeEventListener(event, freezeInput, true);
  });
  await migration.run();

  const sceneFactories = createSceneSessionFactories(registry);
  const mainView = sceneFactories.createView({ id: "workbench-main",
    initialViewport: createDefaultWorldDocumentViewportSettings(),
    bounds: { kind: "space", bounds: { minX: null, minY: null, maxX: null, maxY: null }, padding: 2 },
    getOperationAvailability: (operation) => workspace.editor?.queries.getOperationAvailability(operation)
      ?? { supported: true, enabled: true, reason: null },
  });
  let viewPersistence: ReturnType<typeof bindEditorViewToDocument> | null = null;
  const mainSceneReleases: (() => void)[] = [];
  const mainSceneAbort = new AbortController();
  let mainSceneDisposed = false;
  const retainMainScene = (release: () => void): void => {
    if (mainSceneDisposed) release(); else mainSceneReleases.push(release);
  };
  const disposeMainScene = (): void => {
    if (mainSceneDisposed) return;
    mainSceneDisposed = true;
    mainSceneAbort.abort();
    try { reactRoot.unmount(); } catch (error) { console.error("Workbench UI cleanup failed", error); }
    for (const release of mainSceneReleases.splice(0).reverse()) {
      try { release(); } catch (error) { console.error("Workbench scene cleanup failed", error); }
    }
    window.removeEventListener("pagehide", onMainScenePageHide);
  };
  const onMainScenePageHide = (event: PageTransitionEvent): void => { if (!event.persisted) disposeMainScene(); };
  window.addEventListener("pagehide", onMainScenePageHide);
  if (import.meta.hot) import.meta.hot.dispose(disposeMainScene);
  retainMainScene(() => mainView.dispose());
  let appHost: AppHost;
  try {
  appHost = createAppHost(workspace, { sceneFactories, mainView });
  retainMainScene(() => appHost.dispose());
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: None
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   migrationApp = appHost;
  await appHost.regionalSettings.hydrate();
  mainSceneAbort.signal.throwIfAborted();
  if (import.meta.env.DEV) {
    window.__industrialPlannerAppHost = appHost;
  }
  initializeDebugLogging();
  retainMainScene(reaction(
    () => appHost.state.settings.debugMode,
    (enabled) => {
      publishDebugModeEnabled(enabled);
      setLogLevel(enabled ? "debug" : DEFAULT_WORKBENCH_LOG_LEVEL, {
        announce: enabled,
      });
    },
    { fireImmediately: true },
  ));
  // AI-REMOVED 2026-09-25:
  // Reason: 旧 App 清理订阅已归档，不再需要组合根的 Editor 局部引用。
  // Trigger: M01 接入后的 ESLint unused-vars 错误。
  // Evidence: Editor 初始化仍通过 workspace 发布契约，下方没有活动引用。
  // Replacement: 下方 createEditorHost(workspace) 初始化调用。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // const editorHost = createEditorHost(workspace);
  // AI-CORRECTION 2026-10-08: 组合根保留具体 Host 供全局迁移结算与刷新，不增加 Domain 属性。
  // AI-CORRECTION 2026-10-09: 启动迁移先于 Host；不再保留运行期刷新引用。
  const editorHost = createEditorHost(workspace, {
    beforeDocumentChange: () => viewPersistence?.flush(),
    captureOperationGuard: () => {
      const selection = appHost.mainCanvas.state.toolInfo.darkPipeLink;
      return () => selection === null || appHost.mainCanvas.state.toolInfo.darkPipeLink === selection;
    },
  });
  workspace.editor = editorHost;
  retainMainScene(() => editorHost.dispose());
  viewPersistence = bindEditorViewToDocument({ document: editorHost.document,
    documentWriter: editorHost.internalDocumentWriter, view: mainView,
    readSpace: () => resolveEditorSceneSpace(editorHost.services, editorHost.document.getSnapshot()),
  });
  retainMainScene(() => viewPersistence?.dispose());
  // AI-REMOVED 2026-11-12:
  // Reason: 清理边界必须先于任何异步主机初始化建立。
  // Trigger: REQ-048 A5 初始化失败与中途关闭。
  // Evidence: 原 disposer 在 hydrate 后注册，且未包含 App、Simulation 和 Planner。
  // Replacement: 上方统一 releases 与 retainMainScene。
  // Risk: 初始化和重复销毁需浏览器回归。
  // Human Review: Required
  // Original code:
  // const disposeMainScene = () => {
  // mainSceneAbort.abort();
  // for (const release of mainSceneReleases.splice(0).reverse()) {
  // try { release(); } catch (error) { console.error("Workbench scene cleanup failed", error); }
  // }
  // viewPersistence?.dispose();
  // mainView.dispose();
  // editorHost.dispose();
  // window.removeEventListener("pagehide", onMainScenePageHide);
  // };
  // const onMainScenePageHide = (event: PageTransitionEvent) => { if (!event.persisted) disposeMainScene(); };
  // window.addEventListener("pagehide", onMainScenePageHide);
  // if (import.meta.hot) import.meta.hot.dispose(disposeMainScene);
  // AI-REMOVED 2026-09-25:
  // Reason: Editor 区域文档负责关系生命周期，App 资产仅保留旧记录迁移入口。
  // Trigger: REQ-038 出口文档权威。
  // Evidence: D01～D11 契约及 Editor 文档集合已接入。
  // Replacement: src/editor/editor-host.ts 区域关系维护及旧资产迁移。
  // Risk: 旧关系迁移、后台删除与仿真启动须回归。
  // Human Review: Required
  // Original code:
  // editorHost.document.subscribe((document) => {
  //   appHost.regionalSettings.pruneDarkPipeLinksForBase(
  //     document.baseId,
  //     new Set(Object.keys(document.entities)),
  //   );
  // });
// AI-REMOVED 2026-10-08:
// Reason: 收敛全局迁移入口，避免重复调度及旧缓存覆盖。
// Trigger: REQ-041 用户授权统一迁移。
// Evidence: 启动、导入和保存调用链审查。
// Replacement: main.tsx 全部 Host 创建后的同步装配
// Risk: 需回归迁移失败与恢复。
// Human Review: Required
// Original code:
//   await createSyncHost(workspace, {
//     assetSources: [
//       ...createModuleBalancingSyncSources(appHost),
//       appHost.regionalSettings.createSyncSource(),
//     ],
//   });
  const renderHost = createRenderHost();
  workspace.render = renderHost;
  retainMainScene(() => renderHost.destroy());
  const simulationHost = createSimulationHost(workspace, {
    engineKind: simulationEngineLaunchPreference.activeDenseEnabled ? "dense-v2" : "legacy",
    getPerfEnabled: () => appHost.internalState.settings.debugMode,
    getDebugDataEnabled: () => appHost.internalState.settings.debugMode
      && appHost.internalState.settings.debugSimulationWorkerDetailedReport,
    getActiveActivityIds: () => resolveEffectiveActivityIds({
      selectedActivityIds: appHost.internalState.settings.selectedActivityIds,
    }),
    getRegionalResourceSettings: (regionTag) =>
      appHost.regionalSettings.getRegionResources(regionTag),
  // AI-REMOVED 2026-09-25:
  // Reason: Dense 改为从世界文档解析跨基地关系，移除 App getter 装配。
  // Trigger: REQ-038 出口文档权威。
  // Evidence: D01～D11 契约及 Editor 文档集合已接入。
  // Replacement: src/simulation/dense/dense-regional-document.ts。
  // Risk: 旧关系迁移、后台删除与仿真启动须回归。
  // Human Review: Required
  // Original code:
  //   getRegionalDarkPipeLinks: (regionTag) =>
  //     appHost.regionalSettings.getRegionalDarkPipeLinks(regionTag),
  });

// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: None
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//   migrationSimulation = simulationHost;
  retainMainScene(() => simulationHost.dispose());
  const plannerHost = createBlueprintPlannerHost(workspace);
  retainMainScene(() => plannerHost.dispose());

  const mainSource = createEditableSceneSource("workbench", editorHost);
  retainMainScene(mainSource.dispose);
  const mainPresentation = createScenePresentation({ app: appHost, showBaseBoundary: true,
    readTools: () => ({ activeTool: appHost.mainCanvas.state.activeTool, moveKind: appHost.mainCanvas.state.moveKind, toolInfo: appHost.mainCanvas.state.toolInfo }) });
  retainMainScene(mainPresentation.dispose);
  const mainInput: SceneViewInput = { id: mainView.id, source: mainSource.source, camera: mainView,
    presentation: mainPresentation.snapshot, simulation: simulationHost, overlay: createSnapshotStore<SceneOverlay | null>(null) };
  const mainRenderView = await mountCanvasSceneView({ renderer: renderHost, input: mainInput,
    time: { kind: "advancing", clockId: "workbench-visual", initialTimeMs: 0 }, signal: mainSceneAbort.signal });
  appHost.mainCanvas.renderBinding = mainRenderView;
  retainMainScene(mainRenderView.dispose);
  const mainDiagnostics = createCanvasRenderDiagnosticSession({ input: mainInput, simulation: simulationHost });
  retainMainScene(mainDiagnostics.destroy);
  retainMainScene(bindSimulationPlayback(simulationHost, "workbench-playback"));

  if (await isDataMigrationComplete(migrationVersion)) {
    mainSceneAbort.signal.throwIfAborted();
    const syncHost = await createSyncHost(workspace, {
    assetSources: [
      ...createModuleBalancingSyncSources(appHost),
      appHost.regionalSettings.createSyncSource(),
    ],
    });
    retainMainScene(() => syncHost.dispose());
    mainSceneAbort.signal.throwIfAborted();
  } else {
// AI-REMOVED 2026-10-09:
// Reason: 迁移只在页面启动执行，运行期通过刷新重建工作台。
// Trigger: 用户要求迁移仅做 JSON 转换，移除仿真验收与运行态恢复。
// Evidence: REQ-041 启动、输入采纳与任务恢复调用链。
// Replacement: notifyDataMigrationAbandoned
// Risk: 运行中接收旧数据将刷新页面，仿真保持停止。
// Human Review: Required
// Original code:
//     reportStorageFailure("data-migration", new Error("部分本地数据暂时无法升级，原件已保留。为保护远端数据，网络同步已暂停；更新版本后会重新尝试。"));
    notifyDataMigrationAbandoned();
  }


  mainSceneAbort.signal.throwIfAborted();
  const audioHost = createAudioHost(workspace, {
    readEnabled: () => appHost.internalState.settings.gamePlayDeviceAudio,
    readViewport: () => mainView.state,
  });
  // AI-REMOVED 2026-11-12:
  // Reason: Audio 随组合根清理，初始化失败也必须释放。
  // Trigger: REQ-048 A5。
  // Evidence: 独立 pagehide/HMR 监听不覆盖后续初始化抛错。
  // Replacement: retainMainScene(audioHost.destroy)
  // Risk: 保留 BFCache 不销毁语义。
  // Human Review: Required
  // Original code:
  // const disposeAudio = () => {
  // window.removeEventListener("pagehide", handleAudioPageHide);
  // audioHost.destroy();
  // };
  // const handleAudioPageHide = (event: PageTransitionEvent) => {
  // // BFCache 保留工作台；后台暂停与恢复由 Audio 的 visibilitychange 订阅负责。
  // if (!event.persisted) disposeAudio();
  // };
  // window.addEventListener("pagehide", handleAudioPageHide);
  // if (import.meta.hot) import.meta.hot.dispose(disposeAudio);
  //
  retainMainScene(() => audioHost.destroy());

  // AI-REMOVED 2026-09-20:
  // Reason: 多基地是下一次仿真会话的启动设置，不应由组合根持续同步为 SimulationMode。
  // Trigger: ST2-RQ-035 要求 main 只装配模块，Simulation 启动时读取 AppSettings 并固化模式。
  // Evidence: 原 reaction 混合持久化选择、实验门控和运行状态，导致静态设置与会话事实双向泄漏。
  // Replacement: DenseSimulationController.start 与 SimulationActionImpl.start。
  // Risk: Medium；所有静态 UI 必须改读 AppSettings，双引擎启动测试必须覆盖固化边界。
  // Human Review: Required
  //
  // Original code:
  // reaction(
  //   () => [
  //     appHost.regionalSettings.multiBaseEnabled,
  //     regionalSimulationUiState.experimentalEnabled,
  //     simulationHost.internalState.runningState,
  //   ] as const,
  //   ([persistedEnabled, experimentalEnabled, runningState]) => {
  //     if (runningState !== "stop") {
  //       return;
  //     }
  //     simulationHost.actions.setRegionalMultiBaseEnabled(
  //       persistedEnabled && experimentalEnabled,
  //     );
  //   },
  //   { fireImmediately: true },
  // );

  retainMainScene(reaction(
    () => JSON.stringify(appHost.internalState.settings.selectedActivityIds),
    () => {
      if (simulationHost.internalState.hasStarted) {
        void simulationHost.internalActions.refreshFromCurrentDocument();
      }
    },
  ));

  reactRoot.render(
    <React.StrictMode>
      <WorkbenchApp
        appHost={appHost}
        simulationEngineLaunchPreference={simulationEngineLaunchPreference}
      />
      <DataMigrationOverlay />
    </React.StrictMode>,
  );
  } catch (error) {
    disposeMainScene();
    throw error;
  }
}

async function startBlueprintEmbed(): Promise<void> {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  const abort = new AbortController();
  const bridge = createBlueprintEmbedBridge();
  const releases: Array<() => void> = [];
  let disposed = false;
  let loading = true;
  let simulation: ReturnType<typeof createSimulationHost> | null = null;
  const timeout = setTimeout(() => abort.abort(new Error("蓝图加载超时，请重试。")), 30_000);
  const releaseHosts = () => {
    while (releases.length) {
      try { releases.pop()?.(); }
      catch (error) { console.error("Blueprint embed cleanup failed", error); }
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    abort.abort();
    bridge.dispose();
    window.removeEventListener("pagehide", pageHide);
    root.unmount();
    releaseHosts();
  };
  const pageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) dispose();
    else simulation?.actions.pause();
  };
  window.addEventListener("pagehide", pageHide);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  root.render(<BlueprintEmbedStatus blank />);
  try {
    const options = parseBlueprintEmbedOptions(window.location.href);
    const blueprint = await loadEmbedBlueprint(options.blueprintUrl, abort.signal);
    clearTimeout(timeout);
    abort.signal.throwIfAborted();
    const registry = createRegistryContract();
    const workspace: WorkspaceContract = {
      state: createWorkspaceState(), registry,
      app: null, editor: null, render: null, simulation: null,
      audio: null, sync: null, blueprintPlanner: null,
    };
    const initialDocument = createEmbedWorldDocument(blueprint, registry, {
      width: window.innerWidth, height: window.innerHeight, gridCellPixelSize: resolveViewportGridCellPixelSize(1),
    });
    const sceneFactories = createSceneSessionFactories(registry);
    const embedView = sceneFactories.createView({ id: "embed-main",
      initialViewport: initialDocument.documentSettings.viewport ?? createDefaultWorldDocumentViewportSettings(),
      bounds: { kind: "content", content: resolveEmbedBlueprintBounds(blueprint, registry), padding: 3, maxAutoZoom: 2 },
      getOperationAvailability: () => ({ supported: true, enabled: true, reason: null }),
    });
    releases.push(() => embedView.dispose());
    const app = createAppHost(workspace, { mode: "embed", mainView: embedView, sceneFactories });
    releases.push(() => app.dispose());
    applyBlueprintEmbedSettings(app, options);
    const editor = createEditorHost(workspace, {
      persistence: "memory", initialDocument,
      policy: {
        getOperationAvailability: operation => ({ supported: operation === "pan-viewport" || operation === "zoom-viewport",
          enabled: operation === "pan-viewport" || operation === "zoom-viewport", reason: null }),
        resolvePlacementAreaIds: entity => resolveEditorPlacementGeometry(workspace, initialDocument, entity).allowedAreaIds,
        validateTransition: () => ["嵌入蓝图为只读会话。"],
      },
      // AI-REMOVED 2026-11-12: Reason: 取景策略属于 View；Trigger: REQ-048 D4；Evidence: 独立 embedView；Replacement: 上方 content bounds；Risk: Low；Human Review: Required
      // viewportBounds: { content: resolveEmbedBlueprintBounds(blueprint, registry), padding: 3, maxAutoZoom: 2 },
      // AI-REMOVED 2026-11-12: Reason: 无界是空间而非校验旁路；Trigger: REQ-048；Evidence: 旧值跳过资格校验；Replacement: space；Risk: Low；Human Review: Required
      // placementBounds: options.showBase ? "base" : "unbounded",
      space: options.showBase ? undefined : { areas: [{ id: initialDocument.baseId,
        bounds: { minX: null, maxX: null, minY: null, maxY: null },
        outerRing: { top: 0, right: 0, bottom: 0, left: 0 } }] },
    });
    workspace.editor = editor;
    releases.push(() => editor.dispose());
    await editor.internalDocuments.ready();
    abort.signal.throwIfAborted();
    embedView.actions.setViewportClientRect({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    // AI-REMOVED 2026-10-12:
    // Reason: 预热期间不能创建会按渲染帧推进仿真的 Renderer。
    // Trigger: 用户要求按秒预热，完成前画面保持空白。
    // Evidence: RenderHost 的 scheduler 每帧调用 advancePlaybackByDeltaMs。
    // Replacement: 下方预热完成后创建 RenderHost。
    // Risk: Low；销毁顺序随创建顺序调整，Renderer 先于 Simulation 回收。
    // Human Review: Required
    // Original code:
    // const render = await createRenderHost(workspace, { showBaseBoundary: options.showBase });
    // if (disposed) { render.destroy(); return; }
    // releases.push(() => render.destroy());
    simulation = createSimulationHost(workspace, {
      engineKind: "dense-v2",
      initialDenseTickRate: options.warmupSeconds > 0 ? 2 : 4,
      getRegionalResourceSettings: region => app.regionalSettings.getRegionResources(region),
      getActiveActivityIds: () => resolveEffectiveActivityIds({ selectedActivityIds: [] }),
    });
    const simulationHost = simulation;
    releases.push(() => simulationHost.dispose());
    if (options.warmupSeconds > 0) {
      await simulation.actions.start();
      abort.signal.throwIfAborted();
      simulation.actions.pause();
      const rate = simulation.queries.getDocumentRuntimeStatus()?.standardTickRate;
      const warmupTicks = Math.ceil(options.warmupSeconds * (rate ?? NaN));
      if (!Number.isSafeInteger(warmupTicks) || warmupTicks <= 0) {
        throw Object.assign(new Error("预热秒数无法换算为有效的 dense tick 数。"), { code: "INVALID_PARAMETER" });
      }
      // 复用当前 Dense 会话，只发布目标 tick；暂停态避免额外的播放时间进入预热。
      const result = await simulation.internalActions.syncToTick(warmupTicks);
      abort.signal.throwIfAborted();
      if (result.status !== "ready" || simulation.queries.getDocumentRuntimeStatus()?.tickNumber !== warmupTicks) {
        throw Object.assign(new Error("蓝图预热未能完成。"), { code: "SIMULATION_FAILED" });
      }
    }
    const render = createRenderHost();
    workspace.render = render;
    if (disposed) { render.destroy(); return; }
    releases.push(() => render.destroy());
    const source = sceneFactories.createReadonlySource({ id: "embed", document: editor.document.getSnapshot(),
      space: resolveEditorSceneSpace(editor.services, editor.document.getSnapshot()) });
    releases.push(source.dispose);
    const presentation = createScenePresentation({ app, showBaseBoundary: options.showBase,
      readTools: () => ({ activeTool: "select", moveKind: null, toolInfo: { marqueeType: "marquee", darkPipeLink: null } }) });
    releases.push(presentation.dispose);
    const renderView = await mountCanvasSceneView({ renderer: render,
      input: { id: embedView.id, source: source.source, camera: embedView, presentation: presentation.snapshot,
        simulation, overlay: createSnapshotStore<SceneOverlay | null>(null) },
      time: { kind: "advancing", clockId: "embed-visual", initialTimeMs: 0 }, signal: abort.signal });
    app.mainCanvas.renderBinding = renderView;
    releases.push(renderView.dispose);
    releases.push(bindSimulationPlayback(simulation, "embed-playback"));
    // 被动跟随已存在 SW 的版本切换，不注册、激活或更新 SW。
    try {
      const worker = navigator.serviceWorker;
      const reload = () => window.location.reload();
      worker?.addEventListener("controllerchange", reload);
      releases.push(() => worker?.removeEventListener("controllerchange", reload));
    } catch { /* 当前 iframe 禁用 Service Worker 时继续在线运行。 */ }
    const onReady = () => {
      if (disposed || !loading) return;
      loading = false;
      bridge.attach(app);
      if (options.autoplay) void bridge.play().catch(error => bridge.reportError(error));
    };
    root.render(<BlueprintEmbed appHost={app} onReady={onReady} />);
  } catch (error) {
    clearTimeout(timeout);
    releaseHosts();
    if (disposed) return;
    const failure = abort.signal.aborted && abort.signal.reason instanceof Error ? abort.signal.reason : error;
    bridge.reportError(failure);
    root.render(<BlueprintEmbedStatus error={failure instanceof Error ? failure.message : "蓝图加载失败。"} />);
  }
}

/** 播放 owner 与 Surface 数量和可见性无关；只有播放状态要求连续调度。 */
function bindSimulationPlayback(simulation: SimulationContract, clockId: string): () => void {
  const owner = createPlaybackOwner({ clockId, isPlaying: () => simulation.state.runningState === "start",
    advance: (deltaMs) => simulation.actions.advancePlaybackByDeltaMs(deltaMs) });
  const driver = createDemandFrameDriver({
    request: (callback) => requestAnimationFrame(callback), cancel: (id) => cancelAnimationFrame(id),
    needsFrame: () => simulation.state.runningState === "start",
    onFrame: (timeMs) => owner.update({ clockId, timeMs }),
  });
  const stop = reaction(() => simulation.state.runningState, () => { owner.resetBaseline(); driver.wake(); });
  const visibility = (): void => { owner.resetBaseline(); driver.wake(); };
  document.addEventListener("visibilitychange", visibility);
  driver.wake();
  return () => { driver.dispose(); stop(); owner.dispose(); document.removeEventListener("visibilitychange", visibility); };
}

// URL 分流早于工作台的数据恢复；两种模式共享同一份 Host 实现和静态资源。
void (new URLSearchParams(window.location.search).has("embed")
  ? startBlueprintEmbed() : startWorkbench()).catch((error: unknown) => {
  const root = document.getElementById("root");
  if (root !== null && !isDataMigrationFrozen()) {
    const message = document.createElement("p");
    message.textContent = error instanceof Error ? error.message : "无法安全读取本地数据，已停止写入。";
    const retry = document.createElement("button");
    retry.textContent = "重新加载";
    retry.onclick = () => window.location.reload();
    root.replaceChildren(message, retry);
  }
  window.addEventListener("online", () => window.location.reload(), { once: true });
  // AI-REMOVED 2026-09-28:
  // Reason: 启动失败已展示恢复入口，不再制造未处理的顶层拒绝。
  // Trigger: 补齐存储异常处理。
  // Evidence: 原 catch 只覆盖恢复门禁，主机读取失败会遗漏。
  // Replacement: startWorkbench 的统一 catch。
  // Risk: Low
  // Human Review: Required
  // Original code:
  // throw error;
  console.error("Workbench startup failed; stored data was retained.", error);
});
