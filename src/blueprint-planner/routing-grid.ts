// AI-CORRECTION 2026-10-26：保留物理通行规则、GPU 容量和背压修复；不恢复新搜索分支。
/** 每格、每物流种类一个 u32：出方向矩阵、入方向掩码、障碍和预留。CPU 与 GPU 可共用数值编码。 */
import type { GridRect } from "@/domain/shared/grid";

export const ROUTE_ENTER_SHIFT = 16;
export const ROUTE_BLOCKED = 1 << 20;
export const ROUTE_RESERVED = 1 << 21;
export const ROUTE_OCCUPIED = 1 << 22;
export const ROUTE_OBSTACLE = 1 << 23;
/** 端口只预留自身运输轴，另一轴仍可通过桥接器直穿。 */
export const ROUTE_RESERVED_AXIS_SHIFT = 24;
export const ROUTE_OPEN = 0xf0000 | 0xb | (0x7 << 4) | (0xe << 8) | (0xd << 12);

/** 非本线路端点的预留格只允许沿未预留轴直穿，禁止转弯和占用预留轴。 */
export function allowsPlannerReservationTransit(state: number, incoming: number, outgoing: number): boolean {
  if (!(state & ROUTE_RESERVED)) return true;
  const axes = (state >>> ROUTE_RESERVED_AXIS_SHIFT) & 3;
  return axes !== 0 && incoming === outgoing && !(axes & (1 << (incoming % 2)));
}

/** 稠密镜像只在 GPU 请求时创建；脏区间单位为 u32，上传后由唯一消费者清空。 */
export interface PlannerRoutingSnapshot {
  readonly bounds: GridRect;
  readonly values: Uint32Array<ArrayBuffer>;
  firstDirty: number;
  lastDirty: number;
}

/** 只为遇到的坐标分配格子；不按最大坐标或最短长度预分配整张稠密图。 */
export class PlannerRoutingGrid {
  private readonly columns = new Map<number, Map<number, number>>();
  readonly x: number[] = [];
  readonly y: number[] = [];
  private values = new Uint32Array(256);
  private snapshot: PlannerRoutingSnapshot | null = null;

  dense(bounds: GridRect): PlannerRoutingSnapshot {
    const current = this.snapshot;
    if (current && Object.keys(bounds).every(key => bounds[key as keyof GridRect] === current.bounds[key as keyof GridRect])) return current;
    const values = new Uint32Array(bounds.width * bounds.height * 2).fill(ROUTE_OPEN);
    this.snapshot = { bounds: { ...bounds }, values, firstDirty: 0, lastDirty: values.length };
    for (let cell = 0; cell < this.x.length; cell++) this.updateSnapshot(cell);
    return this.snapshot;
  }

  private updateSnapshot(cell: number): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const x = this.x[cell]! - snapshot.bounds.x, y = this.y[cell]! - snapshot.bounds.y;
    if (x < 0 || y < 0 || x >= snapshot.bounds.width || y >= snapshot.bounds.height) return;
    const offset = (y * snapshot.bounds.width + x) * 2;
    snapshot.values[offset] = this.read(cell, 0); snapshot.values[offset + 1] = this.read(cell, 1);
    snapshot.firstDirty = Math.min(snapshot.firstDirty, offset); snapshot.lastDirty = Math.max(snapshot.lastDirty, offset + 2);
  }

  cell(x: number, y: number): number {
    let column = this.columns.get(x);
    const found = column?.get(y);
    if (found !== undefined) return found;
    if (!column) { column = new Map(); this.columns.set(x, column); }
    const id = this.x.length;
    if (id * 2 >= this.values.length) {
      const next = new Uint32Array(this.values.length * 2);
      next.set(this.values); this.values = next;
    }
    this.x.push(x); this.y.push(y); column.set(y, id);
    this.values[id * 2] = ROUTE_OPEN; this.values[id * 2 + 1] = ROUTE_OPEN;
    return id;
  }

  read(cell: number, kind: number): number { return this.values[cell * 2 + kind]!; }

  block(cell: number, permeable: number): void {
    for (let kind = 0; kind < 2; kind++) {
      this.values[cell * 2 + kind] = this.read(cell, kind) | ROUTE_OBSTACLE | (permeable & (1 << kind) ? 0 : ROUTE_BLOCKED);
    }
    this.updateSnapshot(cell);
  }

  reserve(cell: number, kind: number, direction: number): void {
    this.values[cell * 2 + kind] = this.read(cell, kind) | ROUTE_RESERVED | (1 << (ROUTE_RESERVED_AXIS_SHIFT + direction % 2));
    this.updateSnapshot(cell);
  }

  /** 提交一格线路时只改该格的两个 u32；其他格子与静态障碍保持原位。 */
  updateRoute(cell: number, kind: number, enter: number, leave: number): void {
    this.values[cell * 2 + kind] = (this.read(cell, kind) & 0xfff00000) | ROUTE_OCCUPIED | (enter << ROUTE_ENTER_SHIFT) | leave;
    this.updateSnapshot(cell);
  }
}

