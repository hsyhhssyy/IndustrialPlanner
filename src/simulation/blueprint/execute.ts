import { createWorldDocument } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type {
  SimulationBlueprintDiagnostic,
  SimulationBlueprintInventorySample,
  SimulationBlueprintRunReport,
  SimulationBlueprintRunRequest,
  SimulationEngineKind,
} from "@/domain/simulation";
import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import { collectPoweredEntityIds } from "@/shared/geometry/power-range";
import type { BlueprintExecutionEngine, BlueprintExecutionEngineOptions, CompiledSimulationTopology } from "../contracts";
import { DENSE_STANDARD_TICK_RATE_PER_SECOND, STANDARD_TICK_RATE_PER_SECOND } from "../contracts";
// AI-REMOVED 2026-09-16:
// Reason: 独立执行器不应通过引擎公共出口引入 Host 与浏览器客户端。
// Trigger: Build 的 Worker 打包路径发现 simulation-worker → execute → Host → client → simulation-worker 循环。
// Evidence: 原导入经过 dense/index、legacy/index，二者同时导出 Host。
// Replacement: 调用方显式注入 createEngine；Worker 组合根直接引用引擎适配器。
// Risk: Low
// Human Review: Required
// Original code:
// import { createDenseBlueprintEngine } from "../dense";
// import { createLegacyBlueprintEngine } from "../legacy";
import { resolveDeviceOperatingStatus } from "../projection";
import { compileSimulationTopology } from "../topology";

