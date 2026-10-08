import { BLUEPRINT_SCHEMA_VERSION } from "@/domain/document/blueprint-document";
import { prepareLocalMigrationRecovery } from "@/shared/storage/local-migration-recovery";
import { createDataMigrationController, installDataMigrationController, isDataMigrationFrozen } from "@/shared/data-migration";
import { prepareBlueprintLibraryMigration } from "@/shared/blueprint-library-migration";
import { prepareEditorDataMigration } from "./editor/data-migration";
import type { EditorHost } from "./editor/editor-host";
import { prepareAppDataMigration } from "./app/data-migration";
import { pauseAppStorageForMigration, refreshAppStorageAfterMigration } from "./app/state/storage-hook";
import { prepareEdaDataMigration, EDA_MIGRATION_VERSION } from "./blueprint-planner/data-migration";
import type { BlueprintPlannerHost } from "./blueprint-planner/blueprint-planner-host";
import { DataMigrationOverlay } from "./app/migration/data-migration-overlay";
import { createMigrationVerification } from "./simulation/migration-verification";

import { createBlueprintPlannerHost } from "./blueprint-planner";
import { createAudioHost } from "./audio";
import React from "react";
import ReactDOM from "react-dom/client";
import { reaction } from "mobx";
import { WorkbenchApp } from "@/app/shell/workbench-app";
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
  const migrationVersion = `local-data-1:${BLUEPRINT_SCHEMA_VERSION}:${EDA_MIGRATION_VERSION}`;
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

  let migrationApp: AppHost | null = null;
  let migrationEditor: EditorHost | null = null;
  let migrationPlanner: BlueprintPlannerHost | null = null;
  let migrationSimulation: ReturnType<typeof createSimulationHost> | null = null;
  let resumeSimulation = false;
  const verification = createMigrationVerification(registry);
  const migration = createDataMigrationController(migrationVersion, [
    {
      prepare: async () => ({ jobs: [] }),
      pause: async () => {
        resumeSimulation = workspace.simulation?.state.runningState === "start";
        workspace.simulation?.actions.pause();
        await migrationPlanner?.pauseForMigration();
        if (migrationEditor !== null) {
          await migrationEditor.internalDocuments.flush();
          await migrationEditor.internalHistory.flush();
        }
        if (migrationApp !== null) await pauseAppStorageForMigration(migrationApp);
      },
      refresh: async () => {
        if (migrationApp !== null) await refreshAppStorageAfterMigration(migrationApp);
        await migrationEditor?.internalDocuments.refreshAfterMigration();
        await migrationEditor?.internalHistory.refreshAfterMigration();
        await migrationPlanner?.reloadAfterMigration();
        if (migrationSimulation?.internalState.hasStarted) {
          const refreshed = await migrationSimulation.internalActions.refreshFromCurrentDocument();
          migrationSimulation.actions.pause();
          if (refreshed.status === "failed") throw new Error(refreshed.error ?? "升级后的仿真状态未能恢复。");
        }
      },
      resume: () => { if (resumeSimulation) workspace.simulation?.actions.resume(); },
    },
    { label: "检查应用设置", prepare: () => prepareAppDataMigration(registry) },
    { label: "检查基地与编辑历史", prepare: () => prepareEditorDataMigration(registry) },
    { label: "检查蓝图库", prepare: prepareBlueprintLibraryMigration },
    { label: "检查计算任务", prepare: () => prepareEdaDataMigration(registry, request => verification.run(request)) },
  ]);
  const disposeMigration = installDataMigrationController(migration);
  const freezeInput = (event: Event) => {
    if (!isDataMigrationFrozen() || event.target instanceof Element && event.target.closest('[aria-labelledby="data-migration-title"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const inputEvents = ["pointerdown", "pointermove", "pointerup", "keydown", "keyup", "wheel", "touchstart", "touchmove", "drop", "click", "submit", "beforeinput", "paste"];
  for (const event of inputEvents) window.addEventListener(event, freezeInput, { capture: true, passive: false });
  if (import.meta.hot) import.meta.hot.dispose(() => {
    disposeMigration(); verification.dispose();
    for (const event of inputEvents) window.removeEventListener(event, freezeInput, true);
  });
  await migration.run();

  const appHost = createAppHost(workspace);
  migrationApp = appHost;
  await appHost.regionalSettings.hydrate();
  if (import.meta.env.DEV) {
    window.__industrialPlannerAppHost = appHost;
  }
  initializeDebugLogging();
  reaction(
    () => appHost.state.settings.debugMode,
    (enabled) => {
      publishDebugModeEnabled(enabled);
      setLogLevel(enabled ? "debug" : DEFAULT_WORKBENCH_LOG_LEVEL, {
        announce: enabled,
      });
    },
    { fireImmediately: true },
  );
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
  migrationEditor = createEditorHost(workspace);
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
  await createRenderHost(workspace);
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

  migrationSimulation = simulationHost;
  migrationPlanner = createBlueprintPlannerHost(workspace);

  await createSyncHost(workspace, {
    assetSources: [
      ...createModuleBalancingSyncSources(appHost),
      appHost.regionalSettings.createSyncSource(),
    ],
  });


  const audioHost = createAudioHost(workspace, {
    readEnabled: () => appHost.internalState.settings.gamePlayDeviceAudio,
  });
  const disposeAudio = () => {
    window.removeEventListener("pagehide", handleAudioPageHide);
    audioHost.destroy();
  };
  const handleAudioPageHide = (event: PageTransitionEvent) => {
    // BFCache 保留工作台；后台暂停与恢复由 Audio 的 visibilitychange 订阅负责。
    if (!event.persisted) disposeAudio();
  };
  window.addEventListener("pagehide", handleAudioPageHide);
  if (import.meta.hot) import.meta.hot.dispose(disposeAudio);

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

  reaction(
    () => JSON.stringify(appHost.internalState.settings.selectedActivityIds),
    () => {
      if (simulationHost.internalState.hasStarted) {
        void simulationHost.internalActions.refreshFromCurrentDocument();
      }
    },
  );

  reactRoot.render(
    <React.StrictMode>
      <WorkbenchApp
        appHost={appHost}
        simulationEngineLaunchPreference={simulationEngineLaunchPreference}
      />
      <DataMigrationOverlay />
    </React.StrictMode>,
  );

}

void startWorkbench().catch((error: unknown) => {
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
