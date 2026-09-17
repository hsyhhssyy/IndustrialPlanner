import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { BlueprintExecutionEngine, BlueprintExecutionEngineOptions } from "../contracts";
import { compileDenseTopologyLayout } from "./dense-topology";
import { DenseSimulationKernel } from "./dense-simulation-kernel";

export function createDenseBlueprintEngine(
  registry: RegistryContract,
  options: BlueprintExecutionEngineOptions,
): BlueprintExecutionEngine {
  const layout = compileDenseTopologyLayout(options.topology, registry);
  const kernel = new DenseSimulationKernel(options.topology, layout, registry);
  kernel.setPowerMode(options.powerMode);
  for (const patch of options.initialSlots) kernel.patchRuntimeSlot(patch);
  let disposed = false;
  return {
    get tickNumber() { return kernel.tickNumber; },
    get isPowerOutage() { return kernel.isPowerOutage; },
    advance() {
      if (disposed) throw new Error("Isolated simulation is disposed.");
      kernel.advanceToTick(kernel.tickNumber + 1);
    },
    visitTransfers(visit) {
      const transfers = kernel.transfers;
      for (let index = 0; index < transfers.amounts.length; index += 1) {
        visit({
          edgeId: layout.dictionary.edgeIds[transfers.edgeIndexes[index]!]!,
          sourceSlotId: layout.dictionary.slotIds[transfers.sourceSlotIndexes[index]!]!,
          targetSlotId: layout.dictionary.slotIds[transfers.targetSlotIndexes[index]!]!,
          itemType: layout.dictionary.itemIds[transfers.itemIndexes[index]!]!,
          amount: transfers.amounts[index]!,
        });
      }
    },
    readSlots: () => layout.dictionary.slotIds.map((slotId, index) => {
      const slot = kernel.state.readSlot(index);
      return {
        slotId,
        itemType: layout.dictionary.itemIds[slot.itemIndex] ?? null,
        count: slot.count,
        reserved: slot.reserved,
        ignoreStock: slot.ignoreStock,
      };
    }),
    readDevices: () => layout.dictionary.deviceIds.map((_, index) => kernel.createDeviceSnapshot(index)),
    readDiagnostics: () => [],
    dispose() { disposed = true; },
  };
}