/** 显式场景执行：不访问编辑器，不补入来源基地的设施或边界。 */
export async function executeBlueprint(
  registry: RegistryContract,
  engineKind: SimulationEngineKind,
  request: SimulationBlueprintRunRequest,
  createEngine: (options: BlueprintExecutionEngineOptions) => BlueprintExecutionEngine,
  signal?: AbortSignal,
  denseTickRate?: 2 | 4,
): Promise<SimulationBlueprintRunReport> {
  validateBlueprintRequest(registry, request);
  if (denseTickRate !== undefined && denseTickRate !== 2 && denseTickRate !== 4) throw new Error("Dense blueprint tick rate must be 2 or 4.");
  const startedAt = performance.now();
  const deadline = startedAt + request.maxWallTimeMs;
  const document = createWorldDocument({ baseId: request.blueprint.baseId });
  const entities = structuredClone([
    ...request.blueprint.entityOrder.map((id) => request.blueprint.entities[id]!),
    ...request.scene.externalEntities,
  ]);
  document.entities = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
  document.entityOrder = entities.map((entity) => entity.id);
  document.slotLinks = structuredClone([...request.blueprint.slotLinks, ...request.scene.externalSlotLinks]);
  document.documentSettings = { ...document.documentSettings, powerMode: request.scene.powerMode };
  const standardTickRate = engineKind === "dense-v2"
    ? denseTickRate ?? DENSE_STANDARD_TICK_RATE_PER_SECOND : STANDARD_TICK_RATE_PER_SECOND;
  let engine: BlueprintExecutionEngine | null = null;
  let topology: CompiledSimulationTopology | null = null;
  let status: SimulationBlueprintRunReport["status"] = "completed";
  let observationStartTick: number | null = null;
  let observedSeconds = 0;
  const amounts = request.probes.map(() => 0);
  const samples: SimulationBlueprintInventorySample[] = [];
  const diagnostics = new Map<string, SimulationBlueprintDiagnostic>();
  const addDiagnostic = (diagnostic: SimulationBlueprintDiagnostic) => {
    diagnostics.set(`${diagnostic.code}:${diagnostic.entityId ?? ""}:${diagnostic.message}`, diagnostic);
  };
  const interrupted = (): boolean => {
    if (signal?.aborted) status = "cancelled";
    else if (performance.now() >= deadline) status = "timeout";
    return status !== "completed";
  };
  try {
    if (!interrupted()) {
      topology = compileSimulationTopology({
        document, registry, standardTickRate,
        simulationMode: SIMULATION_MODE.singleBase,
        activeActivityIds: request.activeActivityIds,
        poweredEntityIds: collectPoweredEntityIds(entities, registry.entityDefinitions),
      });
      topology.diagnostics.forEach(addDiagnostic);
      if (topology.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        status = "failed";
      } else if (!interrupted()) {
        const options = { topology, powerMode: request.scene.powerMode, initialSlots: request.scene.initialSlots };
// AI-REMOVED 2026-09-16:
// Reason: 独立执行器不应通过引擎公共出口引入 Host 与浏览器客户端。
// Trigger: Build 的 Worker 打包路径发现 simulation-worker → execute → Host → client → simulation-worker 循环。
// Evidence: 原导入经过 dense/index、legacy/index，二者同时导出 Host。
// Replacement: 调用方显式注入 createEngine；Worker 组合根直接引用引擎适配器。
// Risk: Low
// Human Review: Required
// Original code:
//         engine = engineKind === "dense-v2"
//           ? createDenseBlueprintEngine(registry, options)
//           : createLegacyBlueprintEngine(registry, options);
        engine = createEngine(options);
        const entityBySlot = resolveSlotEntities(topology);
        const inventorySlotIds = resolveInventorySlots(topology, new Set(request.blueprint.entityOrder), entityBySlot);
        const probes = request.probes.map((probe) => ({ ...probe, entities: new Set(probe.entityIds) }));
        const sampleInventory = () => {
          const itemAmounts: Record<string, number> = {};
          for (const slot of engine!.readSlots()) {
            if (!inventorySlotIds.has(slot.slotId) || slot.ignoreStock || slot.itemType === null) continue;
            itemAmounts[slot.itemType] = (itemAmounts[slot.itemType] ?? 0) + slot.count;
          }
          samples.push({ simulationSeconds: engine!.tickNumber / standardTickRate, itemAmounts });
        };
        const warmupEndTick = Math.ceil(request.warmupSeconds * standardTickRate);
        let nextSample = 1;
        let nextYield = performance.now() + 12;
        while (!interrupted()) {
          if (observationStartTick === null && engine.tickNumber >= warmupEndTick) {
            observationStartTick = engine.tickNumber;
            sampleInventory();
          }
          if (observedSeconds >= request.observationSeconds) break;
          engine.advance();
          if (observationStartTick !== null) {
            observedSeconds = (engine.tickNumber - observationStartTick) / standardTickRate;
            engine.visitTransfers((transfer) => {
              // 仓库存货口会把库存槽重定向到仓库；探针必须保留物理端口所属实体。
              const edge = topology!.transferEdges[transfer.edgeId];
              const source = edge === undefined ? entityBySlot.get(transfer.sourceSlotId)
                : topology!.devices[topology!.ports[edge.sourcePortId]!.deviceId]?.sourceEntityId;
              const target = edge === undefined ? entityBySlot.get(transfer.targetSlotId)
                : topology!.devices[topology!.ports[edge.targetPortId]!.deviceId]?.sourceEntityId;
              probes.forEach((probe, index) => {
                if (transfer.itemType !== probe.itemId) return;
                const sourceInside = source != null && probe.entities.has(source);
                const targetInside = target != null && probe.entities.has(target);
                if (probe.direction === "output" ? sourceInside && !targetInside : targetInside && !sourceInside) {
                  amounts[index] = amounts[index]! + transfer.amount;
                }
              });
            });
            // 一次步进可能跨过多个采样点；只记录实际状态，不复制虚构的中间样本。
            if (nextSample < request.inventorySampleCount - 1
              && observedSeconds >= request.observationSeconds * nextSample / (request.inventorySampleCount - 1)) {
              sampleInventory();
              nextSample = Math.floor(observedSeconds / request.observationSeconds * (request.inventorySampleCount - 1)) + 1;
            }
          }
          engine.readDiagnostics().forEach(addDiagnostic);
          if (performance.now() >= nextYield) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            nextYield = performance.now() + 12;
          }
        }
        if (observationStartTick !== null
          && samples.at(-1)?.simulationSeconds !== engine.tickNumber / standardTickRate) sampleInventory();
      }
    }
  } catch (error) {
    status = signal?.aborted ? "cancelled" : "failed";
    addDiagnostic({ severity: "error", code: "blueprint-execution-failed", message: String(error) });
  }
  try {
    return {
      status, engineKind,
      simulationSeconds: (engine?.tickNumber ?? 0) / standardTickRate,
      observationSeconds: observedSeconds,
      elapsedMs: performance.now() - startedAt,
      probes: request.probes.map((probe, index) => ({
        id: probe.id, amount: amounts[index]!,
        perMinute: observedSeconds > 0 ? amounts[index]! * 60 / observedSeconds : 0,
      })),
      inventorySamples: samples,
      deviceStatuses: engine === null || topology === null ? [] : engine.readDevices().flatMap((snapshot) => {
        const device = topology!.devices[snapshot.deviceId];
        return device?.sourceEntityId === null || device === undefined ? [] : [{
          entityId: device.sourceEntityId,
          status: resolveDeviceOperatingStatus({
            device,
            snapshot,
            isPowerOutage: engine!.isPowerOutage,
            isIdleAsRunning: registry.queries.findEntityDefinition(device.definitionId)
              ?.isIdleAsRunning === true,
          }),
        }];
      }),
      diagnostics: [...diagnostics.values()],
    };
  } finally {
    engine?.dispose();
  }
}

