import { PlannerItemRules } from "@/shared/planner-item-policy";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
import {
  areGridRectsContaining, areGridRectsIntersecting, resolveEntityGridRect, resolveGasDiffusionRangeGridRect,
} from "@/shared/geometry/power-range";
import { DELTAS, EDGES, getPlannerPorts, itemLogisticsKind, transportCapacity, ROTATIONS, type PlannerPort } from "./geometry";
import { createRecipeNode } from "./production-network";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode } from "./model";

export class PlannerPlacement {
  readonly placed: PlannerNode[] = [];
  maximumX: number | null = null;
  maximumY: number | null = null;
  auxiliaryRotation: GridRotation | null = null;
  private readonly rectangles: GridRect[] = [];
  private readonly portCells: GridPoint[] = [];

  constructor(readonly registry: RegistryContract, readonly rowWidth: number, readonly minimumX = 8, readonly minimumY = 0, readonly deviceClearance = 2, readonly escapeLength = 1) {}

  bounds(): GridRect {
    const left = Math.min(this.minimumX, ...this.rectangles.map((rect) => rect.x));
    const top = Math.min(this.minimumY, ...this.rectangles.map((rect) => rect.y));
    return {
      x: left, y: top,
      width: Math.max(left, ...this.rectangles.map((rect) => rect.x + rect.width)) - left,
      height: Math.max(top, ...this.rectangles.map((rect) => rect.y + rect.height)) - top,
    };
  }

  canPlace(node: PlannerNode, position: GridPoint, rotation: GridRotation, deviceGap = this.deviceClearance): boolean {
    const entity = { ...node.entity, position, rotation };
    const rect = resolveEntityGridRect({ entity, definition: node.definition });
    if (rect.x < this.minimumX || rect.y < this.minimumY || (this.maximumX !== null && rect.x + rect.width > this.maximumX)) return false;
    if (this.maximumY !== null && rect.y + rect.height > this.maximumY) return false;
    if (this.rectangles.some((other) => areGridRectsIntersecting(rect, other))) return false;
    if (node.purpose === "logistics" || node.purpose === "startup") {
      const clearance = { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 };
      if (this.rectangles.some((other) => areGridRectsIntersecting(clearance, other))) return false;
    }
    // 设备间预留物流通道；环境设施可放在覆盖区内部的空位。
    if (node.purpose === "production" || node.purpose === "auxiliary") {
      const gap = deviceGap;
      const corridor = { x: rect.x - gap, y: rect.y - gap, width: rect.width + gap * 2, height: rect.height + gap * 2 };
      if (this.placed.some((other, index) => (other.purpose === "production" || other.purpose === "auxiliary")
        && areGridRectsIntersecting(corridor, this.rectangles[index]!))) return false;
    }
    if (this.portCells.some((point) => containsCell(rect, point))) return false;
    const ports = ["input", "output"].flatMap((direction) => getPlannerPorts(this.registry, entity, node.definition, direction as "input" | "output"));
    // 同摆位补放设施的盒子已经固定，设备本体合法仍不足以保证端口在盒内可接。
    if (this.maximumY !== null && ports.some(port => port.outside.x < this.minimumX || port.outside.y < this.minimumY
      || port.outside.y >= this.maximumY! || this.maximumX !== null && port.outside.x >= this.maximumX)) return false;
    if (ports.some((port) => escapeCells(port, this.escapeLength).some((point) => this.rectangles.some((other) => containsCell(other, point))))) return false;
    for (let index = 0; index < this.placed.length; index++) {
      const other = this.placed[index]!;
      if (other.definition.id !== node.definition.id) continue;
      const behavior = node.definition.placementBehaviors.find((entry) => entry.type === "no-near-same-entity");
      if (behavior?.type === "no-near-same-entity") {
        const range = behavior.range;
        if (areGridRectsIntersecting({ x: rect.x - range, y: rect.y - range, width: rect.width + range * 2, height: rect.height + range * 2 }, this.rectangles[index]!)) return false;
      }
    }
    return true;
  }

