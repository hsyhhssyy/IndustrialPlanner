import type { SimulationRuntimeSlotPatch } from "@/domain/simulation/types/simulation-types";
import type {
  CompiledSimulationTopology,
  RuntimeDeviceSnapshot,
  RuntimeDiagnosticSnapshot,
  RuntimeSlotSnapshot,
  RuntimeTransferSnapshot,
} from "./types";

/** Simulation 内部的独立执行边界，不暴露给规划模块。 */
export interface BlueprintExecutionEngine {
  readonly tickNumber: number;
  readonly isPowerOutage: boolean;
  advance(): void;
  visitTransfers(visit: (transfer: RuntimeTransferSnapshot) => void): void;
  readSlots(): readonly RuntimeSlotSnapshot[];
  readDevices(): readonly RuntimeDeviceSnapshot[];
  readDiagnostics(): readonly RuntimeDiagnosticSnapshot[];
  dispose(): void;
}

export interface BlueprintExecutionEngineOptions {
  readonly topology: CompiledSimulationTopology;
  readonly powerMode: "real" | "infinite";
  readonly initialSlots: readonly SimulationRuntimeSlotPatch[];
}