export function validateBlueprintRequest(registry: RegistryContract, request: SimulationBlueprintRunRequest): void {
  if (!Number.isFinite(request.warmupSeconds) || request.warmupSeconds < 0
    || !Number.isFinite(request.observationSeconds) || request.observationSeconds <= 0
    || !Number.isFinite(request.maxWallTimeMs) || request.maxWallTimeMs <= 0
    || !Number.isInteger(request.inventorySampleCount) || request.inventorySampleCount < 2
    || request.inventorySampleCount > 1000) throw new Error("Invalid blueprint execution duration or sample count.");
  const definitions = new Map(registry.entityDefinitions.map((definition) => [definition.id, definition]));
  const items = new Set(registry.itemDefinitions.map((item) => item.id));
  const entities = new Map<string, string>();
  for (const entity of [
    ...request.blueprint.entityOrder.map((id) => request.blueprint.entities[id]),
    ...request.scene.externalEntities,
  ]) {
    if (entity === undefined || entities.has(entity.id) || !definitions.has(entity.definitionId)) {
      throw new Error("Unknown or duplicate blueprint entity.");
    }
    entities.set(entity.id, entity.definitionId);
  }
  if (Object.keys(request.blueprint.entities).length !== request.blueprint.entityOrder.length) {
    throw new Error("Blueprint entity order does not match its entity dictionary.");
  }
  const validateSlot = (entityId: string, groupId: string, slotId: string) => {
    if (entityId === "warehouse" && groupId === "warehouse" && items.has(slotId)) return;
    const definition = definitions.get(entities.get(entityId) ?? "");
    const group = definition?.storageSlotGroups.find((entry) => entry.id === groupId);
    if (!group?.slots.some((slot) => slot.id === slotId)) throw new Error(`Unknown blueprint slot: ${entityId}/${groupId}/${slotId}`);
  };
  const links = new Set<string>();
  for (const link of [...request.blueprint.slotLinks, ...request.scene.externalSlotLinks]) {
    if (links.has(link.id)) throw new Error(`Duplicate blueprint link: ${link.id}`);
    links.add(link.id);
    for (const endpoint of [link.source, link.target]) validateSlot(endpoint.entityId, endpoint.storageSlotGroupId, endpoint.slotId);
  }
  for (const patch of request.scene.initialSlots) {
    validateSlot(patch.entityId, patch.storageGroupId, patch.slotId);
    if (!Number.isFinite(patch.count) || patch.count < 0 || (patch.itemType !== null && !items.has(patch.itemType))) {
      throw new Error("Invalid blueprint initial inventory.");
    }
  }
  const probes = new Set<string>();
  for (const probe of request.probes) {
    if (probes.has(probe.id) || !items.has(probe.itemId) || probe.entityIds.some((id) => !entities.has(id))) {
      throw new Error(`Invalid blueprint probe: ${probe.id}`);
    }
    probes.add(probe.id);
  }
}

function resolveSlotEntities(topology: CompiledSimulationTopology): Map<string, string> {
  const result = new Map<string, string>();
  for (const slot of Object.values(topology.slots)) {
    const node = topology.nodes[slot.nodeId];
    const entityId = node === undefined ? null : topology.devices[node.deviceId]?.sourceEntityId;
    if (entityId !== null && entityId !== undefined) result.set(slot.id, entityId);
  }
  return result;
}

function resolveInventorySlots(
  topology: CompiledSimulationTopology,
  blueprintEntities: ReadonlySet<string>,
  entityBySlot: ReadonlyMap<string, string>,
): Set<string> {
  const aliases = new Map<string, string>();
  for (const link of Object.values(topology.links)) {
    if (link.linkType === "share-all") {
      for (const [source, target] of Object.entries(link.targetSlotIdBySourceSlotId)) aliases.set(source, target);
    }
  }
  const result = new Set<string>();
  for (const [id, entityId] of entityBySlot) {
    if (!blueprintEntities.has(entityId)) continue;
    let canonical = id;
    const visited = new Set<string>();
    while (aliases.has(canonical) && !visited.has(canonical)) {
      visited.add(canonical);
      canonical = aliases.get(canonical)!;
    }
    // 隐藏仓库或外部源汇的真实库存不能被代理槽重复算入蓝图。
    if (blueprintEntities.has(entityBySlot.get(canonical) ?? "")) result.add(canonical);
  }
  return result;
}
