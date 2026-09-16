import type { GridPoint, GridRect } from "@/domain/shared/grid";

/** 矩形桶索引只缩小候选集；精确判定与返回顺序保持输入语义。几何改变后需重建。 */
export class GridRectIndex<T> {
  private readonly buckets = new Map<string, number[]>();
  private readonly rects: readonly GridRect[];

  public constructor(private readonly entries: readonly T[], rect: (entry: T) => GridRect) {
    this.rects = entries.map(rect);
    for (let i = 0; i < entries.length; i++) {
      this.visit(this.rects[i]!, (key) => {
        let bucket = this.buckets.get(key);
        if (!bucket) { bucket = []; this.buckets.set(key, bucket); }
        bucket.push(i);
      });
    }
  }

  public at(point: GridPoint): T[] {
    const bucket = this.buckets.get(`${Math.floor(point.x / 8)},${Math.floor(point.y / 8)}`) ?? [];
    return bucket.filter((i) => {
      const r = this.rects[i]!;
      return point.x >= r.x && point.y >= r.y && point.x < r.x + r.width && point.y < r.y + r.height;
    }).map((i) => this.entries[i]!);
  }

  public intersecting(rect: GridRect): T[] {
    const found = new Set<number>();
    this.visit(rect, (key) => {
      for (const i of this.buckets.get(key) ?? []) {
        const r = this.rects[i]!;
        if (r.x < rect.x + rect.width && r.x + r.width > rect.x
          && r.y < rect.y + rect.height && r.y + r.height > rect.y) found.add(i);
      }
    });
    return [...found].sort((a, b) => a - b).map((i) => this.entries[i]!);
  }

  private visit(rect: GridRect, visit: (key: string) => void): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    for (let y = Math.floor(rect.y / 8); y < Math.ceil((rect.y + rect.height) / 8); y++) {
      for (let x = Math.floor(rect.x / 8); x < Math.ceil((rect.x + rect.width) / 8); x++) visit(`${x},${y}`);
    }
  }
}
