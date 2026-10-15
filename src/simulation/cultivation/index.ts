import type { CropCultivationDefinition } from "@/domain/registry/types/entity-definition";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { SimulationCropCultivationReadModel } from "@/domain/simulation/types/simulation-types";
import { GridRectIndex } from "@/shared/geometry/grid-rect-index";
import { getRotatedGridFootprint } from "@/shared/geometry/grid";
import type { CompiledSimulationTopology } from "../contracts";
import type { DeviceStateRuntime } from "../device-state";

export interface CultivationCheckpoint {
  readonly seconds: number;
  readonly snapshots: readonly SimulationCropCultivationReadModel[];
}

/** 几何只在编译时查询；相接条件按状态变化更新，进度使用上一时间区间的条件。 */
export class CropCultivationRuntime {
  private readonly plots: {
    deviceId: string; machine: number; definition: CropCultivationDefinition; neighbors: number[];
    growing: boolean; refined: boolean; progress: number; effective: number; ratio: number;
  }[] = [];
  private readonly byMachine = new Map<number, number>();
  private readonly byDevice = new Map<string, number>();
  private readonly pending = new Set<number>();
  public readonly changedDevices = new Set<string>();
  private seconds = 0;

  public constructor(topology: CompiledSimulationTopology, registry: RegistryContract, private readonly states: DeviceStateRuntime) {
    const rectangles = states.programs.flatMap((program, machine) => {
      const device = topology.devices[program.deviceId]!;
      const definition = registry.queries.findEntityDefinition(device.definitionId)?.cultivation;
      if (!definition) return [];
      if (!(definition.neighborDurationSeconds > 0) || !Number.isFinite(definition.neighborDurationSeconds)
        || !(definition.neighborBonusPerPlot >= 0) || !Number.isFinite(definition.neighborBonusPerPlot)) throw new Error("Invalid cultivation parameters.");
      if (!device.position || !device.footprint || device.rotation === null) throw new Error("Cultivation plot has no geometry.");
      const ids = new Set(program.states.map(state => state.id));
      if ([...definition.growingStateIds, ...definition.refinedStateIds].some(id => !ids.has(id))) throw new Error("Unknown cultivation state.");
      const index = this.plots.length;
      this.plots.push({ deviceId: program.deviceId, machine, definition, neighbors: [], growing: false, refined: false, progress: 0, effective: 0, ratio: 0 });
      this.byMachine.set(machine, index);
      this.byDevice.set(program.deviceId, index);
      const footprint = getRotatedGridFootprint(device.footprint, device.rotation);
      return [{ index, rect: { ...device.position, width: footprint.width, height: footprint.height } }];
    });
    const spatial = new GridRectIndex(rectangles, entry => entry.rect);
    for (const { index, rect: a } of rectangles) {
      const plot = this.plots[index]!;
      for (const { index: other, rect: b } of spatial.intersecting({ x: a.x - 1, y: a.y - 1, width: a.width + 2, height: a.height + 2 })) {
        if (other === index || plot.definition.cropId !== this.plots[other]!.definition.cropId) continue;
        const vertical = (a.x + a.width === b.x || b.x + b.width === a.x) && a.y < b.y + b.height && b.y < a.y + a.height;
        const horizontal = (a.y + a.height === b.y || b.y + b.height === a.y) && a.x < b.x + b.width && b.x < a.x + a.width;
        if (vertical || horizontal) plot.neighbors.push(other);
      }
    }
  }

  public advance(seconds: number): void {
    const elapsed = seconds - this.seconds;
    if (elapsed < 0) throw new Error("Cultivation time moved backwards without restore.");
    this.seconds = seconds;
    if (elapsed === 0) return;
    for (const plot of this.plots) {
      if (!plot.growing || plot.effective === 0 || plot.progress >= plot.definition.neighborDurationSeconds) continue;
      plot.progress = Math.min(plot.definition.neighborDurationSeconds, plot.progress + elapsed);
      plot.ratio = plot.progress >= plot.definition.neighborDurationSeconds ? plot.effective * plot.definition.neighborBonusPerPlot : 0;
      this.changedDevices.add(plot.deviceId);
    }
  }