// AI-REMOVED 2026-10-26:
// Reason: 用户要求恢复 beta1/2 搜索内核，撤回其后搜索实现；保留业务正确性修复与公开任务接口。
// Trigger: 多版本对照后用户明确要求回退算法并使用 2S 渐增至 3S 初始面积。
// Evidence: .temp/eda/all-items/comparisons/default-area-20261026T015057315Z.json；回退前 SHA256 92ca684f8862cbd06702e32dde825b8eba7fc86357a22e74d1ecf44657da44eb。
// Replacement: src/blueprint-planner/routing-grid.ts 上方 beta1/2 活动实现
// Risk: 搜索策略、检查点及后续局部修复能力变化；原始未提交内容完整保留。
// Human Review: Required
// Original code (src/blueprint-planner/routing-grid.ts):
// /** 每格、每物流种类一个 u32：出方向矩阵、入方向掩码、障碍和预留。CPU 与 GPU 可共用数值编码。 */
// import type { GridRect } from "@/domain/shared/grid";
//
// export const ROUTE_ENTER_SHIFT = 16;
// export const ROUTE_BLOCKED = 1 << 20;
// export const ROUTE_RESERVED = 1 << 21;
// export const ROUTE_OCCUPIED = 1 << 22;
// export const ROUTE_OBSTACLE = 1 << 23;
// /** 端口只预留自身运输轴，另一轴仍可通过桥接器直穿。 */
// export const ROUTE_RESERVED_AXIS_SHIFT = 24;
// export const ROUTE_OPEN = 0xf0000 | 0xb | (0x7 << 4) | (0xe << 8) | (0xd << 12);
//
// /** 非本线路端点的预留格只允许沿未预留轴直穿，禁止转弯和占用预留轴。 */
// export function allowsPlannerReservationTransit(state: number, incoming: number, outgoing: number): boolean {
//   if (!(state & ROUTE_RESERVED)) return true;
//   const axes = (state >>> ROUTE_RESERVED_AXIS_SHIFT) & 3;
//   return axes !== 0 && incoming === outgoing && !(axes & (1 << (incoming % 2)));
// }
//
// /** 稠密镜像只在 GPU 请求时创建；脏区间单位为 u32，上传后由唯一消费者清空。 */
// export interface PlannerRoutingSnapshot {
//   readonly bounds: GridRect;
//   readonly values: Uint32Array<ArrayBuffer>;
//   firstDirty: number;
//   lastDirty: number;
// }
//
// /** 只为遇到的坐标分配格子；不按最大坐标或最短长度预分配整张稠密图。 */
// export class PlannerRoutingGrid {
//   private readonly columns = new Map<number, Map<number, number>>();
//   readonly x: number[] = [];
//   readonly y: number[] = [];
//   private values = new Uint32Array(256);
//   private snapshot: PlannerRoutingSnapshot | null = null;
//
//   dense(bounds: GridRect): PlannerRoutingSnapshot {
//     const current = this.snapshot;
//     if (current && Object.keys(bounds).every(key => bounds[key as keyof GridRect] === current.bounds[key as keyof GridRect])) return current;
//     const values = new Uint32Array(bounds.width * bounds.height * 2).fill(ROUTE_OPEN);
//     this.snapshot = { bounds: { ...bounds }, values, firstDirty: 0, lastDirty: values.length };
//     for (let cell = 0; cell < this.x.length; cell++) this.updateSnapshot(cell);
//     return this.snapshot;
//   }
//
//   private updateSnapshot(cell: number): void {
//     const snapshot = this.snapshot;
//     if (!snapshot) return;
//     const x = this.x[cell]! - snapshot.bounds.x, y = this.y[cell]! - snapshot.bounds.y;
//     if (x < 0 || y < 0 || x >= snapshot.bounds.width || y >= snapshot.bounds.height) return;
//     const offset = (y * snapshot.bounds.width + x) * 2;
//     snapshot.values[offset] = this.read(cell, 0); snapshot.values[offset + 1] = this.read(cell, 1);
//     snapshot.firstDirty = Math.min(snapshot.firstDirty, offset); snapshot.lastDirty = Math.max(snapshot.lastDirty, offset + 2);
//   }
//
//   cell(x: number, y: number): number {
//     let column = this.columns.get(x);
//     const found = column?.get(y);
//     if (found !== undefined) return found;
//     if (!column) { column = new Map(); this.columns.set(x, column); }
//     const id = this.x.length;
//     if (id * 2 >= this.values.length) {
//       const next = new Uint32Array(this.values.length * 2);
//       next.set(this.values); this.values = next;
//     }
//     this.x.push(x); this.y.push(y); column.set(y, id);
//     this.values[id * 2] = ROUTE_OPEN; this.values[id * 2 + 1] = ROUTE_OPEN;
//     return id;
//   }
//
//   read(cell: number, kind: number): number { return this.values[cell * 2 + kind]!; }
//
//   block(cell: number, permeable: number): void {
//     for (let kind = 0; kind < 2; kind++) {
//       this.values[cell * 2 + kind] = this.read(cell, kind) | ROUTE_OBSTACLE | (permeable & (1 << kind) ? 0 : ROUTE_BLOCKED);
//     }
//     this.updateSnapshot(cell);
//   }
//
//   reserve(cell: number, kind: number, direction: number): void {
//     this.values[cell * 2 + kind] = this.read(cell, kind) | ROUTE_RESERVED | (1 << (ROUTE_RESERVED_AXIS_SHIFT + direction % 2));
//     this.updateSnapshot(cell);
//   }
//
//   /** 提交一格线路时只改该格的两个 u32；其他格子与静态障碍保持原位。 */
//   updateRoute(cell: number, kind: number, enter: number, leave: number): void {
//     this.values[cell * 2 + kind] = (this.read(cell, kind) & 0xfff00000) | ROUTE_OCCUPIED | (enter << ROUTE_ENTER_SHIFT) | leave;
//     this.updateSnapshot(cell);
//   }
// }
//

