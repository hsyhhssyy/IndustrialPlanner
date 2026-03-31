import type { CompiledTopology } from "@/domain/topology/compiled-topology";
import type { Stage1Registry } from "@/domain/registry/stage1-registry";
import type { WorldDocument } from "@/domain/document/world-document";

export type SimulationStatus = "idle" | "running" | "paused";

export interface RuntimeEntityView {
  status: "idle" | "running" | "blocked";
  progress: number;
}

export interface RuntimeRenderSnapshot {
  tick: number;
  status: SimulationStatus;
  entityViews: Record<string, RuntimeEntityView>;
}

export interface RuntimeTelemetrySummary {
  tick: number;
  simulatedHertz: number;
  entityCount: number;
}

export interface RuntimeInspectorDetails {
  entityId: string;
  tick: number;
  lines: string[];
}

export interface LoadedSimulationWorld {
  document: WorldDocument;
  topology: CompiledTopology;
  registry: Stage1Registry;
}