  place(node: PlannerNode, position: GridPoint, rotation: GridRotation = node.entity.rotation, deviceGap = this.deviceClearance): void {
    if (!this.canPlace(node, position, rotation, deviceGap)) throw new PlannerCandidateError(`设备无法放置：${node.definition.id}`);
    node.entity.position = position;
    node.entity.rotation = rotation;
    this.placed.push(node);
    this.rectangles.push(resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
    for (const direction of ["input", "output"] as const) {
      this.portCells.push(...getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap((port) => escapeCells(port, this.escapeLength)));
    }
  }

  placeAnywhere(node: PlannerNode, rotation: GridRotation = 0, preferred?: GridPoint): void {
    if (this.auxiliaryRotation !== null && (node.purpose === "logistics" || node.purpose === "startup")) rotation = this.auxiliaryRotation;
    const height = this.bounds().height;
    let best: GridPoint | null = null;
    let bestScore = Infinity;
    for (let y = this.minimumY; y <= this.minimumY + height + node.definition.footprint.height + 16; y++) {
      for (let x = this.minimumX; x < this.minimumX + this.rowWidth; x++) {
        const point = { x, y };
        if (!this.canPlace(node, point, rotation)) continue;
        const score = preferred === undefined ? y * this.rowWidth + x : Math.abs(x - preferred.x) + Math.abs(y - preferred.y);
        if (score < bestScore) { bestScore = score; best = point; }
      }
      if (best !== null && preferred === undefined) break;
    }
    if (best === null) throw new PlannerCandidateError(`没有找到合法设备位置：${node.definition.id}`);
    this.place(node, best, rotation);
  }

  remove(nodes: readonly PlannerNode[]): void {
    const remaining = this.placed.filter(node => !nodes.includes(node));
    this.placed.splice(0, this.placed.length, ...remaining);
    this.rectangles.splice(0, this.rectangles.length, ...remaining.map(node => resolveEntityGridRect({ entity: node.entity, definition: node.definition })));
    this.portCells.splice(0, this.portCells.length, ...remaining.flatMap(node => (["input", "output"] as const)
      .flatMap(direction => getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap(port => escapeCells(port, this.escapeLength)))));
  }

  /** 同摆位重建物流时登记已通过几何检查的固定设备，不重新移动主体或套用初排间距。 */
  reserve(nodes: readonly PlannerNode[]): void {
    for (const node of nodes) {
      this.placed.push(node);
      this.rectangles.push(resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
      this.portCells.push(...(["input", "output"] as const).flatMap(direction =>
        getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap(port => escapeCells(port, this.escapeLength))));
    }
  }

  placeInEnvironment(node: PlannerNode, diffuser: PlannerNode, rotationOffset: number): boolean {
    const gas = diffuser.recipe?.gasDiffusionOutput;
    if (gas === undefined) return false;
    const range = resolveGasDiffusionRangeGridRect({ entity: diffuser.entity, definition: diffuser.definition, gasDiffusionRange: gas.range });
    if (range === null) return false;
    for (let y = Math.ceil(range.y); y < range.y + range.height; y++) {
      for (let x = Math.max(this.minimumX, Math.ceil(range.x)); x < range.x + range.width; x++) {
        for (let turn = 0; turn < 4; turn++) {
          const rotation = ROTATIONS[(turn + rotationOffset) % 4]!;
          const entity = { ...node.entity, position: { x, y }, rotation };
          if (!areGridRectsContaining(range, resolveEntityGridRect({ entity, definition: node.definition }))) continue;
          if (this.canPlace(node, entity.position, rotation, 1)) { this.place(node, entity.position, rotation, 1); return true; }
        }
      }
    }
    return false;
  }
}

/** 优先使用用户给定的环境设施，放不下时再增加；每一台均遵守同类间距。 */
export async function placeProduction(
  registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement, variant: number, checkBudget: () => void = () => {},
  environmentLimits?: ReadonlyMap<string, number>,
): Promise<void> {
  const environments = network.nodes.filter((node) => node.purpose === "environment");
  for (const node of environments) if (!placement.placed.includes(node)) placeEnvironmentStation(node, placement);
  const producedItems = new Set(network.nodes.flatMap(node => node.outputs.map(output => output.itemId)));
  const itemRules = new PlannerItemRules(registry, network.request.options);
  const warehouseRate = (node: PlannerNode) => node.inputs
    .filter(input => !producedItems.has(input.itemId) && itemRules.supply(input.itemId) === "warehouse" && itemLogisticsKind(registry, input.itemId) === "belt")
    .reduce((sum, input) => sum + input.perMinute, 0);
  let warehouseLane = 0;
  for (const node of [...network.nodes].sort((left, right) => Number(right.recipe?.requiredGasDiffusion !== undefined) - Number(left.recipe?.requiredGasDiffusion !== undefined)
    || Number(warehouseRate(right) > 0) - Number(warehouseRate(left) > 0)
    || Number(right.definition.id === "seedcol_1") - Number(left.definition.id === "seedcol_1"))) {
    const rawRate = warehouseRate(node);
    const warehousePosition = rawRate > 0 ? { x: placement.minimumX, y: Math.max(placement.minimumY, warehouseLane * 4) } : undefined;
    warehouseLane += Math.ceil(rawRate / transportCapacity("belt") - 1e-6);
    if (placement.placed.includes(node)) continue;
    checkBudget();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const requiredGas = node.recipe?.requiredGasDiffusion;
    if (requiredGas === undefined) {
      const picker = (node.definition.id === "planter_1" || node.definition.id === "planter_1_liquid")
        ? placement.placed.find((entry) => entry.definition.id === "seedcol_1" && entry.outputs.some((output) => node.inputs.some((input) => input.itemId === output.itemId))) : undefined;
      const preferred = picker === undefined ? undefined : picker.entity.rotation === 90 || picker.entity.rotation === 270 ? {
        x: picker.entity.position.x, y: picker.entity.position.y + picker.definition.footprint.height + placement.deviceClearance,
      } : {
        x: picker.entity.position.x + picker.definition.footprint.width + placement.deviceClearance, y: picker.entity.position.y,
      };
      // 植物循环保留短回流的局部朝向，整体位置与排列宽度仍参与搜索。
      const rotation = picker === undefined ? (node.definition.id === "seedcol_1" ? 0 : flowRotation(registry, node, variant))
        : ((picker.entity.rotation + 180) % 360) as GridRotation;
      // 直线仓库的首道工序沿取货口排列，后续工序再向右展开。
      placement.placeAnywhere(node, rotation, warehousePosition ?? preferred);
      continue;
    }
    const supplied = environments.some((diffuser) => diffuser.recipe?.gasDiffusionOutput?.gasItemId === requiredGas
      && placement.placeInEnvironment(node, diffuser, flowRotation(registry, node, variant) / 90));
    if (supplied) continue;
    const recipe = environments.find((entry) => entry.recipe?.gasDiffusionOutput?.gasItemId === requiredGas)?.recipe
      ?? registry.recipeDefinitions.find((entry) => entry.gasDiffusionOutput?.gasItemId === requiredGas);
    if (recipe === undefined) throw new PlannerCandidateError(`气体环境缺少配方：${requiredGas}`);
    const limit = environmentLimits?.get(requiredGas);
    if (limit !== undefined && environments.filter(entry => entry.recipe?.gasDiffusionOutput?.gasItemId === requiredGas).length >= limit) {
      throw new PlannerCandidateError(`本轮减少环境设施后暂未找到共用覆盖：${requiredGas}`);
    }
    let sequence = network.nodes.length;
    while (network.nodes.some(entry => entry.entity.id === `eda-environment-${sequence}`)) sequence++;
    const diffuser = createRecipeNode(registry, recipe, `eda-environment-${sequence}`, 60 / recipe.durationSeconds, "environment");
    network.nodes.push(diffuser); environments.push(diffuser);
    placeEnvironmentStation(diffuser, placement);
    if (!placement.placeInEnvironment(node, diffuser, flowRotation(registry, node, variant) / 90)) throw new PlannerCandidateError(`无法覆盖设备的气体环境：${node.definition.id}`);
  }
}

/** 只裁撤其覆盖可由其他设施完整接替的实体；随后由调用方重建供料与物流。 */
export function redundantEnvironmentStations(network: PlannerNetwork): PlannerNode[] {
  const retained = network.nodes.filter(node => node.purpose === "environment");
  const consumers = network.nodes.filter(node => node.recipe?.requiredGasDiffusion);
  const removed: PlannerNode[] = [];
  for (const station of [...retained].reverse()) {
    const alternatives = retained.filter(node => node !== station);
    const gasItemId = station.recipe!.gasDiffusionOutput!.gasItemId;
    const covered = consumers.filter(node => node.recipe!.requiredGasDiffusion === gasItemId).every(node => alternatives.some(other => {
      const gas = other.recipe!.gasDiffusionOutput!;
      if (gas.gasItemId !== gasItemId) return false;
      const range = resolveGasDiffusionRangeGridRect({ entity: other.entity, definition: other.definition, gasDiffusionRange: gas.range });
      return range !== null && areGridRectsContaining(range, resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
    }));
    if (covered) { retained.splice(retained.indexOf(station), 1); removed.push(station); }
  }
  return removed;
}

function placeEnvironmentStation(node: PlannerNode, placement: PlannerPlacement): void {
  const range = node.recipe!.gasDiffusionOutput!.range;
  const inset = Math.floor((range - node.definition.footprint.width) / 2);
  const bounds = placement.bounds();
  // AI-REMOVED 2026-10-03:
  // Reason: 固定步长遗漏合法位置，19 格宽的初排仅检查越界的 x=18。
  // Trigger: 用户任务 eda2.json 在零提案时失败。
  // Evidence: 同一空布局中 x=12 可放，原循环未枚举。
  // Replacement: 下方完整整数坐标与朝向搜索；Risk: 初排检查量增加；Human Review: Required。
  // Original code:
  //   for (let y = placement.minimumY + inset; y <= placement.minimumY + bounds.height + range * 2; y += range + 2) {
  //     for (let x = placement.minimumX + Math.max(inset, placement.rowWidth - inset); x >= placement.minimumX + inset; x -= range + 2) {
  //       if (placement.canPlace(node, { x, y }, 0)) { placement.place(node, { x, y }, 0); return; }
  //     }
  //   }
  const left = placement.minimumX;
  const right = Math.min(left + placement.rowWidth, placement.maximumX ?? Infinity) - node.definition.footprint.width;
  const preferredX = Math.min(right, left + Math.max(inset, placement.rowWidth - inset));
  const xs = Array.from({ length: Math.max(0, right - left + 1) }, (_, index) => left + index)
    .sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
  const ys = Array.from({ length: bounds.height + range * 2 + 1 }, (_, index) => placement.minimumY + index)
    .sort((a, b) => Math.abs(a - placement.minimumY - inset) - Math.abs(b - placement.minimumY - inset));
  for (const y of ys) {
    for (const x of xs) for (const rotation of ROTATIONS) {
      if (placement.canPlace(node, { x, y }, rotation)) { placement.place(node, { x, y }, rotation); return; }
    }
  }
  throw new PlannerCandidateError("无法放置满足间距的气体环境设施。");
}

/** 初排让实际加工端口沿工序方向，运行消耗口留给侧向管道。 */
function flowRotation(registry: RegistryContract, node: PlannerNode, variant: number): GridRotation {
  const scores = ROTATIONS.map(rotation => {
    const entity = { ...node.entity, rotation };
    const score = (["input", "output"] as const).reduce((total, direction) => {
      const flows = direction === "input" ? node.inputs : node.outputs;
      return total + flows.reduce((sum, flow) => {
        const ports = getPlannerPorts(registry, entity, node.definition, direction, flow.itemId, flow.storageGroupIds);
        return sum + ports.reduce((value, port) => value + (port.outside.x - port.cell.x) * (direction === "input" ? -1 : 1), 0) / Math.max(1, ports.length) * flow.perMinute;
      }, 0);
    }, 0);
    return { rotation, score };
  });
  scores.sort((a, b) => b.score - a.score || ((a.rotation / 90 + variant) % 4) - ((b.rotation / 90 + variant) % 4));
  return scores[0]!.rotation;
}

export function createPlainNode(registry: RegistryContract, definitionId: string, id: string, purpose: PlannerNode["purpose"]): PlannerNode {
  const definition = registry.queries.findEntityDefinition(definitionId);
  if (definition === null) throw new Error(`设备未注册：${definitionId}`);
  const entity: WorldEntity = { id, definitionId, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };
  return { entity, definition, recipe: null, purpose, inputs: [], outputs: [] };
}

function containsCell(rect: GridRect, point: GridPoint): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

function escapeCells(port: PlannerPort, length: number): GridPoint[] {
  const delta = DELTAS[EDGES.indexOf(port.edge)]!;
  return Array.from({ length }, (_, step) => ({ x: port.outside.x + delta.x * step, y: port.outside.y + delta.y * step }));
}
