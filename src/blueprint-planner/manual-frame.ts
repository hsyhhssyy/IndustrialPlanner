import type { BlueprintPlannerManualLayout, BlueprintPlannerManualTransform } from "@/domain/blueprint-planner";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridRotation } from "@/domain/shared/grid";
import { transformManualPlacement } from "@/shared/geometry/manual-layout-transform";
import { resolveEntityGridRect } from "@/shared/geometry/power-range";
import { isPlannerManualBoundaryDevice, manualBoundarySides } from "@/shared/planner-manual-devices";
import { PlannerCandidateError, type PlannerNetwork } from "./model";
import { EDGES, getPlannerPorts, opposite } from "./geometry";
import { matchesPlannerDimensionConstraint, resolvePlannerDimensionConstraint } from "@/shared/planner-dimension-limits";

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

/** 调度保留整个设备群的可行跨度，不能将两个旋转方向分别取最小值当成可行矩形。 */
export function manualFrameSpans(registry: RegistryContract, manual?: BlueprintPlannerManualLayout) {
  if (!manual?.enabled || !manual.placements.length) return undefined;
  const { width, height } = manualFrameBounds(registry, manual, 0);
  return manual.orientation === "free" && width !== height ? [{ width, height }, { width: height, height: width }] : [{ width, height }];
}

/** 在候选盒内选整体位姿；续算保持整体朝向，只在缩盒时必要地平移。 */
export function configureManualFrame(registry: RegistryContract, network: PlannerNetwork,
  outline?: { readonly width: number; readonly height: number; readonly warehouseSide?: number }, variant = 0, preserve = false): void {
  const manual = network.request.manualLayout;
  if (!manual?.enabled || network.preparingManual) return;
  const previous = network.manualTransform;
  const rotations: GridRotation[] = preserve && previous ? [previous.rotation] : manual.orientation === "fixed" ? [0]
    : [0, 1, 2, 3].map(index => ((index + variant) % 4 * 90) as GridRotation);
  const limits = resolvePlannerDimensionConstraint(registry, network.request);
  const choice = rotations.map(rotation => ({ rotation, bounds: manualFrameBounds(registry, manual, rotation) }))
    .flatMap(choice => {
      const boundaryRotations: GridRotation[] = preserve && network.manualBoundaryRotation !== undefined ? [network.manualBoundaryRotation]
        : manual.boundary.rotation !== null ? [((choice.rotation + manual.boundary.rotation) % 360) as GridRotation]
          : [0, 1, 2, 3].map(index => ((choice.rotation + (Math.floor(variant / 4) + index) * 90) % 360) as GridRotation);
      return boundaryRotations.map(boundaryRotation => ({ ...choice, boundaryRotation,
        anchor: manualBoundaryAnchor(registry, network, choice.rotation, boundaryRotation, outline) }));
    })
    .find(({ bounds, anchor, boundaryRotation }) => anchor !== null && (!outline || bounds.width <= outline.width && bounds.height <= outline.height
      && matchesPlannerDimensionConstraint(limits, outline.width, outline.height, (2 + boundaryRotation / 90) % 4)
      && (outline.warehouseSide === undefined || outline.warehouseSide === (2 + boundaryRotation / 90) % 4)
      && (anchor.x === undefined || anchor.x >= -bounds.x && anchor.x <= outline.width - bounds.width - bounds.x)
      && (anchor.y === undefined || anchor.y >= -bounds.y && anchor.y <= outline.height - bounds.height - bounds.y)));
  if (!choice) throw new PlannerCandidateError("人工设备群无法放入当前候选尺寸。");
  const { rotation, bounds } = choice;
  const slackX = (outline?.width ?? bounds.width) - bounds.width;
  const slackY = (outline?.height ?? bounds.height) - bounds.height;
  const offset = (slack: number, axis: number) => variant % 3 === 0 ? Math.floor(slack / 2)
    : (Math.imul(variant + axis, 2654435761) >>> 0) % (slack + 1);
  const translation = {
    x: choice.anchor!.x ?? (preserve && previous ? Math.max(-bounds.x, Math.min(slackX - bounds.x, previous.translation.x)) : offset(slackX, 1) - bounds.x),
    y: choice.anchor!.y ?? (preserve && previous ? Math.max(-bounds.y, Math.min(slackY - bounds.y, previous.translation.y)) : offset(slackY, 7) - bounds.y),
  };
  if (![translation.x, translation.y].every(Number.isSafeInteger)) throw new Error("人工布局变换超出安全坐标范围。");
  network.manualTransform = { rotation, translation };
  if (!preserve || network.manualBoundaryRotation === undefined) {
    network.manualBoundaryRotation = choice.boundaryRotation;
  }
}

/** 固定存取口和普通设备使用同一刚体变换，贴边约束只收紧整体平移的自由度。 */
function manualBoundaryAnchor(registry: RegistryContract, network: PlannerNetwork, rotation: GridRotation,
  boundaryRotation: GridRotation, outline?: { readonly width: number; readonly height: number }): { x?: number; y?: number } | null {
  const anchor: { x?: number; y?: number } = {};
  if (!outline) return anchor;
  const manual = network.request.manualLayout!;
  const allowed = manualBoundarySides(network.request.options.warehouseBus)
    .map(side => (({ base: 2, left: 3, right: 1 })[side] + boundaryRotation / 90) % 4);
  for (const placement of manual.placements) {
    const definition = registry.queries.findEntityDefinition(placement.referenceNode.definitionId)!;
    if (!isPlannerManualBoundaryDevice(definition)) continue;
    const pose = transformManualPlacement(placement, definition, { rotation, translation: { x: 0, y: 0 } });
    const entity = { ...pose, id: placement.referenceNode.id, definitionId: definition.id, config: {}, tags: [] };
    const direction = definition.id === "loader_1" ? "input" : "output";
    const side = EDGES.indexOf(opposite(getPlannerPorts(registry, entity, definition, direction)[0]!.edge));
    if (!allowed.includes(side)) return null;
    const rect = resolveEntityGridRect({ entity, definition });
    const axis = side % 2 === 0 ? "y" : "x";
    const value = side === 0 ? -rect.y : side === 1 ? outline.width - rect.x - rect.width
      : side === 2 ? outline.height - rect.y - rect.height : -rect.x;
    if (anchor[axis] !== undefined && anchor[axis] !== value) return null;
    anchor[axis] = value;
  }
  return anchor;
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
