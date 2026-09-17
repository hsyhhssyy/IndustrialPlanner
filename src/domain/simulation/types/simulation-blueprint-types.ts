import type { BlueprintDocument } from "../../document/blueprint-document";
import type { WorldEntity, SlotLinkDefinition, WorldDocumentSettings } from "../../document/world-document";
import type { SimulationRuntimeSlotPatch, SimulationDeviceOperatingStatus, SimulationEngineKind } from "./simulation-types";

export interface SimulationBlueprintScene {
  readonly externalEntities: readonly WorldEntity[];
  readonly externalSlotLinks: readonly SlotLinkDefinition[];
  readonly initialSlots: readonly SimulationRuntimeSlotPatch[];
  readonly powerMode: WorldDocumentSettings["powerMode"];
}

export interface SimulationBlueprintProbe {
  readonly id: string;
  readonly entityIds: readonly string[];
  readonly itemId: string;
  readonly direction: "input" | "output";
}

export interface SimulationBlueprintRunRequest {
  readonly blueprint: BlueprintDocument;
  readonly scene: SimulationBlueprintScene;
  readonly probes: readonly SimulationBlueprintProbe[];
  readonly warmupSeconds: number;
  readonly observationSeconds: number;
  readonly inventorySampleCount: number;
  readonly maxWallTimeMs: number;
  readonly activeActivityIds: readonly string[];
}

export interface SimulationBlueprintDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly entityId?: string;
}

export interface SimulationBlueprintProbeResult {
  readonly id: string;
  readonly amount: number;
  readonly perMinute: number;
}

export interface SimulationBlueprintInventorySample {
  readonly simulationSeconds: number;
  readonly itemAmounts: Readonly<Record<string, number>>;
}

export interface SimulationBlueprintDeviceStatus {
  readonly entityId: string;
  readonly status: SimulationDeviceOperatingStatus;
}

export interface SimulationBlueprintRunReport {
  readonly status: "completed" | "cancelled" | "timeout" | "failed";
  readonly engineKind: SimulationEngineKind;
  readonly simulationSeconds: number;
  readonly observationSeconds: number;
  readonly elapsedMs: number;
  readonly probes: readonly SimulationBlueprintProbeResult[];
  readonly inventorySamples: readonly SimulationBlueprintInventorySample[];
  readonly deviceStatuses: readonly SimulationBlueprintDeviceStatus[];
  readonly diagnostics: readonly SimulationBlueprintDiagnostic[];
}
