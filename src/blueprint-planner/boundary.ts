import type { BlueprintPlannerOptions } from "@/domain/blueprint-planner";
import type { WorldEntity } from "@/domain/document/world-document";
import type { RegistryContract } from "@/domain/registry/registry-contract";
import type { GridEdge, GridRotation } from "@/domain/shared/grid";
import { areGridRectsIntersecting, resolveEntityGridRect } from "@/shared/geometry/power-range";
import { EDGES, getPlannerPorts, opposite, ROTATIONS } from "./geometry";
import { PlannerCandidateError, type PlannerNetwork, type PlannerNode } from "./model";
import { createPlainNode } from "./placement";
import { plannerBusConflictCount } from "./layout-backend";

export interface PlannerBoundaryPose { x: number; y: number; rotation: GridRotation; }
interface BoundaryGeometry { width: number; height: number; edge: GridEdge; }
interface BoundaryEntry { index: number; kind: "warehouse" | "belt" | "pipe"; geometry: readonly BoundaryGeometry[]; }

// 北、东、南、西分别占一位；按面数排列，优先使用最少的连续边，包含没有仓库口的连接边。
const BUS_MASKS = [0, 1, 2, 4, 8, 3, 6, 12, 9, 7, 14, 13, 11] as const;
const MASK_COUNTS = { straight: 5, corner: 9, "u-shaped": 13 } as const;

/** 四边最多 13 种组合；只禁止外接传送带与存取线同面，管道仍遵守 Registry 的重叠规则。 */
export function resolvePlannerBusMask(shape: BlueprintPlannerOptions["warehouseBus"], warehouse: number, externalBelts: number): number | null {
  for (let index = 0; index < MASK_COUNTS[shape]; index++) {
    const mask = BUS_MASKS[index]!;
    if ((mask & warehouse) === warehouse && (mask & externalBelts) === 0) return mask;
  }
  return null;
}

export function isPlannerBoundaryNode(node: Pick<PlannerNode, "entity" | "external" | "boundaryPort">): boolean {
  return node.boundaryPort !== undefined || node.external === true || node.entity.definitionId === "unloader_1" || node.entity.definitionId === "loader_1";
}

/** 包围盒先确定，仓库口与外接入口沿其内边移动；预计算朝向几何供逐提案检查复用。 */
export class PlannerBoundary {
  readonly entries: readonly BoundaryEntry[];
  private readonly byIndex: ReadonlyMap<number, BoundaryEntry>;
  private readonly proposalCache = new Map<number, PlannerBoundaryPose[]>();

  constructor(private readonly registry: RegistryContract, private readonly network: PlannerNetwork,
    readonly outline: { readonly width: number; readonly height: number }) {
    this.entries = network.nodes.flatMap((node, index) => {
      if (!isPlannerBoundaryNode(node)) return [];
      const direction = node.boundaryPort?.direction ?? (node.external || node.entity.definitionId === "loader_1" ? "input" : "output");
      const kind = node.external || node.boundaryPort ? getPlannerPorts(registry, node.entity, node.definition, direction)[0]!.kind : "warehouse";
      const geometry = ROTATIONS.map(rotation => {
        const entity = { ...node.entity, position: { x: 0, y: 0 }, rotation };
        const ports = getPlannerPorts(registry, entity, node.definition, direction);
        const port = node.boundaryPort ? ports.find(port => port.groupIndex === node.boundaryPort!.groupIndex && port.portIndex === node.boundaryPort!.portIndex)! : ports[0]!;
        const edge = kind === "warehouse" ? opposite(port.edge) : port.edge;
        const rect = resolveEntityGridRect({ entity, definition: node.definition });
        return { width: rect.width, height: rect.height, edge };
      });
      return [{ index, kind, geometry }];
    });
    this.byIndex = new Map(this.entries.map(entry => [entry.index, entry]));
  }

  has(index: number): boolean { return this.byIndex.has(index); }

  /** 单体换边、成组移动和续搜缩盒都按连接侧重新锚定；重叠交由共用布局校验拒绝。 */
  snap(index: number, pose: PlannerBoundaryPose): void {
    const entry = this.byIndex.get(index);
    if (!entry) return;
    const current = entry.geometry[pose.rotation / 90]!;
    if (current.width > this.outline.width || current.height > this.outline.height) {
      const turn = entry.geometry.findIndex(size => size.width <= this.outline.width && size.height <= this.outline.height);
      if (turn >= 0) pose.rotation = ROTATIONS[turn]!;
    }
    const { width, height, edge } = entry.geometry[pose.rotation / 90]!;
    pose.x = Math.max(0, Math.min(this.outline.width - width, pose.x));
    pose.y = Math.max(0, Math.min(this.outline.height - height, pose.y));
    if (edge === "NORTH") pose.y = 0;
    else if (edge === "SOUTH") pose.y = this.outline.height - height;
    else if (edge === "WEST") pose.x = 0;
    else pose.x = this.outline.width - width;
  }

