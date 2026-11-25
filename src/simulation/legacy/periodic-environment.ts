import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { CompiledSimulationTopology } from "../contracts";
import {
  compilePeriodicEnvironment,
  periodicEnvironmentSourceId,
  periodicEnvironmentTickAtTime,
  periodicEnvironmentTimeUnits,
  type CompiledPeriodicEnvironment,
} from "../environment";
import type { RecipeRandomSource } from "../recipe-selection";
import { aggregateInputItems, resolveStorageSlotId } from "./runtime-slot-access";
import { isDeviceConsumptionAuthorizedNow } from "./consumption-channel";
import type { SimulationMutableRuntimeState } from "./runtime-state";

export class LegacyPeriodicEnvironment {
  private readonly runtime: ReturnType<CompiledPeriodicEnvironment["createRuntime"]>;
  private readonly ownersBySlot = new Map<string, Set<string>>();
  private readonly sources;

  private constructor(
    compiled: CompiledPeriodicEnvironment,
    private readonly topology: CompiledSimulationTopology,
    random: RecipeRandomSource,
    state: SimulationMutableRuntimeState,
    currentState: () => SimulationMutableRuntimeState,
  ) {
    this.sources = [...compiled.sourcesByDevice].flatMap(([deviceId, channels]) => {
      const device = topology.devices[deviceId]!;
      return [...channels].map(([channelId, effects]) => ({
        deviceId,
        device,
        channelId,
        effects,
        sourceId: periodicEnvironmentSourceId(deviceId, channelId),
        consumption: device.recipeChannels.some(channel => channel.id === channelId && channel.type === "consumption-channel"),
        powered: device.powerStatus !== "out-of-power-range",
        requiresPower: device.requiresPower,
      }));
    });
    for (const node of Object.values(topology.nodes)) {
      for (const projectedSlotId of node.slotIds) {
        const slotId = resolveStorageSlotId(state, projectedSlotId);
        if (!compiled.affectedSlotIds.has(slotId)) continue;
        let owners = this.ownersBySlot.get(slotId);
        if (owners === undefined) {
          owners = new Set();
          this.ownersBySlot.set(slotId, owners);
        }
        owners.add(node.deviceId);
      }
    }

    this.runtime = compiled.createRuntime(random, (slotId, transformItem) => {
      const state = currentState();
      const slot = state.persistent.slots[slotId];
      if (slot === undefined || slot.itemType === null || slot.count === 0) return;
      const previousItemType = slot.itemType;
      const replacement = transformItem(previousItemType);
      if (replacement === previousItemType) return;
      slot.itemType = replacement;
      // 2026-11-25: 区域概率转化是非配方产出通道，按实际替换记录 1 件旧物品消耗与 1 件新物品产出，
      // 与配方统计共用同一分钟窗口；概率未命中或映射不匹配时上方已提前返回，不产生统计。
      const statsDelta = state.transient.recipeStatsDelta;
      statsDelta.consumed[previousItemType] = (statsDelta.consumed[previousItemType] ?? 0) + 1;
      statsDelta.produced[replacement] = (statsDelta.produced[replacement] ?? 0) + 1;
      for (const deviceId of this.ownersBySlot.get(slotId) ?? []) {
        const device = state.persistent.devices[deviceId];
        if (device === undefined) continue;
        for (const recipe of Object.values(device.channelRecipes)) {
          if (recipe === null) continue;
          let changed = false;
          for (const reservation of recipe.reservations) {
            if (reservation.slotId !== slotId) continue;
            reservation.itemType = replacement;
            changed = true;
          }
          if (changed) recipe.inputItems = aggregateInputItems(recipe.reservations);
        }
      }
    });
  }

  public static create(
    topology: CompiledSimulationTopology,
    registry: RegistryContract,
    random: RecipeRandomSource,
    state: SimulationMutableRuntimeState,
    currentState: () => SimulationMutableRuntimeState,
  ): LegacyPeriodicEnvironment | null {
    const compiled = compilePeriodicEnvironment(topology, registry, slotId => resolveStorageSlotId(state, slotId));
    if (compiled === null) return null;
    return new LegacyPeriodicEnvironment(compiled, topology, random, state, currentState);
  }

  public restore(
    state: SimulationMutableRuntimeState,
    checkpoint = state.persistent.periodicEnvironment,
  ): void {
    const time = periodicEnvironmentTimeUnits(state.tickNumber, this.topology.standardTickRate);
    this.runtime.restore(checkpoint, time);
    this.syncSourceEffects(state, time);
    state.persistent.periodicEnvironment = this.runtime.checkpoint(time);
    state.transient.periodicRegions = this.runtime.snapshots(time);
  }

  public nextDueTick(): number | undefined {
    const time = this.runtime.nextDueTimeMs();
    return time === undefined ? undefined : periodicEnvironmentTickAtTime(time, this.topology.standardTickRate);
  }

  public advance(state: SimulationMutableRuntimeState): void {
    const time = periodicEnvironmentTimeUnits(state.tickNumber, this.topology.standardTickRate);
    this.syncSourceEffects(state, time);
    this.runtime.settle(time);
    state.persistent.periodicEnvironment = this.runtime.checkpoint(time);
    state.transient.periodicRegions = this.runtime.snapshots(time);
  }

  private syncSourceEffects(state: SimulationMutableRuntimeState, time: number): void {
    for (const source of this.sources) {
      const recipe = state.persistent.devices[source.deviceId]?.channelRecipes[source.channelId];
      const canAdvance = source.consumption
        || (source.powered && !(state.transient.isPowerOutage && source.requiresPower)
          && isDeviceConsumptionAuthorizedNow(source.device, state));
      const effect = recipe?.state === "running" && canAdvance ? source.effects.get(recipe.recipeId) ?? null : null;
      this.runtime.setSourceEffect(source.sourceId, effect, time);
    }
  }
}
