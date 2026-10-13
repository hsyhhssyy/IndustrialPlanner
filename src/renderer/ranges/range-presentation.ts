import type { SimulationGasDiffusionRangeReadModel } from "@/domain/simulation/types/simulation-types";
import type { RangeInstance, RangeInteractionVisualState, RangePresentation, RangeOutlineInstance, RangeAnimationInstance } from "./types";

/** 视觉预设与接收资格互不依赖；后续区域动画沿用同一资源协议。 */
const RANGE_VISUALS: Readonly<Record<string, { color: number; strokeAlpha: number; strokeScale: number; assetRoot?: string }>> = {
  power: { color: 0x87ceeb, strokeAlpha: 0.8, strokeScale: 1.15 },
  gas: { color: 0x66cc66, strokeAlpha: 0.55, strokeScale: 1, assetRoot: "3d-top-view/gas-environment" },
  irrigation: { color: 0x5abcea, strokeAlpha: 0.85, strokeScale: 1.15 },
};

export function resolveRangePresentation(options: {
  readonly ranges: readonly RangeInstance[];
  readonly interaction: RangeInteractionVisualState;
  readonly activeGasRanges: readonly SimulationGasDiffusionRangeReadModel[];
  readonly resolveGasColor: (gasItemId: string) => number;
  readonly supportsAnimation: boolean;
  readonly isAnimationReady: (assetRoot: string) => boolean;
}): RangePresentation {
  const outlines: RangeOutlineInstance[] = [];
  const animations: RangeAnimationInstance[] = [];
  const activeByRange = new Map<string, SimulationGasDiffusionRangeReadModel[]>();
  for (const active of options.activeGasRanges) {
    const key = JSON.stringify([active.sourceDeviceId, active.rangeId]);
    const entries = activeByRange.get(key) ?? [];
    entries.push(active); activeByRange.set(key, entries);
  }
  for (const instance of options.ranges) {
    if (!options.interaction.visibleRangeKeys.has(instance.key)) continue;
    const visual = RANGE_VISUALS[instance.range.visualId];
    if (!visual) throw new Error(`Unknown range visual: ${instance.range.visualId}`);
    const activeRanges = activeByRange.get(JSON.stringify([`device:${instance.entityId}`, instance.range.id])) ?? [];
    if (activeRanges.length === 0) {
      outlines.push({ gridRect: instance.gridRect, ...visual, fillAlpha: 0 });
      continue;
    }
    for (const active of activeRanges) {
      const color = options.resolveGasColor(active.gasItemId);
      if (options.supportsAnimation && visual.assetRoot) {
        animations.push({ key: JSON.stringify([active.sourceDeviceId, active.rangeId, active.gasItemId]),
          gridRect: active.gridRect, rotation: active.rotation, color, assetRoot: visual.assetRoot });
        if (options.isAnimationReady(visual.assetRoot)) continue;
      }
      outlines.push({ gridRect: active.gridRect, color, strokeAlpha: 0.86, strokeScale: 1.1, fillAlpha: 0.07 });
    }
  }
  return { outlines, animations };
}
