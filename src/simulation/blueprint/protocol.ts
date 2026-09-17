import type { SimulationBlueprintRunRequest, SimulationBlueprintRunReport, SimulationEngineKind } from "@/domain/simulation";

export type BlueprintWorkerRequest = {
  readonly type: "run-blueprint";
  readonly request: SimulationBlueprintRunRequest;
  readonly engineKind: SimulationEngineKind;
  readonly denseTickRate?: 2 | 4;
} | { readonly type: "cancel-blueprint" };

export interface BlueprintWorkerResponse {
  readonly type: "blueprint-completed";
  readonly report: SimulationBlueprintRunReport;
}