  public stateChanged(machine: number, next: number): void {
    const index = this.byMachine.get(machine);
    if (index === undefined) return;
    const plot = this.plots[index]!;
    const program = this.states.programs[machine]!;
    const id = program.states[next]?.id;
    plot.growing = id !== undefined && plot.definition.growingStateIds.includes(id);
    plot.refined = id !== undefined && plot.definition.refinedStateIds.includes(id);
    if (next === program.initialIndex) { plot.progress = 0; plot.effective = 0; plot.ratio = 0; }
    // 离开生长期保留最后生长区间的加成，避免同时成熟时受设备遍历顺序影响。
    this.pending.add(index);
    for (const neighbor of plot.neighbors) this.pending.add(neighbor);
    this.changedDevices.add(plot.deviceId);
  }

  public refresh(): void {
    for (const index of this.pending) {
      const plot = this.plots[index]!;
      if (!plot.growing) continue;
      plot.effective = plot.neighbors.filter(neighbor => {
        const other = this.plots[neighbor]!;
        return other.growing && (plot.refined || other.refined);
      }).length;
      plot.ratio = plot.progress >= plot.definition.neighborDurationSeconds ? plot.effective * plot.definition.neighborBonusPerPlot : 0;
      this.changedDevices.add(plot.deviceId);
    }
    this.pending.clear();
  }

  public snapshot(deviceId: string): SimulationCropCultivationReadModel | undefined {
    const index = this.byDevice.get(deviceId);
    if (index === undefined) return undefined;
    const plot = this.plots[index]!;
    return { neighborProgressSeconds: plot.progress, adjacentPlotCount: plot.neighbors.length,
      effectiveNeighborCount: plot.effective, yieldBonusRatio: plot.ratio,
      isNeighborProgressing: plot.growing && plot.effective > 0 && plot.progress < plot.definition.neighborDurationSeconds };
  }

  public outputAmount(deviceId: string, amount: number): number {
    const index = this.byDevice.get(deviceId);
    return index === undefined ? amount : Math.round(amount * (1 + this.plots[index]!.ratio));
  }

  public checkpoint(): CultivationCheckpoint {
    return { seconds: this.seconds, snapshots: this.plots.map(plot => this.snapshot(plot.deviceId)!) };
  }

  public restore(checkpoint: CultivationCheckpoint): void {
    if (checkpoint.snapshots.length !== this.plots.length || !Number.isFinite(checkpoint.seconds) || checkpoint.seconds < 0) throw new Error("Invalid cultivation checkpoint.");
    this.seconds = checkpoint.seconds;
    this.pending.clear();
    this.plots.forEach((plot, index) => {
      const saved = checkpoint.snapshots[index]!;
      if (!Number.isFinite(saved.neighborProgressSeconds) || saved.neighborProgressSeconds < 0
        || saved.neighborProgressSeconds > plot.definition.neighborDurationSeconds) throw new Error("Invalid cultivation progress.");
      plot.progress = saved.neighborProgressSeconds;
      plot.effective = saved.effectiveNeighborCount;
      plot.ratio = saved.yieldBonusRatio;
      this.stateChanged(plot.machine, this.states.indexes[plot.machine]!);
    });
    this.refresh();
  }

  public restoreSnapshots(seconds: number, snapshot: (deviceId: string) => SimulationCropCultivationReadModel | undefined): void {
    this.restore({ seconds, snapshots: this.plots.map(plot => snapshot(plot.deviceId) ?? {
      neighborProgressSeconds: 0, adjacentPlotCount: plot.neighbors.length, effectiveNeighborCount: 0,
      yieldBonusRatio: 0, isNeighborProgressing: false,
    }) });
  }
}
