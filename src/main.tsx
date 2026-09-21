import { createBlueprintPlannerHost } from "./blueprint-planner";
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

const registry = createRegistryContract();
const simulationEngineLaunchPreference = captureSimulationEngineLaunchPreference();

const workspace : WorkspaceContract = {
  state: createWorkspaceState(),
  registry: registry,
  app: null,
  editor: null,
  render: null,
  simulation: null,
  sync: null,
  blueprintPlanner: null,
}

const appHost = createAppHost(workspace);
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
const editorHost = createEditorHost(workspace);
editorHost.document.subscribe((document) => {
  appHost.regionalSettings.pruneDarkPipeLinksForBase(
    document.baseId,
    new Set(Object.keys(document.entities)),
  );
});
await createSyncHost(workspace, {
  assetSources: [
    ...createModuleBalancingSyncSources(appHost),
    appHost.regionalSettings.createSyncSource(),
  ],
});
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
  getRegionalDarkPipeLinks: (regionTag) =>
    appHost.regionalSettings.getRegionalDarkPipeLinks(regionTag),
});

createBlueprintPlannerHost(workspace);

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkbenchApp
      appHost={appHost}
      simulationEngineLaunchPreference={simulationEngineLaunchPreference}
    />
  </React.StrictMode>,
);
