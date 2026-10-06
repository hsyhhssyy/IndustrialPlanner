/** 每格、每物流种类一个 u32：出方向矩阵、入方向掩码、障碍和预留。CPU 与 GPU 可共用数值编码。 */
import type { GridRect } from "@/domain/shared/grid";

export const ROUTE_ENTER_SHIFT = 16;
export const ROUTE_BLOCKED = 1 << 20;
export const ROUTE_RESERVED = 1 << 21;
export const ROUTE_OCCUPIED = 1 << 22;
export const ROUTE_OBSTACLE = 1 << 23;
export const ROUTE_OPEN = 0xf0000 | 0xb | (0x7 << 4) | (0xe << 8) | (0xd << 12);

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

  /** 2026-10-06：压缩回滚按格子写回清格前的数值状态，保持同一数组引用以免稠密镜像失效。 */
  restoreValue(cell: number, kind: number, value: number): void {
    this.values[cell * 2 + kind] = value;
    this.updateSnapshot(cell);
  }

  block(cell: number, permeable: number): void {
    for (let kind = 0; kind < 2; kind++) {
      this.values[cell * 2 + kind] = this.read(cell, kind) | ROUTE_OBSTACLE | (permeable & (1 << kind) ? 0 : ROUTE_BLOCKED);
    }
    this.updateSnapshot(cell);
  }

  reserve(cell: number, kind: number): void {
    this.values[cell * 2 + kind] = this.read(cell, kind) | ROUTE_RESERVED;
    this.updateSnapshot(cell);
  }

  /** 提交一格线路时只改该格的两个 u32；其他格子与静态障碍保持原位。 */
  updateRoute(cell: number, kind: number, enter: number, leave: number): void {
    this.values[cell * 2 + kind] = (this.read(cell, kind) & 0xfff00000) | ROUTE_OCCUPIED | (enter << ROUTE_ENTER_SHIFT) | leave;
    this.updateSnapshot(cell);
  }
}
