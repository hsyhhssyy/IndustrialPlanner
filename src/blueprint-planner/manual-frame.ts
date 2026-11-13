import type { BlueprintPlannerManualLayout, BlueprintPlannerManualTransform } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRotation } from "@/domain/shared/grid";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { manualBoundarySides } from "@/shared/planner-manual-devices";
import { PlannerCandidateError, type PlannerNetwork } from "./model";

export function manualFrameBounds(registry: RegistryContract, manual: BlueprintPlannerManualLayout, rotation: GridRotation) {
  const rects = manual.placements.map(placement => {
    const definition = registry.queries.findEntityDefinition(placement.referenceNode.definitionId)!;
    const pose = transformManualPlacement(placement, definition, { rotation, translation: { x: 0, y: 0 } });
    return resolveEntityGridRect({ definition, entity: { ...pose, id: placement.referenceNode.id,
      definitionId: definition.id, config: {}, tags: [] } });
  });
  const x = rects.length ? Math.min(...rects.map(rect => rect.x)) : 0;
  const y = rects.length ? Math.min(...rects.map(rect => rect.y)) : 0;
  const width = rects.length ? Math.max(...rects.map(rect => rect.x + rect.width)) - x : 0;
  const height = rects.length ? Math.max(...rects.map(rect => rect.y + rect.height)) - y : 0;
  if (![x, y, width, height].every(Number.isSafeInteger)) throw new Error("人工布局跨度超出安全坐标范围。");
  return { x, y, width, height };
}

/** 在候选盒内选整体位姿；续算保持整体朝向，只在缩盒时必要地平移。 */
export function configureManualFrame(registry: RegistryContract, network: PlannerNetwork,
  outline?: { readonly width: number; readonly height: number }, variant = 0, preserve = false): void {
  const manual = network.request.manualLayout;
  if (!manual?.enabled || network.preparingManual) return;
  const previous = network.manualTransform;
  const rotations: GridRotation[] = preserve && previous ? [previous.rotation] : manual.orientation === "fixed" ? [0]
    : [0, 1, 2, 3].map(index => ((index + variant) % 4 * 90) as GridRotation);
  const choice = rotations.map(rotation => ({ rotation, bounds: manualFrameBounds(registry, manual, rotation) }))
    .find(({ bounds }) => !outline || bounds.width <= outline.width && bounds.height <= outline.height);
  if (!choice) throw new PlannerCandidateError("人工设备群无法放入当前候选尺寸。");
  const { rotation, bounds } = choice;
  const slackX = (outline?.width ?? bounds.width) - bounds.width;
  const slackY = (outline?.height ?? bounds.height) - bounds.height;
  const offset = (slack: number, axis: number) => variant % 3 === 0 ? Math.floor(slack / 2)
    : (Math.imul(variant + axis, 2654435761) >>> 0) % (slack + 1);
  const translation = {
    x: preserve && previous ? Math.max(-bounds.x, Math.min(slackX - bounds.x, previous.translation.x)) : offset(slackX, 1) - bounds.x,
    y: preserve && previous ? Math.max(-bounds.y, Math.min(slackY - bounds.y, previous.translation.y)) : offset(slackY, 7) - bounds.y,
  };
  if (![translation.x, translation.y].every(Number.isSafeInteger)) throw new Error("人工布局变换超出安全坐标范围。");
  network.manualTransform = { rotation, translation };
  if (!preserve || network.manualBoundaryRotation === undefined) {
    network.manualBoundaryRotation = ((rotation + (manual.boundary.rotation ?? Math.floor(variant / 4) % 4 * 90)) % 360) as GridRotation;
  }
}

export function manualWarehouseMask(network: PlannerNetwork): number {
  if (!network.request.manualLayout?.enabled) return 15;
  if (network.manualBoundaryRotation === undefined) throw new Error("人工布局缺少存取线方向。");
  return manualBoundarySides(network.request.options.warehouseBus).reduce((mask, side) => mask | 1 << manualWarehouseSide(network, side), 0);
}

export function manualWarehouseSide(network: PlannerNetwork, side: "base" | "left" | "right"): number {
  return (({ base: 2, left: 3, right: 1 })[side] + network.manualBoundaryRotation! / 90) % 4;
}

export function assertManualTransform(manual: BlueprintPlannerManualLayout, transform: BlueprintPlannerManualTransform | undefined): asserts transform is BlueprintPlannerManualTransform {
  if (!transform || ![0, 90, 180, 270].includes(transform.rotation)
    || manual.orientation === "fixed" && transform.rotation !== 0
    || !Number.isSafeInteger(transform.translation?.x) || !Number.isSafeInteger(transform.translation?.y)) {
    throw new Error("人工布局结果缺少合法的整体变换。");
  }
}
