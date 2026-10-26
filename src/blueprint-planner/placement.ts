import { findEntityRange } from "@/shared/geometry/entity-range";
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

  /** 没有下游物流的收货终点只预留入口，自动提交不产生物理出线需求。 */
  private requiredPorts(node: PlannerNode, entity = node.entity): PlannerPort[] {
    return (["input", "output"] as const).flatMap(direction => direction === "output" && node.outputs.length === 0
      && (node.purpose === "product" || node.purpose === "byproduct") ? []
      : getPlannerPorts(this.registry, entity, node.definition, direction));
  }

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
    // AI-REMOVED 2026-10-11:
    // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
    // Trigger: 用户要求允许中心放置且全部出口堵死。
    // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
    // Replacement:     const ports = this.requiredPorts(node, entity);
    // Risk: 旧任务必须重新验收；Human Review: Required。
    // Original code:
    // const ports = ["input", "output"].flatMap((direction) => getPlannerPorts(this.registry, entity, node.definition, direction as "input" | "output"));
    const ports = this.requiredPorts(node, entity);
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
    // AI-REMOVED 2026-10-11:
    // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
    // Trigger: 用户要求允许中心放置且全部出口堵死。
    // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
    // Replacement:     this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
    // Risk: 旧任务必须重新验收；Human Review: Required。
    // Original code:
    // for (const direction of ["input", "output"] as const) {
    //   this.portCells.push(...getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap((port) => escapeCells(port, this.escapeLength)));
    // }
    this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
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
    // AI-REMOVED 2026-10-11:
    // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
    // Trigger: 用户要求允许中心放置且全部出口堵死。
    // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
    // Replacement:     this.portCells.splice(0, this.portCells.length, ...remaining.flatMap(node => this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength))));
    // Risk: 旧任务必须重新验收；Human Review: Required。
    // Original code:
    // this.portCells.splice(0, this.portCells.length, ...remaining.flatMap(node => (["input", "output"] as const)
    //   .flatMap(direction => getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap(port => escapeCells(port, this.escapeLength)))));
    this.portCells.splice(0, this.portCells.length, ...remaining.flatMap(node => this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength))));
  }

  /** 同摆位重建物流时登记已通过几何检查的固定设备，不重新移动主体或套用初排间距。 */
  reserve(nodes: readonly PlannerNode[]): void {
    for (const node of nodes) {
      this.placed.push(node);
      this.rectangles.push(resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
      // AI-REMOVED 2026-10-11:
      // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
      // Trigger: 用户要求允许中心放置且全部出口堵死。
      // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
      // Replacement:       this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
      // Risk: 旧任务必须重新验收；Human Review: Required。
      // Original code:
      // this.portCells.push(...(["input", "output"] as const).flatMap(direction =>
      //   getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap(port => escapeCells(port, this.escapeLength))));
      this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
    }
  }

  placeInEnvironment(node: PlannerNode, diffuser: PlannerNode, rotationOffset: number): boolean {
    const gas = diffuser.recipe?.environmentOutput;
    if (gas === undefined) return false;
    const range = resolveGasDiffusionRangeGridRect({ entity: diffuser.entity, definition: diffuser.definition, rangeId: gas.rangeId });
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
  for (const node of [...network.nodes].sort((left, right) => Number(right.recipe?.requiredEnvironmentAnyOf?.[0] !== undefined) - Number(left.recipe?.requiredEnvironmentAnyOf?.[0] !== undefined)
    || Number(warehouseRate(right) > 0) - Number(warehouseRate(left) > 0)
    || Number(right.definition.id === "seedcol_1") - Number(left.definition.id === "seedcol_1"))) {
    const rawRate = warehouseRate(node);
    const warehousePosition = rawRate > 0 ? { x: placement.minimumX, y: Math.max(placement.minimumY, warehouseLane * 4) } : undefined;
    warehouseLane += Math.ceil(rawRate / transportCapacity("belt") - 1e-6);
    if (placement.placed.includes(node)) continue;
    checkBudget();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const requiredGas = node.recipe?.requiredEnvironmentAnyOf?.[0];
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
    const supplied = environments.some((diffuser) => diffuser.recipe?.environmentOutput?.itemId === requiredGas
      && placement.placeInEnvironment(node, diffuser, flowRotation(registry, node, variant) / 90));
    if (supplied) continue;
    const recipe = environments.find((entry) => entry.recipe?.environmentOutput?.itemId === requiredGas)?.recipe
      ?? registry.recipeDefinitions.find((entry) => entry.environmentOutput?.itemId === requiredGas);
    if (recipe === undefined) throw new PlannerCandidateError(`气体环境缺少配方：${requiredGas}`);
    const limit = environmentLimits?.get(requiredGas);
    if (limit !== undefined && environments.filter(entry => entry.recipe?.environmentOutput?.itemId === requiredGas).length >= limit) {
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
  const consumers = network.nodes.filter(node => node.recipe?.requiredEnvironmentAnyOf?.[0]);
  const removed: PlannerNode[] = [];
  for (const station of [...retained].reverse()) {
    const alternatives = retained.filter(node => node !== station);
    const itemId = station.recipe!.environmentOutput!.itemId;
    const covered = consumers.filter(node => node.recipe!.requiredEnvironmentAnyOf?.[0] === itemId).every(node => alternatives.some(other => {
      const gas = other.recipe!.environmentOutput!;
      if (gas.itemId !== itemId) return false;
      const range = resolveGasDiffusionRangeGridRect({ entity: other.entity, definition: other.definition, rangeId: gas.rangeId });
      return range !== null && areGridRectsContaining(range, resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
    }));
    if (covered) { retained.splice(retained.indexOf(station), 1); removed.push(station); }
  }
  return removed;
}

function placeEnvironmentStation(node: PlannerNode, placement: PlannerPlacement): void {
  const localRect = findEntityRange(node.definition, node.recipe!.environmentOutput!.rangeId).localRect;
  const range = Math.max(localRect.width, localRect.height);
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

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 474725fdf9494389336c74b91ddd6724e2c4a441c330fcbb2af26cc901d3395d。
// Replacement: src/blueprint-planner/placement.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/placement.ts):
// import { findEntityRange } from "@/shared/geometry/entity-range";
// import { PlannerItemRules } from "@/shared/planner-item-policy";
// import type { WorldEntity } from "@/domain/document/world-document";
// import type { RegistryContract } from "@/domain/registry/registry-contract";
// import type { GridPoint, GridRect, GridRotation } from "@/domain/shared/grid";
// import {
//   areGridRectsContaining, areGridRectsIntersecting, resolveEntityGridRect, resolveGasDiffusionRangeGridRect,
// } from "@/shared/geometry/power-range";
// import { DELTAS, EDGES, getPlannerPorts, itemLogisticsKind, transportCapacity, ROTATIONS, type PlannerPort } from "./geometry";
// import { createRecipeNode } from "./production-network";
// import { PlannerCandidateError, type PlannerNetwork, type PlannerNode } from "./model";
//
// export class PlannerPlacement {
//   readonly placed: PlannerNode[] = [];
//   /** 初排供需分组供终端聚类复用；不作为后续移动或验收的硬约束。 */
//   readonly environmentGroups = new Map<string, string>();
//   maximumX: number | null = null;
//   maximumY: number | null = null;
//   auxiliaryRotation: GridRotation | null = null;
//   private readonly rectangles: GridRect[] = [];
//   private readonly portCells: GridPoint[] = [];
//
//   constructor(readonly registry: RegistryContract, readonly rowWidth: number, readonly minimumX = 8, readonly minimumY = 0, readonly deviceClearance = 2, readonly escapeLength = 1) {}
//
//   /** 没有下游物流的收货终点只预留入口，自动提交不产生物理出线需求。 */
//   private requiredPorts(node: PlannerNode, entity = node.entity): PlannerPort[] {
//     return (["input", "output"] as const).flatMap(direction => direction === "output" && node.outputs.length === 0
//       && (node.purpose === "product" || node.purpose === "byproduct") ? []
//       : getPlannerPorts(this.registry, entity, node.definition, direction));
//   }
//
//   /** 初排允许遮住未使用的冗余端口，但每种实际物料必须仍有足够的独立端口运力。 */
//   private portsAvailable(node: PlannerNode, entity: WorldEntity, extra?: GridRect): boolean {
//     const available = (port: PlannerPort) => !(this.maximumY !== null && (port.outside.x < this.minimumX || port.outside.y < this.minimumY
//       || port.outside.y >= this.maximumY || this.maximumX !== null && port.outside.x >= this.maximumX))
//       && !escapeCells(port, this.escapeLength).some(point => extra && containsCell(extra, point)
//         || this.rectangles.some((rect, index) => this.placed[index] !== node && containsCell(rect, point)));
//     if (node.inputs.length === 0 && node.outputs.length === 0) return this.requiredPorts(node, entity).every(available);
//     for (const direction of ["input", "output"] as const) {
//       const remaining = new Map<string, number>();
//       const fluidItems = new Map<string, string>();
//       for (const flow of direction === "input" ? node.inputs : node.outputs) {
//         let needed = flow.perMinute;
//         for (const port of getPlannerPorts(this.registry, entity, node.definition, direction, flow.itemId, flow.storageGroupIds)) {
//           if (!available(port)) continue;
//           const key = `${port.groupIndex}/${port.portIndex}`;
//           if (port.kind === "pipe" && fluidItems.has(key) && fluidItems.get(key) !== flow.itemId) continue;
//           const capacity = remaining.get(key) ?? transportCapacity(port.kind), amount = Math.min(capacity, needed);
//           if (port.kind === "pipe" && amount > 0) fluidItems.set(key, flow.itemId);
//           remaining.set(key, capacity - amount); needed -= amount;
//           if (needed <= 1e-6) break;
//         }
//         if (needed > 1e-6) return false;
//       }
//     }
//     return true;
//   }
//
//   bounds(): GridRect {
//     const left = Math.min(this.minimumX, ...this.rectangles.map((rect) => rect.x));
//     const top = Math.min(this.minimumY, ...this.rectangles.map((rect) => rect.y));
//     return {
//       x: left, y: top,
//       width: Math.max(left, ...this.rectangles.map((rect) => rect.x + rect.width)) - left,
//       height: Math.max(top, ...this.rectangles.map((rect) => rect.y + rect.height)) - top,
//     };
//   }
//
//   canPlace(node: PlannerNode, position: GridPoint, rotation: GridRotation, deviceGap = this.deviceClearance): boolean {
//     const entity = { ...node.entity, position, rotation };
//     const rect = resolveEntityGridRect({ entity, definition: node.definition });
//     if (rect.x < this.minimumX || rect.y < this.minimumY || (this.maximumX !== null && rect.x + rect.width > this.maximumX)) return false;
//     if (this.maximumY !== null && rect.y + rect.height > this.maximumY) return false;
//     if (this.rectangles.some((other) => areGridRectsIntersecting(rect, other))) return false;
//     if (node.purpose === "logistics" || node.purpose === "startup") {
//       const clearance = { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 };
//       if (this.rectangles.some((other) => areGridRectsIntersecting(clearance, other))) return false;
//     }
//     // 设备间预留物流通道；环境设施可放在覆盖区内部的空位。
//     if (node.purpose === "production" || node.purpose === "auxiliary") {
//       const gap = deviceGap;
//       const corridor = { x: rect.x - gap, y: rect.y - gap, width: rect.width + gap * 2, height: rect.height + gap * 2 };
//       if (this.placed.some((other, index) => (other.purpose === "production" || other.purpose === "auxiliary")
//         && areGridRectsIntersecting(corridor, this.rectangles[index]!))) return false;
//     }
//     if (this.portCells.some((point) => containsCell(rect, point))
//       && this.placed.some(other => !this.portsAvailable(other, other.entity, rect))) return false;
//     // AI-REMOVED 2026-10-11:
//     // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
//     // Trigger: 用户要求允许中心放置且全部出口堵死。
//     // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
//     // Replacement:     const ports = this.requiredPorts(node, entity);
//     // Risk: 旧任务必须重新验收；Human Review: Required。
//     // Original code:
//     // const ports = ["input", "output"].flatMap((direction) => getPlannerPorts(this.registry, entity, node.definition, direction as "input" | "output"));
//     const ports = this.requiredPorts(node, entity);
//     // 同摆位补放设施的盒子已经固定，设备本体合法仍不足以保证端口在盒内可接。
//     if ((this.maximumY !== null || ports.some(port => escapeCells(port, this.escapeLength)
//       .some(point => this.rectangles.some(other => containsCell(other, point))))) && !this.portsAvailable(node, entity)) return false;
//     for (let index = 0; index < this.placed.length; index++) {
//       const other = this.placed[index]!;
//       if (other.definition.id !== node.definition.id) continue;
//       const behavior = node.definition.placementBehaviors.find((entry) => entry.type === "no-near-same-entity");
//       if (behavior?.type === "no-near-same-entity") {
//         const range = behavior.range;
//         if (areGridRectsIntersecting({ x: rect.x - range, y: rect.y - range, width: rect.width + range * 2, height: rect.height + range * 2 }, this.rectangles[index]!)) return false;
//       }
//     }
//     return true;
//   }
//
//   place(node: PlannerNode, position: GridPoint, rotation: GridRotation = node.entity.rotation, deviceGap = this.deviceClearance): void {
//     if (!this.canPlace(node, position, rotation, deviceGap)) throw new PlannerCandidateError(`设备无法放置：${node.definition.id}`);
//     node.entity.position = position;
//     node.entity.rotation = rotation;
//     this.placed.push(node);
//     this.rectangles.push(resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
//     // AI-REMOVED 2026-10-11:
//     // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
//     // Trigger: 用户要求允许中心放置且全部出口堵死。
//     // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
//     // Replacement:     this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
//     // Risk: 旧任务必须重新验收；Human Review: Required。
//     // Original code:
//     // for (const direction of ["input", "output"] as const) {
//     //   this.portCells.push(...getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap((port) => escapeCells(port, this.escapeLength)));
//     // }
//     this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
//   }
//
//   placeAnywhere(node: PlannerNode, rotation: GridRotation = 0, preferred?: GridPoint, rotate = false): void {
//     if (this.auxiliaryRotation !== null && (node.purpose === "logistics" || node.purpose === "startup")) rotation = this.auxiliaryRotation;
//     const height = this.bounds().height;
//     let best: GridPoint | null = null;
//     let bestRotation = rotation;
//     let bestScore = Infinity;
//     for (let y = this.minimumY; y <= this.minimumY + height + node.definition.footprint.height + 16; y++) {
//       for (let x = this.minimumX; x < this.minimumX + this.rowWidth; x++) {
//         const point = { x, y };
//         for (const turn of rotate ? ROTATIONS.map(value => ((rotation + value) % 360) as GridRotation) : [rotation]) {
//           if (!this.canPlace(node, point, turn)) continue;
//           const score = preferred === undefined ? y * this.rowWidth + x : Math.abs(x - preferred.x) + Math.abs(y - preferred.y);
//           if (score < bestScore) { bestScore = score; best = point; bestRotation = turn; }
//         }
//       }
//       if (best !== null && preferred === undefined) break;
//     }
//     if (best === null) throw new PlannerCandidateError(`没有找到合法设备位置：${node.definition.id}`);
//     this.place(node, best, bestRotation);
//   }
//
//   remove(nodes: readonly PlannerNode[]): void {
//     const remaining = this.placed.filter(node => !nodes.includes(node));
//     this.placed.splice(0, this.placed.length, ...remaining);
//     this.rectangles.splice(0, this.rectangles.length, ...remaining.map(node => resolveEntityGridRect({ entity: node.entity, definition: node.definition })));
//     // AI-REMOVED 2026-10-11:
//     // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
//     // Trigger: 用户要求允许中心放置且全部出口堵死。
//     // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
//     // Replacement:     this.portCells.splice(0, this.portCells.length, ...remaining.flatMap(node => this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength))));
//     // Risk: 旧任务必须重新验收；Human Review: Required。
//     // Original code:
//     // this.portCells.splice(0, this.portCells.length, ...remaining.flatMap(node => (["input", "output"] as const)
//     //   .flatMap(direction => getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap(port => escapeCells(port, this.escapeLength)))));
//     this.portCells.splice(0, this.portCells.length, ...remaining.flatMap(node => this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength))));
//   }
//
//   /** 同摆位重建物流时登记已通过几何检查的固定设备，不重新移动主体或套用初排间距。 */
//   reserve(nodes: readonly PlannerNode[]): void {
//     for (const node of nodes) {
//       this.placed.push(node);
//       this.rectangles.push(resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
//       // AI-REMOVED 2026-10-11:
//       // Reason: 协议储存箱通电后周期提交，无需物理排空出口。
//       // Trigger: 用户要求允许中心放置且全部出口堵死。
//       // Evidence: r_warehouse_submit 每 10 秒提交；原排空夹具错误约束布局与验收。
//       // Replacement:       this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
//       // Risk: 旧任务必须重新验收；Human Review: Required。
//       // Original code:
//       // this.portCells.push(...(["input", "output"] as const).flatMap(direction =>
//       //   getPlannerPorts(this.registry, node.entity, node.definition, direction).flatMap(port => escapeCells(port, this.escapeLength))));
//       this.portCells.push(...this.requiredPorts(node).flatMap(port => escapeCells(port, this.escapeLength)));
//     }
//   }
//
//   placeInEnvironment(node: PlannerNode, diffuser: PlannerNode, rotationOffset: number): boolean {
//     const gas = diffuser.recipe?.environmentOutput;
//     if (gas === undefined) return false;
//     const range = resolveGasDiffusionRangeGridRect({ entity: diffuser.entity, definition: diffuser.definition, rangeId: gas.rangeId });
//     if (range === null) return false;
//     // 2026-10-16：先检查覆盖区四角，保留中部可供上游设备及物流穿行的空间；随后仍枚举全部位置。
//     const positions = new Map<string, GridPoint>();
//     for (const rotation of ROTATIONS) {
//       const size = resolveEntityGridRect({ entity: { ...node.entity, rotation }, definition: node.definition });
//       for (const y of [Math.ceil(range.y), Math.floor(range.y + range.height - size.height)]) {
//         for (const x of [Math.ceil(range.x), Math.floor(range.x + range.width - size.width)]) positions.set(`${x}/${y}`, { x, y });
//       }
//     }
//     for (let y = Math.ceil(range.y); y < range.y + range.height; y++) {
//       for (let x = Math.max(this.minimumX, Math.ceil(range.x)); x < range.x + range.width; x++) positions.set(`${x}/${y}`, { x, y });
//     }
//     for (const { x, y } of positions.values()) {
//         // 2026-10-16：环境组的固体进料朝向中心、产物朝外，为覆盖区中部的上游设备留出短线；同分保留原朝向轮换。
//         const centerX = range.x + range.width / 2, centerY = range.y + range.height / 2;
//         const rotations = ROTATIONS.map((_, turn) => ROTATIONS[(turn + rotationOffset) % 4]!).map(rotation => {
//           const entity = { ...node.entity, position: { x, y }, rotation };
//           const rect = resolveEntityGridRect({ entity, definition: node.definition });
//           const score = (["input", "output"] as const).reduce((sum, direction) => sum
//             + getPlannerPorts(this.registry, entity, node.definition, direction).filter(port => port.kind === "belt")
//               .reduce((total, port) => total + ((port.outside.x - port.cell.x) * (centerX - rect.x - rect.width / 2)
//                 + (port.outside.y - port.cell.y) * (centerY - rect.y - rect.height / 2) * 1.01) * (direction === "input" ? 1 : -1), 0), 0);
//           return { rotation, score };
//         }).sort((a, b) => b.score - a.score);
//         for (let turn = 0; turn < 4; turn++) {
//           const rotation = rotations[turn]!.rotation;
//           const entity = { ...node.entity, position: { x, y }, rotation };
//           if (!areGridRectsContaining(range, resolveEntityGridRect({ entity, definition: node.definition }))) continue;
//           if (this.canPlace(node, entity.position, rotation, 1)) { this.place(node, entity.position, rotation, 1); return true; }
//         }
//     }
//     return false;
//   }
// }
//
// /** 优先使用用户给定的环境设施，放不下时再增加；每一台均遵守同类间距。 */
// export async function placeProduction(
//   registry: RegistryContract, network: PlannerNetwork, placement: PlannerPlacement, variant: number, checkBudget: () => void = () => {},
//   environmentLimits?: ReadonlyMap<string, number>,
// ): Promise<void> {
//   const environments = network.nodes.filter((node) => node.purpose === "environment");
//   for (const node of environments) if (!placement.placed.includes(node)) placeEnvironmentStation(node, placement, variant);
//   const producedItems = new Set(network.nodes.flatMap(node => node.outputs.map(output => output.itemId)));
//   const itemRules = new PlannerItemRules(registry, network.request.options);
//   const warehouseRate = (node: PlannerNode) => node.inputs
//     .filter(input => !producedItems.has(input.itemId) && itemRules.supply(input.itemId) === "warehouse" && itemLogisticsKind(registry, input.itemId) === "belt")
//     .reduce((sum, input) => sum + input.perMinute, 0);
//   let warehouseLane = 0;
//   const pickerLoads = new Map<string, number>();
//   let environmentGroups: Map<PlannerNode, PlannerNode> | undefined;
//   const directlyFeedsEnvironment = (node: PlannerNode) => network.nodes.some(other => other.recipe?.requiredEnvironmentAnyOf?.length
//     && node.outputs.some(output => other.inputs.some(input => input.itemId === output.itemId)));
//   for (const node of [...network.nodes].sort((left, right) => Number(right.recipe?.requiredEnvironmentAnyOf?.[0] !== undefined) - Number(left.recipe?.requiredEnvironmentAnyOf?.[0] !== undefined)
//     || Number(warehouseRate(right) > 0) - Number(warehouseRate(left) > 0)
//     || Number(directlyFeedsEnvironment(right)) - Number(directlyFeedsEnvironment(left))
//     || Number(right.definition.id === "seedcol_1") - Number(left.definition.id === "seedcol_1"))) {
//     const rawRate = warehouseRate(node);
//     const warehousePosition = rawRate > 0 ? { x: placement.minimumX, y: Math.max(placement.minimumY, warehouseLane * 4) } : undefined;
//     warehouseLane += Math.ceil(rawRate / transportCapacity("belt") - 1e-6);
//     if (placement.placed.includes(node)) continue;
//     checkBudget();
//     await new Promise<void>((resolve) => setTimeout(resolve, 0));
//     const requiredGas = node.recipe?.requiredEnvironmentAnyOf?.[0];
//     if (requiredGas === undefined) {
//       environmentGroups ??= groupEnvironmentProduction(network);
//       const environment = environmentGroups.get(node);
//       const picker = (node.definition.id === "planter_1" || node.definition.id === "planter_1_liquid")
//         ? placement.placed.filter((entry) => entry.definition.id === "seedcol_1" && (!environment || environmentGroups!.get(entry) === environment)
//           && entry.outputs.some((output) => node.inputs.some((input) => input.itemId === output.itemId)))
//           .sort((a, b) => (pickerLoads.get(a.entity.id) ?? 0) - (pickerLoads.get(b.entity.id) ?? 0))[0] : undefined;
//       // 2026-10-16：同类循环在多个采种机之间分配，避免所有种植机都以第一台为初排锚点。
//       if (picker) pickerLoads.set(picker.entity.id, (pickerLoads.get(picker.entity.id) ?? 0) + 1);
//       const preferred = picker === undefined ? undefined : picker.entity.rotation === 90 || picker.entity.rotation === 270 ? {
//         x: picker.entity.position.x, y: picker.entity.position.y + picker.definition.footprint.height + placement.deviceClearance,
//       } : {
//         x: picker.entity.position.x + picker.definition.footprint.width + placement.deviceClearance, y: picker.entity.position.y,
//       };
//       // 植物循环保留短回流的局部朝向，整体位置与排列宽度仍参与搜索。
//       const rotation = picker === undefined ? (node.definition.id === "seedcol_1" ? 0 : flowRotation(registry, node, variant))
//         : ((picker.entity.rotation + 180) % 360) as GridRotation;
//       // 直线仓库的首道工序沿取货口排列，后续工序再向右展开。
//       const downstream = placement.placed.filter(other => other.recipe?.requiredEnvironmentAnyOf?.length && (!environment || environmentGroups!.get(other) === environment)
//         && node.outputs.some(output => other.inputs.some(input => input.itemId === output.itemId)));
//       const downstreamCenter = downstream.length ? {
//         x: Math.round(downstream.reduce((sum, other) => sum + other.entity.position.x + other.definition.footprint.width / 2, 0) / downstream.length - node.definition.footprint.width / 2),
//         y: Math.round(downstream.reduce((sum, other) => sum + other.entity.position.y + other.definition.footprint.height / 2, 0) / downstream.length - node.definition.footprint.height / 2),
//       } : undefined;
//       placement.placeAnywhere(node, rotation, warehousePosition ?? preferred ?? downstreamCenter ?? environment?.entity.position, environment !== undefined);
//       continue;
//     }
//     const supplied = environments.some((diffuser) => diffuser.recipe?.environmentOutput?.itemId === requiredGas
//       && placement.placeInEnvironment(node, diffuser, flowRotation(registry, node, variant) / 90));
//     if (supplied) continue;
//     const recipe = environments.find((entry) => entry.recipe?.environmentOutput?.itemId === requiredGas)?.recipe
//       ?? registry.recipeDefinitions.find((entry) => entry.environmentOutput?.itemId === requiredGas);
//     if (recipe === undefined) throw new PlannerCandidateError(`气体环境缺少配方：${requiredGas}`);
//     const limit = environmentLimits?.get(requiredGas);
//     if (limit !== undefined && environments.filter(entry => entry.recipe?.environmentOutput?.itemId === requiredGas).length >= limit) {
//       throw new PlannerCandidateError(`本轮减少环境设施后暂未找到共用覆盖：${requiredGas}`);
//     }
//     let sequence = network.nodes.length;
//     while (network.nodes.some(entry => entry.entity.id === `eda-environment-${sequence}`)) sequence++;
//     const diffuser = createRecipeNode(registry, recipe, `eda-environment-${sequence}`, 60 / recipe.durationSeconds, "environment");
//     network.nodes.push(diffuser); environments.push(diffuser);
//     placeEnvironmentStation(diffuser, placement, variant);
//     if (!placement.placeInEnvironment(node, diffuser, flowRotation(registry, node, variant) / 90)) throw new PlannerCandidateError(`无法覆盖设备的气体环境：${node.definition.id}`);
//   }
//   placement.environmentGroups.clear();
//   for (const [node, environment] of groupEnvironmentProduction(network)) placement.environmentGroups.set(node.entity.id, environment.entity.id);
// }
//
// /** 沿供需关系向上游分摊同配方设备；仅影响初排锚点，后续布局及连接仍可独立搜索。 */
// function groupEnvironmentProduction(network: PlannerNetwork): Map<PlannerNode, PlannerNode> {
//   const environments = network.nodes.filter(node => node.recipe?.environmentOutput);
//   const groups = new Map<PlannerNode, PlannerNode>();
//   if (environments.length < 2) return groups;
//   for (const node of network.nodes) if (node.recipe?.requiredEnvironmentAnyOf?.length) {
//     const environment = environments.find(other => {
//       const gas = other.recipe!.environmentOutput!;
//       if (!node.recipe!.requiredEnvironmentAnyOf!.includes(gas.itemId)) return false;
//       const range = resolveGasDiffusionRangeGridRect({ entity: other.entity, definition: other.definition, rangeId: gas.rangeId });
//       return range !== null && areGridRectsContaining(range, resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
//     });
//     if (environment) groups.set(node, environment);
//   }
//   const pending = new Map<string, PlannerNode[]>();
//   for (const node of network.nodes) if (node.recipe && !node.recipe.environmentOutput && !groups.has(node)) {
//     const entries = pending.get(node.recipe.id) ?? [];
//     entries.push(node); pending.set(node.recipe.id, entries);
//   }
//   for (let pass = 0; pass < network.nodes.length && pending.size; pass++) {
//     let changed = false;
//     for (const [recipe, nodes] of pending) {
//       const weights = environments.map(environment => [...groups].filter(([, group]) => group === environment)
//         .reduce((sum, [consumer]) => sum + consumer.inputs.filter(input => nodes[0]!.outputs.some(output => output.itemId === input.itemId))
//           .reduce((total, input) => total + input.perMinute, 0), 0));
//       const total = weights.reduce((sum, weight) => sum + weight, 0);
//       if (!total) continue;
//       const counts = weights.map(() => 0);
//       for (const node of nodes) {
//         const index = weights.map((weight, i) => ({ i, remaining: weight / total * nodes.length - counts[i]! }))
//           .sort((a, b) => b.remaining - a.remaining)[0]!.i;
//         groups.set(node, environments[index]!); counts[index]!++;
//       }
//       pending.delete(recipe); changed = true;
//     }
//     if (!changed) break;
//   }
//   return groups;
// }
//
// /** 只裁撤其覆盖可由其他设施完整接替的实体；随后由调用方重建供料与物流。 */
// export function redundantEnvironmentStations(network: PlannerNetwork): PlannerNode[] {
//   const retained = network.nodes.filter(node => node.purpose === "environment");
//   const consumers = network.nodes.filter(node => node.recipe?.requiredEnvironmentAnyOf?.[0]);
//   const removed: PlannerNode[] = [];
//   for (const station of [...retained].reverse()) {
//     const alternatives = retained.filter(node => node !== station);
//     const itemId = station.recipe!.environmentOutput!.itemId;
//     const covered = consumers.filter(node => node.recipe!.requiredEnvironmentAnyOf?.[0] === itemId).every(node => alternatives.some(other => {
//       const gas = other.recipe!.environmentOutput!;
//       if (gas.itemId !== itemId) return false;
//       const range = resolveGasDiffusionRangeGridRect({ entity: other.entity, definition: other.definition, rangeId: gas.rangeId });
//       return range !== null && areGridRectsContaining(range, resolveEntityGridRect({ entity: node.entity, definition: node.definition }));
//     }));
//     if (covered) { retained.splice(retained.indexOf(station), 1); removed.push(station); }
//   }
//   return removed;
// }
//
// function placeEnvironmentStation(node: PlannerNode, placement: PlannerPlacement, variant: number): void {
//   const localRect = findEntityRange(node.definition, node.recipe!.environmentOutput!.rangeId).localRect;
//   const range = Math.max(localRect.width, localRect.height);
//   const inset = Math.floor((range - node.definition.footprint.width) / 2);
//   const bounds = placement.bounds();
//   // AI-REMOVED 2026-10-03:
//   // Reason: 固定步长遗漏合法位置，19 格宽的初排仅检查越界的 x=18。
//   // Trigger: 用户任务 eda2.json 在零提案时失败。
//   // Evidence: 同一空布局中 x=12 可放，原循环未枚举。
//   // Replacement: 下方完整整数坐标与朝向搜索；Risk: 初排检查量增加；Human Review: Required。
//   // Original code:
//   //   for (let y = placement.minimumY + inset; y <= placement.minimumY + bounds.height + range * 2; y += range + 2) {
//   //     for (let x = placement.minimumX + Math.max(inset, placement.rowWidth - inset); x >= placement.minimumX + inset; x -= range + 2) {
//   //       if (placement.canPlace(node, { x, y }, 0)) { placement.place(node, { x, y }, 0); return; }
//   //     }
//   //   }
//   const left = placement.minimumX;
//   const right = Math.min(left + placement.rowWidth, placement.maximumX ?? Infinity) - node.definition.footprint.width;
//   // 2026-10-16：优先把完整覆盖区和一格引出通道留在初排宽度内，避免最右侧受覆盖设备一开始就越界。
//   const preferredX = Math.min(right, Math.max(left + inset,
//     Math.min(left + placement.rowWidth, placement.maximumX ?? Infinity) - node.definition.footprint.width - inset - 1));
//   const xs = Array.from({ length: Math.max(0, right - left + 1) }, (_, index) => left + index)
//     .sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));
//   const ys = Array.from({ length: bounds.height + range * 2 + 1 }, (_, index) => placement.minimumY + index)
//     .sort((a, b) => Math.abs(a - placement.minimumY - inset) - Math.abs(b - placement.minimumY - inset));
//   // 2026-10-16：一半独立初排沿中列放环境组，为两侧工序留空间；另一半仍从侧边按行展开。
//   if (variant % 2 === 1 && right - left + node.definition.footprint.width >= range) {
//     const x = Math.floor((left + right) / 2);
//     for (const y of ys) {
//       const gas = resolveGasDiffusionRangeGridRect({ entity: { ...node.entity, position: { x, y }, rotation: 0 },
//         definition: node.definition, rangeId: node.recipe!.environmentOutput!.rangeId })!;
//       if (gas.y < placement.minimumY || placement.placed.some(other => {
//         const output = other.recipe?.environmentOutput;
//         if (!output) return false;
//         const existing = resolveGasDiffusionRangeGridRect({ entity: other.entity, definition: other.definition, rangeId: output.rangeId });
//         return existing !== null && areGridRectsIntersecting(gas, { x: existing.x - 1, y: existing.y - 1,
//           width: existing.width + 2, height: existing.height + 2 });
//       }) || placement.placed.some(other => other.recipe?.requiredEnvironmentAnyOf?.includes(node.recipe!.environmentOutput!.itemId)
//         && areGridRectsIntersecting(gas, resolveEntityGridRect({ entity: other.entity, definition: other.definition })))) continue;
//       if (placement.canPlace(node, { x, y }, 0)) { placement.place(node, { x, y }, 0); return; }
//     }
//   }
//   for (const y of ys) {
//     for (const x of xs) for (const rotation of ROTATIONS) {
//       if (placement.canPlace(node, { x, y }, rotation)) { placement.place(node, { x, y }, rotation); return; }
//     }
//   }
//   throw new PlannerCandidateError("无法放置满足间距的气体环境设施。");
// }
//
// /** 初排让实际加工端口沿工序方向，运行消耗口留给侧向管道。 */
// function flowRotation(registry: RegistryContract, node: PlannerNode, variant: number): GridRotation {
//   const scores = ROTATIONS.map(rotation => {
//     const entity = { ...node.entity, rotation };
//     const score = (["input", "output"] as const).reduce((total, direction) => {
//       const flows = direction === "input" ? node.inputs : node.outputs;
//       return total + flows.reduce((sum, flow) => {
//         const ports = getPlannerPorts(registry, entity, node.definition, direction, flow.itemId, flow.storageGroupIds);
//         return sum + ports.reduce((value, port) => value + (port.outside.x - port.cell.x) * (direction === "input" ? -1 : 1), 0) / Math.max(1, ports.length) * flow.perMinute;
//       }, 0);
//     }, 0);
//     return { rotation, score };
//   });
//   scores.sort((a, b) => b.score - a.score || ((a.rotation / 90 + variant) % 4) - ((b.rotation / 90 + variant) % 4));
//   return scores[0]!.rotation;
// }
//
// export function createPlainNode(registry: RegistryContract, definitionId: string, id: string, purpose: PlannerNode["purpose"]): PlannerNode {
//   const definition = registry.queries.findEntityDefinition(definitionId);
//   if (definition === null) throw new Error(`设备未注册：${definitionId}`);
//   const entity: WorldEntity = { id, definitionId, position: { x: 0, y: 0 }, rotation: 0, config: {}, tags: [] };
//   return { entity, definition, recipe: null, purpose, inputs: [], outputs: [] };
// }
//
// function containsCell(rect: GridRect, point: GridPoint): boolean {
//   return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
// }
//
// function escapeCells(port: PlannerPort, length: number): GridPoint[] {
//   const delta = DELTAS[EDGES.indexOf(port.edge)]!;
//   return Array.from({ length }, (_, step) => ({ x: port.outside.x + delta.x * step, y: port.outside.y + delta.y * step }));
// }
//
