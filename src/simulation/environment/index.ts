import type { RecipeDefinition } from "@/domain/registry/types/recipe-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import { GridRectIndex } from "@/shared/geometry/grid-rect-index";
import { findEntityRange, resolveLocalRangeGridRect } from "@/shared/geometry/entity-range";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import { areGridRectsContaining } from "@/shared/geometry/power-range";
import type { CompiledSimulationTopology, RuntimeEnvironmentSnapshot } from "../contracts";

export interface EnvironmentRecipeBinding {
  readonly conditions: Uint32Array;
  readonly providerIndex: number;
}

interface EnvironmentProvider {
  readonly snapshotIndex: number;
  readonly snapshot: RuntimeEnvironmentSnapshot;
  readonly conditions: Uint32Array;
}

/** 只保存实际存在的设备/物品需求与覆盖边，所有几何工作在构造期结束。 */
export class CompiledEnvironment {
  public readonly bindings: readonly EnvironmentRecipeBinding[];
  public readonly providers: readonly EnvironmentProvider[];
  public readonly providerDemand: Uint32Array;
  private readonly providerCoverage: Uint32Array;
  private readonly providerActive: Uint8Array;
  private readonly providersByCondition: readonly Uint32Array[];
  private readonly activeSnapshots = new Set<number>();
  private readonly snapshotActiveCounts: Uint32Array;
  private readonly sourceSnapshots: readonly RuntimeEnvironmentSnapshot[];
  private snapshotCache: readonly RuntimeEnvironmentSnapshot[] | null = null;

  public constructor(topology: CompiledSimulationTopology, registry: RegistryContract,
    recipes: readonly { readonly deviceId: string; readonly recipe: Pick<RecipeDefinition, "requiredEnvironmentAnyOf" | "environmentOutput"> }[]) {
    const conditionIndexes = new Map<string, Map<string, number>>();
    const conditions: { deviceId: string; itemId: string; index: number }[] = [];
    const recipeConditions = recipes.map(({ deviceId, recipe }) => Uint32Array.from(recipe.requiredEnvironmentAnyOf ?? [], itemId => {
      let byItem = conditionIndexes.get(deviceId);
      if (!byItem) { byItem = new Map(); conditionIndexes.set(deviceId, byItem); }
      let index = byItem.get(itemId);
      if (index === undefined) { index = conditions.length; byItem.set(itemId, index); conditions.push({ deviceId, itemId, index }); }
      return index;
    }));
    const receiverRects = [...conditionIndexes.keys()].flatMap(deviceId => {
      const device = topology.devices[deviceId]!;
      if (!device.position || !device.footprint || device.rotation === null) return [];
      const footprint = getRotatedGridFootprint(device.footprint, device.rotation);
      return [{ deviceId, rect: { ...device.position, width: footprint.width, height: footprint.height } }];
    });
    const spatial = new GridRectIndex(receiverRects, entry => entry.rect);
    const providers: EnvironmentProvider[] = [];
    const sourceSnapshots: RuntimeEnvironmentSnapshot[] = [];
    const sourceSnapshotIndexes = new Map<string, number>();
    const reverse = conditions.map(() => [] as number[]);
    this.bindings = recipes.map(({ deviceId, recipe }, recipeIndex) => {
      const output = recipe.environmentOutput;
      if (!output) return { conditions: recipeConditions[recipeIndex]!, providerIndex: -1 };
      const device = topology.devices[deviceId]!;
      if (!device.position || !device.footprint || device.rotation === null) throw new Error(`Environment source has no geometry: ${deviceId}`);
      const range = findEntityRange(registry.queries.findEntityDefinition(device.definitionId)!, output.rangeId);
      const gridRect = resolveLocalRangeGridRect(device.position, device.footprint, device.rotation, range.localRect);
      const matched: number[] = [];
      const providerIndex = providers.length;
      for (const receiver of spatial.intersecting(gridRect)) {
        if (range.coverage === "contains" && !areGridRectsContaining(gridRect, receiver.rect)) continue;
        const condition = conditionIndexes.get(receiver.deviceId)!.get(output.itemId);
        if (condition === undefined) continue;
        matched.push(condition);
        reverse[condition]!.push(providerIndex);
      }
      const key = deviceId + ":" + output.rangeId + ":" + output.itemId;
      let snapshotIndex = sourceSnapshotIndexes.get(key);
      if (snapshotIndex === undefined) {
        snapshotIndex = sourceSnapshots.length;
        sourceSnapshotIndexes.set(key, snapshotIndex);
        sourceSnapshots.push({ sourceDeviceId: deviceId, rangeId: output.rangeId, rotation: device.rotation, itemId: output.itemId, gridRect });
      }
      providers.push({ snapshotIndex, snapshot: sourceSnapshots[snapshotIndex]!, conditions: Uint32Array.from(matched) });
      return { conditions: recipeConditions[recipeIndex]!, providerIndex };
    });
    this.providers = providers;
    this.sourceSnapshots = sourceSnapshots;
    this.snapshotActiveCounts = new Uint32Array(sourceSnapshots.length);
    this.providersByCondition = reverse.map(entries => Uint32Array.from(entries));
    this.providerCoverage = new Uint32Array(conditions.length);
    this.providerDemand = new Uint32Array(providers.length);
    this.providerActive = new Uint8Array(providers.length);
  }

  public satisfied(binding: EnvironmentRecipeBinding): boolean {
    if (binding.conditions.length === 0) return true;
    for (const condition of binding.conditions) if (this.providerCoverage[condition]! > 0) return true;
    return false;
  }

  public demand(binding: EnvironmentRecipeBinding, delta: 1 | -1): void {
    for (const condition of binding.conditions) for (const provider of this.providersByCondition[condition]!) {
      const next = this.providerDemand[provider]! + delta;
      if (next < 0) throw new Error("Environment demand underflow.");
      this.providerDemand[provider] = next;
    }
  }

  public activate(provider: number, active: boolean): void {
    if (provider < 0 || Boolean(this.providerActive[provider]) === active) return;
    this.providerActive[provider] = active ? 1 : 0;
    const snapshot = this.providers[provider]!.snapshotIndex;
    this.snapshotActiveCounts[snapshot] = this.snapshotActiveCounts[snapshot]! + (active ? 1 : -1);
    if (this.snapshotActiveCounts[snapshot]! > 0) this.activeSnapshots.add(snapshot); else this.activeSnapshots.delete(snapshot);
    for (const condition of this.providers[provider]!.conditions) this.providerCoverage[condition] = this.providerCoverage[condition]! + (active ? 1 : -1);
    this.snapshotCache = null;
  }

  public snapshots(): readonly RuntimeEnvironmentSnapshot[] {
    return this.snapshotCache ??= [...this.activeSnapshots].map(index => this.sourceSnapshots[index]!);
  }

  public reset(): void {
    this.providerDemand.fill(0);
    this.providerCoverage.fill(0);
    this.providerActive.fill(0);
    this.activeSnapshots.clear();
    this.snapshotActiveCounts.fill(0);
    this.snapshotCache = null;
  }
}
