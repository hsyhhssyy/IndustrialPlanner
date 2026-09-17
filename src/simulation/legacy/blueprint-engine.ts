import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { BlueprintExecutionEngine, BlueprintExecutionEngineOptions, RuntimeTickSnapshot } from "../contracts";
import { SimulationWorkerRuntime } from "./worker-runtime";

export function createLegacyBlueprintEngine(
  registry: RegistryContract,
  options: BlueprintExecutionEngineOptions,
): BlueprintExecutionEngine {
  const runtime = new SimulationWorkerRuntime(registry);
  let snapshot: RuntimeTickSnapshot;
  try {
    snapshot = runtime.initializeIsolated(options.topology, options.powerMode, options.initialSlots);
  } catch (error) {
    runtime.disposeIsolated();
    throw error;
  }
  return {
    get tickNumber() { return snapshot.tickNumber; },
    get isPowerOutage() { return snapshot.isPowerOutage; },
    advance() { snapshot = runtime.advanceIsolated(); },
    visitTransfers(visit) { snapshot.transfers.forEach(visit); },
    readSlots: () => Object.values(snapshot.slots),
    readDevices: () => Object.values(snapshot.devices),
    readDiagnostics: () => snapshot.diagnostics,
    dispose: () => runtime.disposeIsolated(),
  };
}