// AI-REMOVED 2026-11-17:
// Reason: 收敛到已完成全物品实测的 v13 搜索内核，撤回后续算法尝试。
// Trigger: 用户要求选择自动未劣化、人工基本有首解的稳定版本并移除其他尝试。
// Evidence: history/20261114T163844782Z-2672695.meta.json；自动 215/215，人工预算内首解 198/215。
// Replacement: 本文件上方当前分支 HEAD 基线实现及明确保留的准备校验修正。
// Risk: 后续实验的局部改善不再提供，困难人工样本仍可能无解；历史成绩不是新测试成绩。
// Human Review: Required
// Original code:
// 原文件 src/blueprint-planner/routing-grid.ts 第 11 行：
// // AI-CORRECTION 2026-11-16：另一轴可直穿的前提是该端口本身可以直行；必需转弯的端口另记所属轴。
// 原文件 src/blueprint-planner/routing-grid.ts 第 13 行：
// export const ROUTE_RESERVED_TURN_SHIFT = 26;
// 原文件 src/blueprint-planner/routing-grid.ts 第 17 行：
// // AI-CORRECTION 2026-11-16：线路端点仅豁免自身轴，仍须保护同格其他端口的正交预留；无轴信息的预留保持拒绝。
// export function allowsPlannerReservationTransit(state: number, incoming: number, outgoing: number, ownedAxes = 0): boolean {
// 原文件 src/blueprint-planner/routing-grid.ts 第 21 行：
//   // 转弯会占用两轴；只允许拥有该端口的线路进入，不能让先布的线路封死后续端口。
//   if (((state >>> ROUTE_RESERVED_TURN_SHIFT) & 3 & ~ownedAxes) !== 0) return false;
//   const remaining = axes & ~ownedAxes;
//   return axes !== 0 && (remaining === 0 || incoming === outgoing && !(remaining & (1 << (incoming % 2))));
// 原文件 src/blueprint-planner/routing-grid.ts 第 86 行：
//   reserve(cell: number, kind: number, direction: number, forcedTurn = false): void {
//     this.values[cell * 2 + kind] = this.read(cell, kind) | ROUTE_RESERVED | (1 << (ROUTE_RESERVED_AXIS_SHIFT + direction % 2))
//       | (forcedTurn ? 1 << (ROUTE_RESERVED_TURN_SHIFT + direction % 2) : 0);
