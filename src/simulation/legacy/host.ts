import { createLegacySimulationState } from "./state";
import { createSimulationQueries } from "@/simulation/projection";
import { registerSimulationSnapshotReader } from "../testkit";
import { createSimulationWorkerBridge } from "./worker-bridge";
import { createTimelineWorkerBridge } from "./timeline-bridge";
import type { SimulationHost, CreateSimulationHostOptions } from "@/simulation/contracts";
import { reaction } from "mobx";
import type { SimulationContract } from "@/domain/simulation/simulation-contract";
import type { WorkspaceContract } from "@/domain/document/workspace-contract";

import {
  createSnapshotStore,
  type SnapshotStoreReadWrite,
} from "@/shared/snapshot/snapshot-store";

import { SimulationActionImpl } from "./controller";
import { type SimulationInternalAction } from "../contracts";

import type { CompiledSimulationTopology } from "../contracts";

import { LegacySnapshotPresentationProjection } from "./snapshot-projection";

export function createLegacySimulationHost(
  workspace: WorkspaceContract,
  options: CreateSimulationHostOptions = {},
): SimulationHost {
  const bridge = createSimulationWorkerBridge(options.workerMode ?? "auto", workspace.registry);
  const disposers: Array<() => void> = [];
  const topologyStore: SnapshotStoreReadWrite<CompiledSimulationTopology | null> = createSnapshotStore<CompiledSimulationTopology | null>(null);
  const { state: internalState, presentation: legacyPresentation } = createLegacySimulationState();
  const presentation = new LegacySnapshotPresentationProjection(
    () => legacyPresentation.currentSnapshot,
  );
  const actionImpl = new SimulationActionImpl({
    workspace,
    state: internalState,
    presentation: legacyPresentation,
    topology: topologyStore,
    bridge,
    createTimelineBridge: () => createTimelineWorkerBridge(options.workerMode ?? "auto", workspace.registry),
    getPerfEnabled: options.getPerfEnabled,
    getDebugDataEnabled: options.getDebugDataEnabled,
    getActiveActivityIds: options.getActiveActivityIds,
    getRegionalResourceSettings: options.getRegionalResourceSettings,
    regionalWorkerMode: options.workerMode ?? "auto",
  });
  const actions: SimulationContract["actions"] = actionImpl;
  const internalActions: SimulationInternalAction = actionImpl;
  let currentTickDebugRefreshInFlight = false;

  if (options.getPerfEnabled !== undefined) {
    disposers.push(reaction(
      options.getPerfEnabled,
      (debugEnabled) => internalActions.setDebugEnabled(debugEnabled),
    ));
  }

  if (options.getDebugDataEnabled !== undefined) {
    disposers.push(reaction(
      options.getDebugDataEnabled,
      (debugDataEnabled) => internalActions.setDebugDataEnabled(debugDataEnabled),
    ));
  }

  const requestPausedCurrentTickDebugRefresh = (): void => {
    const currentTickNumber = presentation.tickNumber;
    if (
      options.getDebugDataEnabled?.() !== true
      || internalState.runningState !== "pause"
      || internalState.regionalTotalPowerDemand !== null
      || currentTickNumber === null
      || presentation.debugData !== undefined
      || currentTickDebugRefreshInFlight
    ) {
      return;
    }

    currentTickDebugRefreshInFlight = true;
    void internalActions.syncToTick(currentTickNumber)
      .catch((error: unknown) => {
        console.error("[SimHost] Failed to refresh current tick debug data.", error);
      })
      .finally(() => {
        currentTickDebugRefreshInFlight = false;
      });
  };

  // 监听 documentSettings.powerMode 变化，自动同步到 worker。
  // editor.document 在 createSimulationHost 调用时已可用（main.tsx 中先创建 editor 再创建 simulation）。
  const editorDocument = workspace.editor?.document;
  if (editorDocument !== undefined) {
    let previousPowerMode = editorDocument.getSnapshot().documentSettings.powerMode ?? "infinite";
    let previousPowerConsumptionOverride: number | undefined =
      editorDocument.getSnapshot().documentSettings.powerConsumptionOverride;
    const unsubscribe = editorDocument.subscribe((doc) => {
      const currentPowerMode = doc.documentSettings.powerMode ?? "infinite";
      if (currentPowerMode !== previousPowerMode) {
        previousPowerMode = currentPowerMode;
        void bridge.setPowerMode(currentPowerMode).catch(() => undefined);
      }
      const currentOverride = doc.documentSettings.powerConsumptionOverride;
      if (currentOverride !== previousPowerConsumptionOverride) {
        previousPowerConsumptionOverride = currentOverride;
        void bridge.setPowerConsumptionOverride(
          typeof currentOverride === "number" && Number.isFinite(currentOverride) && currentOverride >= 0
            ? currentOverride
            : undefined,
        ).catch(() => undefined);
      }
    });
    disposers.push(unsubscribe);
  }

  const host: SimulationHost = {
    engineKind: "legacy",
    workspace,
    internalState,
    internalActions,
    get state() {
      return internalState;
    },
    topology: topologyStore,
    queries: createSimulationQueries({
      state: internalState,
      getTopology: () => topologyStore.getSnapshot(),
      getPresentation: () => presentation,
      getTotalPowerDemand: (topology) => {
        const override = workspace.editor?.document?.getSnapshot().documentSettings.powerConsumptionOverride;
        return internalState.regionalTotalPowerDemand
          ?? (typeof override === "number" && Number.isFinite(override) && override >= 0 ? override : topology.totalPowerDemand);
      },
      getWarehouseStats: () => presentation.getWarehouseStats(),
      getPerformanceDiagnostics: () => actionImpl.getPerformanceDiagnostics(),
      getDebugDataEnabled: () => options.getDebugDataEnabled?.() === true,
      beforeReadDebugData: requestPausedCurrentTickDebugRefresh,
    }),
    actions,
    dispose: () => {
      while (disposers.length > 0) {
        disposers.pop()?.();
      }
      internalActions.reset();
      bridge.dispose();
    },
  };

  disposers.push(registerSimulationSnapshotReader(host, () => legacyPresentation.currentSnapshot));
  workspace.simulation = host;

  const document = workspace.editor?.document;
  if (document !== undefined) {
    disposers.push(document.subscribe(() => {
      if (internalState.hasStarted) {
        void internalActions.refreshFromCurrentDocument();
      }
    }));
  }

  return host;
}
