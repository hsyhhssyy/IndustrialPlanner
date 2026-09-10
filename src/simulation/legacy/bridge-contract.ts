

import type {
  SimulationAdmissionCounterReset,
  SimulationRuntimeSlotPatch,
} from "@/domain/simulation/types/simulation-types";

import type { CompiledSimulationTopology, SimulationTopologyMigration } from "../contracts";
import type { SimulationRuntimeExport } from "./runtime-export";
import type { SimulationWorkerResponse } from "./worker-protocol";
import type { TimelineWorkerResponse } from "./timeline-worker-protocol";

export interface SimulationWorkerBridge {
  loadTopology(topology: CompiledSimulationTopology, migration?: SimulationTopologyMigration, perfEnabled?: boolean, simulationSpeed?: number, debugDataEnabled?: boolean, powerMode?: "real" | "infinite", powerConsumptionOverride?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "topology-loaded" }
  >>;
  getTickSnapshot(tickNumber: number, simulationSpeed?: number, retainTickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-result" }
  >>;
  getTickSnapshotRange(fromTickNumber: number, toTickNumber: number, generation: number, simulationSpeed?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "tick-snapshot-range-result" }
  >>;
  acknowledgePresentedTick(tickNumber: number, generation: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "presented-tick-acknowledged" }
  >>;
  setDebugEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-enabled-set" }
  >>;
  setDebugDataEnabled(value: boolean): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "debug-data-enabled-set" }
  >>;
  setSimulationSpeed(value: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "simulation-speed-set" }
  >>;
  setPowerMode(powerMode: "real" | "infinite"): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-mode-set" }
  >>;
  setPowerConsumptionOverride(powerConsumptionOverride: number | undefined): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "power-consumption-override-set" }
  >>;
  patchRuntimeSlot(patch: SimulationRuntimeSlotPatch): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-slot-patched" }
  >>;
  resetAdmissionCounter(reset: SimulationAdmissionCounterReset): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "admission-counter-reset" }
  >>;
  getPerfReport(): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "perf-report" }
  >>;
  exportRuntimeState(tickNumber?: number): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-exported" }
  >>;
  importRuntimeState(runtimeExport: SimulationRuntimeExport): Promise<Extract<
    SimulationWorkerResponse,
    { readonly type: "runtime-state-imported" }
  >>;
  dispose(): void;
}

export interface TimelineWorkerBridge {
  loadTimeline(options: {
    runtimeExport: SimulationRuntimeExport;
    startTimelineTickNumber: number;
    retainedFromTimelineTickNumber?: number;
    targetTimelineTickNumber?: number;
    capacityTimelineTicks: number;
    stepStandardTicks: number;
  }): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-loaded" }>>;
  retargetTimeline(options: {
    retainedFromTimelineTickNumber: number;
    targetTimelineTickNumber: number;
  }): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-retargeted" }>>;
  getTimelineStatus(): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-status" }>>;
  getTimelinePresentationFrame(timelineTickNumber: number): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-presentation-frame-result" }>>;
  getTimelinePresentationFrameRange(fromTimelineTickNumber: number, toTimelineTickNumber: number): Promise<Extract<
    TimelineWorkerResponse,
    { readonly type: "timeline-presentation-frame-range-result" }
  >>;
  getTimelineCheckpoint(timelineTickNumber: number): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-checkpoint-result" }>>;
  stopTimeline(): Promise<Extract<TimelineWorkerResponse, { readonly type: "timeline-stopped" }>>;
  dispose(): void;
}