  proposals(index: number): PlannerBoundaryPose[] {
    const cached = this.proposalCache.get(index);
    if (cached) return cached;
    const entry = this.byIndex.get(index);
    if (!entry) return [];
    const result = entry.geometry.flatMap(({ width, height, edge }, turn) => {
      if (width > this.outline.width || height > this.outline.height) return [];
      const horizontal = edge === "NORTH" || edge === "SOUTH";
      const count = horizontal ? this.outline.width - width : this.outline.height - height;
      return Array.from({ length: count + 1 }, (_, offset) => {
        const pose = { x: horizontal ? offset : 0, y: horizontal ? 0 : offset, rotation: ROTATIONS[turn]! };
        this.snap(index, pose);
        return pose;
      });
    });
    this.proposalCache.set(index, result);
    return result;
  }

  resolve(poses: readonly PlannerBoundaryPose[], selected?: ReadonlySet<number>, override?: { index: number; pose: PlannerBoundaryPose }) {
    let warehouse = 0, externalBelts = 0, violations = 0;
    const warehouseCounts = [0, 0, 0, 0], beltCounts = [0, 0, 0, 0];
    for (const entry of this.entries) {
      if (selected && !selected.has(entry.index)) continue;
      const pose = override?.index === entry.index ? override.pose : poses[entry.index]!;
      const { width, height, edge } = entry.geometry[pose.rotation / 90]!;
      const distance = edge === "NORTH" ? Math.abs(pose.y) : edge === "SOUTH" ? Math.abs(pose.y + height - this.outline.height)
        : edge === "WEST" ? Math.abs(pose.x) : Math.abs(pose.x + width - this.outline.width);
      violations += distance + Math.max(0, -pose.x) + Math.max(0, -pose.y)
        + Math.max(0, pose.x + width - this.outline.width) + Math.max(0, pose.y + height - this.outline.height);
      const bit = 1 << EDGES.indexOf(edge);
      if (entry.kind === "warehouse") warehouse |= bit;
      else if (entry.kind === "belt") externalBelts |= bit;
      if (entry.kind === "warehouse") warehouseCounts[EDGES.indexOf(edge)]!++;
      else if (entry.kind === "belt") beltCounts[EDGES.indexOf(edge)]!++;
    }
    const busMask = resolvePlannerBusMask(this.network.request.options.warehouseBus, warehouse, externalBelts);
    return { busMask, violations: violations + plannerBusConflictCount(
      this.network.request.options.warehouseBus === "straight" ? 1 : this.network.request.options.warehouseBus === "corner" ? 2 : 3,
      warehouseCounts, beltCounts) };
  }

  /** 初始口位只提供种子，后续构造和退火仍可重新选边；不把初始口位纳入最小盒子尺寸。 */
  // 订正 2026-10-10：传入搜索姿态时只返回整组提案，不写实体；固定入口保持原位。
  arrange(variant: number, state?: { readonly poses: readonly PlannerBoundaryPose[]; readonly movable: ReadonlySet<number> }): PlannerBoundaryPose[] {
    const preferredEdge = EDGES[(3 + variant) % 4]!;
    const preferredBit = 1 << EDGES.indexOf(preferredEdge);
    const masks = BUS_MASKS.slice(0, MASK_COUNTS[this.network.request.options.warehouseBus])
      .filter(mask => this.entries.some(entry => entry.kind === "warehouse") ? mask !== 0 : mask === 0)
      .sort((a, b) => Number((b & preferredBit) !== 0) - Number((a & preferredBit) !== 0));
    // 至多尝试 13 种连续边组合，避免第一只仓库口选了短边就把整个可行盒子误判失败。
    for (const mask of masks) {
      const poses = state ? state.poses.map(pose => ({ ...pose }))
        : this.network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }));
      const selected = new Set(this.entries.filter(entry => state && !state.movable.has(entry.index)).map(entry => entry.index));
      if (this.resolve(poses, selected).violations) continue;
      if (this.entries.some(entry => selected.has(entry.index) && (entry.kind === "warehouse"
        ? !(mask & (1 << EDGES.indexOf(entry.geometry[poses[entry.index]!.rotation / 90]!.edge)))
        : entry.kind === "belt" && (mask & (1 << EDGES.indexOf(entry.geometry[poses[entry.index]!.rotation / 90]!.edge)))))) continue;
      let complete = true;
      for (const entry of this.entries) {
        if (selected.has(entry.index)) continue;
        selected.add(entry.index);
        const candidates = [...this.proposals(entry.index)].sort((a, b) => {
          const ga = entry.geometry[a.rotation / 90]!, gb = entry.geometry[b.rotation / 90]!;
          const preferred = entry.kind === "warehouse" ? preferredEdge : opposite(preferredEdge);
          const current = poses[entry.index]!;
          const distance = (pose: PlannerBoundaryPose) => Math.abs(pose.x - current.x) + Math.abs(pose.y - current.y);
          return Number(gb.edge === preferred) - Number(ga.edge === preferred)
            || (state ? distance(a) - distance(b) : 0) || a.y - b.y || a.x - b.x;
        });
        const pose = candidates.find(pose => {
          const bit = 1 << EDGES.indexOf(entry.geometry[pose.rotation / 90]!.edge);
          if (entry.kind === "warehouse" && !(mask & bit) || entry.kind === "belt" && (mask & bit)) return false;
          return this.resolve(poses, selected, { index: entry.index, pose }).violations === 0
            && this.entries.every(other => !selected.has(other.index) || other.index === entry.index
              || !areGridRectsIntersecting({ ...pose, ...entry.geometry[pose.rotation / 90]! },
                { ...poses[other.index]!, ...other.geometry[poses[other.index]!.rotation / 90]! }));
        });
        if (!pose) { complete = false; break; }
        poses[entry.index] = pose;
      }
      if (!complete) continue;
      if (state) return poses;
      for (const entry of this.entries) {
        const node = this.network.nodes[entry.index]!, pose = poses[entry.index]!;
        node.entity.position = { x: pose.x, y: pose.y }; node.entity.rotation = pose.rotation;
      }
      return poses;
    }
    throw new PlannerCandidateError("包围盒边长或存取线形态无法容纳边界入口。");
  }

  /** 仅为验收补齐真实存取线，所有本体均在盒外；基段允许沿边外延，不扩大交付面积。 */
  fixtures(busMask: number): WorldEntity[] {
    if (!busMask) return [];
    const source = this.registry.queries.findEntityDefinition("log_hongs_bus_source")!;
    const segment = this.registry.queries.findEntityDefinition("log_hongs_bus")!;
    const thickness = source.footprint.width, length = segment.footprint.height;
    const { width, height } = this.outline;
    const result: WorldEntity[] = [];
    const add = (definitionId: string, x: number, y: number, rotation: GridRotation) => {
      const node = createPlainNode(this.registry, definitionId, `eda-validation-bus-${result.length}`, "logistics");
      node.entity.position = { x, y }; node.entity.rotation = rotation; result.push(node.entity);
    };
    const corners = [{ x: -thickness, y: -thickness }, { x: width, y: -thickness },
      { x: width, y: height }, { x: -thickness, y: height }];
    for (let side = 0; side < 4; side++) {
      if (!(busMask & (1 << side))) continue;
      const previous = (side + 3) % 4;
      const previousLength = previous % 2 === 0 ? width : height;
      if (!(busMask & (1 << previous)) || previousLength % length === 0) {
        const corner = corners[side]!; add(source.id, corner.x, corner.y, 0);
      }
      const span = side % 2 === 0 ? width : height;
      for (let offset = 0; offset < span; offset += length) {
        const x = side === 0 ? offset : side === 1 ? width : side === 2 ? width - offset - length : -thickness;
        const y = side === 0 ? -thickness : side === 1 ? offset : side === 2 ? height : height - offset - length;
        add(segment.id, x, y, side % 2 === 0 ? 90 : 0);
      }
    }
    return result;
  }
}

// AI-REMOVED 2026-10-05:
// Reason: 初始仓库口先占短边会误拒仍能用长边的盒子。
// Trigger: 新规则允许四边选位，不能让贪心顺序变成硬约束。
// Evidence: 4 个三格仓库口在 20×6 直线盒子只能沿长边放置。
// Replacement: arrange 的有限连续边组合初始化。
// Risk: 初排增加至多 13 组尝试，不影响逐提案约束复杂度。
// Human Review: Required
// Original code:
//     const poses = this.network.nodes.map(node => ({ ...node.entity.position, rotation: node.entity.rotation }));
//     const selected = new Set<number>();
//     for (const entry of this.entries) {
//       selected.add(entry.index);
//       const candidates = this.proposals(entry.index);
//       const preferredEdge = EDGES[(3 + variant) % 4]!;
//       candidates.sort((a, b) => {
//         const ga = entry.geometry[a.rotation / 90]!, gb = entry.geometry[b.rotation / 90]!;
//         const preferred = entry.kind === "warehouse" ? preferredEdge : opposite(preferredEdge);
//         return Number(gb.edge === preferred) - Number(ga.edge === preferred) || a.y - b.y || a.x - b.x;
//       });
//       const pose = candidates.find(pose => this.resolve(poses, selected, { index: entry.index, pose }).violations === 0
//         && this.entries.every(other => !selected.has(other.index) || other.index === entry.index
//           || !areGridRectsIntersecting({ ...pose, ...entry.geometry[pose.rotation / 90]! },
//             { ...poses[other.index]!, ...other.geometry[poses[other.index]!.rotation / 90]! })));
//       if (!pose) throw new PlannerCandidateError("包围盒边长或存取线形态无法容纳边界入口。");
//       poses[entry.index] = pose;
//     }
//     for (const entry of this.entries) {
//       const node = this.network.nodes[entry.index]!, pose = poses[entry.index]!;
//       node.entity.position = { x: pose.x, y: pose.y }; node.entity.rotation = pose.rotation;
//     }
